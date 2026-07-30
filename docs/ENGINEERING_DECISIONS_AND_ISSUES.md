# FitFormLive 문제·해결방안·의사결정 기록

최종 갱신: 2026-07-30

이 문서는 구현 과정에서 발견된 문제, 선택한 해결방안, 그 방안을
선택한 이유와 검증 결과를 함께 기록한다. 앞으로 중요한 구현 변경은
다음 형식으로 이 문서에 계속 추가한다.

```text
문제
영향
해결방안
선택 이유
검증 결과
남은 위험과 다음 작업
```

---

## D-001. 부분 동작이 완전 반복으로 계산되는 문제

### 문제

`curl-partial-01`에서 완전한 컬은 0회였지만 현재 production FSM은
부분 동작 5개 중 2개를 반복으로 계산했다.

현재 production 수축 기준은 `down = 60°`, hysteresis는 `8°`다.
동작이 수축 상태로 진입한 뒤 약 52° 이상으로 돌아오기 시작하면
복귀 단계로 전환될 수 있다. 영상의 마지막 두 부분 동작은 최저
각도가 각각 약 44.9°, 41.6°였기 때문에 완전 수축이 아니었음에도
카운트 조건에 들어갔다.

### 영향

- 사용자가 작은 가동 범위로 움직여도 반복 수가 증가할 수 있다.
- 운동 품질을 평가하는 제품의 신뢰도가 낮아진다.
- 단순 rep count 정확도뿐 아니라 자세 피드백의 의미도 약해진다.

### 해결방안

현재 production 코드는 즉시 변경하지 않고, 완전 수축 상태를 별도로
요구하는 탐색형 FSM을 병렬 평가한다.

탐색 설정:

- 수축 후보 시작: 60°
- 완전 수축 확인: 36.3579°
- 완전 신전: 155°
- hysteresis: 8°
- hold: 180ms

FSM 단계:

```text
extended
→ contracting
→ fully_contracted
→ returning
→ rep counted
```

### 선택 이유

- 단순히 기존 `down` 값만 낮추는 것보다 “수축 시작”과 “완전 수축”을
  구분하면 불완전 동작 거절 이유를 명확히 표현할 수 있다.
- 기존 production을 바로 변경하지 않아 현재 동작을 보존하면서 같은
  입력으로 안전하게 비교할 수 있다.
- 36.3579°는 기존 정상 cycle의 최대 최소각과 boundary cycle의 최소
  최소각 사이의 중간값이다. 임의의 정수 threshold보다 현재 데이터의
  분리 구간을 반영한다.

### 검증 결과

| 세션 | 완전 반복 정답 | Production | 탐색형 FSM |
| --- | ---: | ---: | ---: |
| `curl-normal-pytest-01` | 10 | 10 | 10 |
| `curl-fast-02` | 10 | 10 | 10 |
| `curl-partial-01` | 0 | 2 | 0 |
| `curl-occlusion-01` | 5 | 3 | 3 |

현재 표본에서는 정상과 빠른 반복을 유지하면서 partial false positive
2개를 제거했다.

### 남은 위험과 다음 작업

- 한 사람과 제한된 촬영 조건에서 얻은 결과다.
- 36.3579°를 production 기본값으로 아직 확정하지 않는다.
- 다른 사용자, 팔 길이, 카메라 위치, 운동 속도에서 정상 반복을
  놓치지 않는지 추가 영상 ground truth가 필요하다.

---

## D-002. 브라우저 기록과 오프라인 replay 결과 불일치

### 문제

기존 keypoint 기반 F_FULL replay가 브라우저의 실제 카운트를 일부
세션에서 재현하지 못했다.

| 세션 | 브라우저 기록 | 기존 오프라인 재계산 |
| --- | ---: | ---: |
| `curl-partial-01` | 2 | 5 |
| `curl-fast-01` | 1 | 3 |

### 원인

브라우저는 MoveNet 결과에 EMA, 유효성 검사, 각속도 제한과 상태
처리를 적용한다. 기존 오프라인 재계산은 이 capture-time 처리 경로를
완전히 동일하게 재현하지 않았다.

### 영향

- 오프라인 결과를 실제 production 결과로 오해할 수 있다.
- threshold와 FSM 변경 효과를 잘못 판단할 수 있다.
- 회귀 테스트가 브라우저 동작의 정확한 기준이 되지 못한다.

### 해결방안

두 replay 목적을 분리했다.

1. `captureParityReplay`
   - 촬영 당시 저장된 `valid`, `processedAngle`, `STATE_RESET` 사용
   - 브라우저 카운트 재현의 기준
2. `diagnosticProductionReplay`
   - raw keypoint에서 오프라인으로 다시 계산
   - 알고리즘 분석용이며 parity 기준으로 사용하지 않음

### 선택 이유

- schema 1.2에 브라우저가 실제 사용한 처리 결과가 이미 저장되어 있어
  가장 짧고 결정론적인 방법으로 production 상태 전이를 재현할 수 있다.
- raw keypoint 재계산 경로를 제거하지 않아 향후 EMA·각속도 처리 분석에
  계속 사용할 수 있다.
- 서로 다른 목적의 결과를 하나의 “replay” 값으로 섞지 않아 해석
  오류를 방지한다.

### 검증 결과

capture-parity replay가 현재 5개 세션 모두에서 브라우저 기록과
일치했다.

| 세션 | 브라우저 | Capture parity |
| --- | ---: | ---: |
| `curl-fast-01` | 1 | 1 |
| `curl-fast-02` | 10 | 10 |
| `curl-normal-pytest-01` | 10 | 10 |
| `curl-occlusion-01` | 3 | 3 |
| `curl-partial-01` | 2 | 2 |

### 남은 위험과 다음 작업

capture-parity는 저장된 처리 결과부터 FSM을 재실행한다. MoveNet부터
각속도 필터까지 raw keypoint 기반으로 완전히 재현하는 end-to-end
replay는 아니다. 향후 모델 또는 전처리 자체를 비교해야 할 때 별도
strict replay가 필요하다.

---

## D-003. 자동 후보를 사람 ground truth로 오인할 위험

### 문제

FSM이 생성한 반복·거절 timestamp는 영상 검수의 시작점일 뿐이다.
이를 자동으로 annotation에 넣으면 모델의 예측을 다시 정답으로
사용하는 순환 평가가 된다.

### 영향

- 평가 precision과 recall이 실제보다 좋게 나타날 수 있다.
- 알고리즘이 놓친 동작은 ground truth에서도 사라질 수 있다.
- threshold 선택 근거가 편향된다.

### 해결방안

- 자동 파일은 `machine_generated_review_candidate`로 표시한다.
- Streamlit에서 `Human approved`를 직접 체크한 행만 annotation으로
  변환한다.
- production과 exploratory 후보 source를 분리해서 중복 승인을 막는다.
- 승인된 annotation에는 annotator와 원본 candidate ID를 기록한다.
- 체크된 행을 바로 받을 수 있는
  `Download N reviewed annotations` 버튼을 제공한다.

### 선택 이유

- 자동 후보가 검수 속도는 높이되 정답의 권한을 갖지 않도록 경계를
  명확히 할 수 있다.
- 누가 어떤 후보를 승인했는지 provenance가 남는다.
- 기존 schema 1.0의 구간 중복 및 timestamp 검증을 그대로 활용할 수
  있다.

### 검증 결과

`curl-partial-01`에서 사람이 승인한 자동 거절 후보 4개가
`partial_rep`으로 저장되었다. 승인하지 않은 후보는 annotation에
포함되지 않는 테스트도 통과했다.

### 남은 위험과 다음 작업

- 한 명의 검수자만 사용했으므로 inter-rater agreement가 없다.
- 중요 평가 세트는 향후 두 명 이상이 독립적으로 검수하는 방안을
  고려한다.

---

## D-004. 자동 후보가 첫 번째 부분 동작을 놓친 문제

### 문제

`curl-partial-01`에는 부분 동작이 5개지만 탐색형 FSM의 자동 거절
후보는 4개만 생성됐다.

### 원인

첫 번째 동작의 각도 excursion:

- 시작: 6439.2ms
- 최저점: 7100.9ms
- 종료: 7710.7ms
- 최저 각도: 64.65°

탐색형 FSM은 60° 이하에서 `contracting`을 시작한다. 첫 번째 동작은
60°를 넘지 않았기 때문에 불완전 수축 후보 상태에도 진입하지 않았다.

### 영향

- 자동 후보만 검수하면 실제 시도 5개 중 1개가 ground truth에서
  누락된다.
- 알고리즘이 감지하지 못한 동작을 평가 데이터에서도 놓치는 대표적인
  selection bias가 발생한다.

### 해결방안

전체 `processedAngle` 시계열에서 120° 아래로 내려갔다가 145° 위로
복귀하는 excursion을 별도로 검사했다. 누락 구간의 영상 프레임을
약 6450, 6803, 7110, 7404, 7714ms에서 확인하고 수동
`partial_rep`을 추가했다.

자동 승인과 구분하기 위해 annotator는
`codex-assisted-review`로 기록했다.

### 선택 이유

- FSM 후보만 사용하는 대신 더 넓은 각도 excursion을 조사하면 FSM이
  시작 조건에서 놓친 동작도 발견할 수 있다.
- 영상 프레임을 함께 확인해 단순 각도 노이즈를 실제 운동 동작으로
  잘못 기록할 가능성을 낮춘다.
- provenance를 분리해 사람이 UI에서 승인한 4개와 보조 검수로 추가한
  1개를 구분할 수 있다.

### 검증 결과

최종 `curl-partial-01.annotations.json`:

- `partial_rep`: 5개
- `valid_rep`: 0개
- 구간 중복: 없음
- schema 검증: 통과

P4 production 평가:

- GT valid reps: 0
- production predictions: 2
- TP: 0
- FP: 2
- FN: 0
- 두 FP 모두 `partial_rep` 구간 내부

### 남은 위험과 다음 작업

현재 excursion 탐색은 분석 과정에서 수동으로 실행했다. 앞으로는
review-candidate 생성 단계에서 “FSM에 들어가지 못한 넓은 움직임”도
`unclassified_excursion` 후보로 자동 제공하는 것이 좋다.

---

## D-005. 장시간 가림 상황의 반복 손실

### 문제

`curl-occlusion-01`에서 실제 완전 반복 5회 중 production과 탐색형
FSM 모두 3회만 계산했다.

### 영향

- 카메라가 가려지거나 관절이 프레임을 벗어나면 반복이 누락된다.
- 사용자는 실제 수행 횟수보다 낮은 값을 볼 수 있다.

### 현재 해결방안

tracking invalid가 1초 이상 지속되면 FSM 상태를 초기화한다. 가림
구간에서는 새로운 반복을 계산하지 않고 추적 복구 후 다시 시작한다.

### 선택 이유

가림 전 상태를 장시간 유지하면 복구 직후 잘못된 phase 연결로 false
positive가 생길 수 있다. 반복 복원보다 잘못된 카운트 방지를 우선한
안전한 정책이다.

### 검증 결과

- 장시간 가림 중 false count: 0
- 1초 후 state reset 확인
- 추적 복구 후 다시 카운트 가능
- 전체 결과는 5회 중 3회

### 남은 위험과 다음 작업

가림 중 수행한 반복은 복구할 수 없다. 제품 UX에서 “추적이 끊겨
반복을 확인하지 못했다”는 안내를 명확히 표시해야 한다. 현재 단계에서
가림 중 반복을 추측해 보정하지 않는다.

---

## D-006. 촬영 구도 실패를 속도 실패로 오인할 위험

### 문제

`curl-fast-01`은 10회 중 1회만 계산됐지만 어깨가 화면 위로 잘려
valid joint rate가 33.2%에 불과했다.

### 해결방안

동일한 빠른 동작을 올바른 구도로 다시 촬영한 `curl-fast-02`를 속도
검증 표본으로 사용하고, `curl-fast-01`은 framing-failure 진단
표본으로만 유지한다.

### 선택 이유

속도와 구도라는 두 변수가 동시에 달라진 데이터를 속도 문제의
근거로 사용하면 원인 해석이 잘못된다. 관절이 안정적으로 보이는
재촬영으로 변수를 분리해야 한다.

### 검증 결과

- `curl-fast-02` valid joint rate: 99.4%
- ground truth: 10
- production: 10
- 탐색형 FSM: 10

현재 증거에서는 빠른 동작 자체보다 촬영 구도가 최초 실패의
주원인이다.

### 남은 위험과 다음 작업

- 더 빠른 동작과 다른 사용자는 아직 검증하지 않았다.
- 촬영 시작 전 필수 관절이 프레임 안에 있는지 알려주는 readiness
  안내가 필요하다.

---

## D-007. 촬영 파일이 Downloads에 저장되는 문제

### 문제

브라우저에서 프로젝트 폴더 handle을 선택하지 않았거나 권한이
유지되지 않으면 세션 JSON, 영상 또는 성능 CSV가 Downloads에
저장된다.

### 해결방안

- 프로젝트에 `data/recordings/raw`, `annotations`, `processed`를
  분리했다.
- 브라우저에서 `data/recordings/raw`를 저장 폴더로 선택하도록 했다.
- Downloads에 남은 정상 및 fast-02 파일은 raw 폴더로 복사하되 원본은
  삭제하지 않았다.

### 선택 이유

원본, 정답 annotation, 처리 결과를 분리하면 데이터 provenance가
명확해지고 실수로 원본을 덮어쓸 가능성이 줄어든다. 브라우저의 보안
정책상 사용자의 폴더 선택 자체를 완전히 생략할 수는 없다.

### 남은 위험과 다음 작업

브라우저 권한이 만료되면 다시 폴더를 선택해야 한다. 촬영 시작 전에
현재 저장 대상과 권한 상태를 더 명확히 표시하는 UI가 필요하다.

---

## D-008. 일부 촬영 JSON의 메모 문자열 손상

### 문제

초기 `curl-partial-01.json`의 `notes` 문자열이 mojibake 및 따옴표
손상으로 유효하지 않은 JSON이 되었다.

### 해결방안

비교 러너는 JSON parsing이 실패했을 때 선택적 `notes` 한 줄만
메모리에서 `null`로 교체해 다시 읽는다. 원본 파일은 변경하지 않고
결과에 repair 사실을 기록한다.

### 선택 이유

- 대용량 원본 pose 데이터를 잃지 않고 분석할 수 있다.
- 원본을 몰래 수정하지 않아 증거 보존이 가능하다.
- 복구 범위를 optional notes 한 줄로 제한해 잘못된 광범위 자동
  수정을 방지한다.

### 남은 위험과 다음 작업

새 촬영에서는 저장 전에 JSON escaping과 UTF-8 직렬화를 보장해야
한다. notes 이외의 필드가 손상된 파일은 자동 복구하지 않고 오류로
처리한다.

---

## D-009. VP9 WebM 임의 탐색의 불안정성

### 문제

OpenCV가 일부 VP9 WebM에서 특정 timestamp로 바로 이동하는 random
seek를 안정적으로 처리하지 못할 수 있다.

### 해결방안

직접 탐색 실패 시 처음부터 순차 디코딩하는 fallback을 사용한다.

### 선택 이유

정확한 프레임 검수가 속도보다 중요하다. 순차 디코딩은 느릴 수 있지만
잘못된 시간의 프레임을 보여주는 것보다 안전하다.

### 남은 위험과 다음 작업

긴 영상에서는 검수 UI가 느려질 수 있다. 필요하면 업로드 시 seek가
안정적인 MP4 proxy를 생성하되 원본 WebM은 유지한다.

---

## D-010. 정상 반복 annotation과 완료 시점 선택

### 문제

36.3579° full-contraction FSM이 partial false positive를 제거하더라도
정상 반복을 놓치면 production에 사용할 수 없다. 기존 세션 단위
`completeReps = 10`만으로는 각 반복의 TP, FN과 판정 지연을 계산할 수
없었다.

### 해결방안

`curl-normal-pytest-01`의 전체 각도 시계열에서 1초 이후
`processedAngle < 120°`로 시작하는 독립 excursion 10개를 찾았다.
각 cycle의 시작, 최저점, 복귀 프레임을 영상에서 검토하고 10개 모두
`valid_rep`으로 annotation했다.

완료 시점은 production의 `REP_COUNTED` timestamp를 복사하지 않고,
수축 후 captured `processedAngle`이 처음 155° 이상으로 복귀한
시점으로 정의했다.

### 선택 이유

- production 예측 timestamp를 정답으로 사용하면 평가가 순환적이 된다.
- 155°는 현재 운동 설정의 명시적 full-extension 기준이라 재현
  가능하다.
- 시작·최저점·복귀 영상을 함께 확인해 초기 `0°` recorder artifact와
  실제 동작을 구분할 수 있다.
- cycle별 completion이 있어 count 정확도뿐 아니라 판정 지연도 비교할
  수 있다.

### 검증 결과

| 구성 | GT | 예측 | TP | FP | FN | 평균 지연 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Production recorded | 10 | 10 | 10 | 0 | 0 | +168.41ms |
| Exploratory full contraction | 10 | 10 | 10 | 0 | 0 | +193.36ms |

탐색형 FSM은 정상 반복 10개를 모두 유지했으며 이 세션에서 production
대비 평균 판정 지연이 약 25ms 증가했다.

### 남은 위험과 다음 작업

- annotation은 `codex-assisted-review`이며 독립된 두 번째 사람 검수는
  아직 없다.
- 한 사용자와 한 카메라 구도의 정상 세션만 검증했다.
- 다음에는 fast-02를 동일한 completion 정책으로 검수해 빠른 동작의
  TP/FN과 latency를 확인한다.

---

## D-011. 빠른 반복에서 엄격한 수축 기준을 유지할지 검증

### 문제

완전 수축 기준을 36.3579°로 강화하면 빠른 동작이 threshold 아래에
머무는 시간이 짧아져 정상 반복을 놓칠 가능성이 있다. 최초
`curl-fast-01`은 10회 중 1회만 계산됐지만 촬영 구도 실패가 섞여 있어
속도 영향만 판단할 수 없었다.

### 해결방안

필수 관절 valid rate가 99.4%인 `curl-fast-02`를 사용했다. 정상
세션과 동일하게 `processedAngle < 120°` excursion을 찾고, 각 반복의
시작·최저점·복귀 영상 프레임을 검토했다. completion은 수축 후 처음
155° 이상으로 복귀한 captured angle timestamp로 정의했다.

### 선택 이유

- 정상 세션과 동일한 annotation 정책을 사용해야 속도 조건만 비교할
  수 있다.
- 구도가 실패한 fast-01을 제외해 tracking availability와 실제 속도
  robustness를 분리한다.
- production 카운트 timestamp를 completion 정답으로 복사하지 않아
  순환 평가를 피한다.

### 검증 결과

10개 cycle 모두 영상에서 완전 수축과 신전 복귀가 확인됐다. 각
cycle의 최저 각도는 16.06–30.18°였다.

| 구성 | GT | 예측 | TP | FP | FN | 평균 지연 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Production recorded | 10 | 10 | 10 | 0 | 0 | +166.03ms |
| Exploratory full contraction | 10 | 10 | 10 | 0 | 0 | +193.55ms |

탐색형 FSM은 빠른 정상 반복도 모두 유지했으며 production 대비 평균
판정 지연은 약 28ms 증가했다.

### 남은 위험과 다음 작업

- 현재 정상과 빠른 영상은 같은 사용자다.
- 더 빠른 cadence와 다른 사용자의 동작은 아직 검증하지 않았다.
- 다음 우선 검수 대상은 occlusion-01이다. 이 세션에서는 반복 정확도
  외에 tracking failure 구간과 count/reset 관계를 annotation해야 한다.

---

## D-012. 가림과 반복이 겹치는 annotation 표현

### 문제

`curl-occlusion-01`의 2·3번째 반복은 장시간 tracking failure와 시간상
겹친다. 기존 annotation schema는 모든 구간 중복을 금지해 하나의
동작을 `valid_rep`으로 기록하면서 동시에 해당 구간을
`tracking_failure`로 표현할 수 없었다.

### 해결방안

반복·부분 동작 등 동일 계층의 cycle끼리 겹치는 것은 계속 금지한다.
단, 서로 다른 두 구간 중 정확히 하나가 `tracking_failure`인 경우에는
context overlap을 허용한다.

### 선택 이유

- 가림은 운동 cycle을 대체하는 라벨이 아니라 그 cycle에 영향을 주는
  관찰 상태다.
- evaluator는 prediction timestamp가 tracking failure 내부인지
  별도로 계산하므로 두 정보를 동시에 보존해야 한다.
- 모든 overlap을 허용하지 않아 중복 rep annotation 오류는 계속
  차단한다.

### 검증 결과

- 일반 cycle끼리의 overlap: 계속 거절
- `valid_rep`과 `tracking_failure` overlap: 허용
- tracking interval 2개와 valid rep 5개를 같은 annotation 문서로
  schema 검증 완료

### 남은 위험과 다음 작업

현재 schema는 label 하나만 갖는 interval 모델이다. 향후 여러 종류의
context가 늘어나면 cycle과 context를 별도 배열로 분리하는 schema 2.0을
고려한다.

---

## D-013. 가림 중 반복 손실에 대한 정책 선택

### 문제

영상 검수 결과 `curl-occlusion-01`에는 완전 반복 5개가 있다. 그중
2번째 반복은 8259.1–10533.8ms, 3번째 반복은
13711.7–15825.6ms의 의도적 카메라 가림과 겹친다. 두 가림 모두
1초를 넘어 FSM state reset이 발생했다.

두 번째 반복의 시작과 복귀는 보이지만 완전 수축 순간은 가려졌다.
따라서 해당 cycle의 `valid_rep` 판정은 촬영자가 입력한
`completeReps = 5`에 의존한다는 caveat를 annotation과 평가 결과에
명시했다.

### 해결방안

가림 중 반복을 추측해서 복원하지 않는다. 1초 이상 tracking invalid가
지속되면 상태를 초기화하고, 추적이 복구된 뒤 새로운 cycle부터
카운트한다.

### 선택 이유

- 영상 증거가 없는 상태에서 반복을 추정하면 false positive를 만들 수
  있다.
- 운동 기록에서 임의의 추가 카운트보다 “확인하지 못한 반복”을
  사용자에게 알리는 편이 안전하다.
- 현재 제품은 단일 카메라만 사용하므로 가림 중 자세 품질이나 완전
  수축을 검증할 다른 센서가 없다.

### 검증 결과

| 구성 | GT | 예측 | TP | FP | FN | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Production recorded | 5 | 3 | 3 | 0 | 2 | 1.0 | 0.6 |
| Exploratory full contraction | 5 | 3 | 3 | 0 | 2 | 1.0 | 0.6 |

두 FSM 모두:

- tracking failure 중 count: 0
- 가림 밖의 확인 가능한 반복: 3/3
- 가림과 겹친 반복 손실: 2

### 남은 위험과 다음 작업

- 사용자는 실제 5회를 했지만 화면에서는 3회를 보게 된다.
- UI에 “추적 끊김으로 반복을 확인하지 못함” 상태와 재정렬 안내가
  필요하다.
- 36.3579° threshold 변경은 이 문제를 해결하지 않는다. 이것은 FSM
  threshold 문제가 아니라 visual availability 문제다.

---

## D-014. 공개 데이터셋 side-view 샘플의 사용 가능성

### 문제

공개 데이터셋이 실제로 FitFormLive 외부 검증에 적합한지 공식 설명만
보고 결정할 수 없다. 영상 해상도, 사람의 프레임 점유율, 관절 가림,
운동 정의와 현재 고정 오른팔 FSM의 호환성을 실제 샘플에서 확인해야
한다.

### 확인한 샘플

`curl-side-sample.mp4`:

- 길이: 28.87초
- 해상도: 540×960
- FPS: 15
- 구도: 세로형 측면
- 환경: 실내 실제 촬영
- 운동: 한 사람이 덤벨 컬 반복
- 프레임 상태: 머리부터 손과 덤벨까지 지속적으로 화면 안에 있음

1.0–27.4초 구간을 약 2.4초 간격으로 추출해 신전, 수축, 중간 자세가
반복적으로 존재하는 것을 확인했다.

### 해결방안

이 샘플을 외부 영상 처리 파이프라인의 첫 smoke test로 사용한다.
바로 성능 수치에 포함하지 않고 다음 순서로 적합성을 확인한다.

1. 모든 프레임에서 MoveNet pose 추출
2. 좌우 shoulder–elbow–wrist confidence 비교
3. 실제 움직이는 팔 자동 식별
4. elbow angle trace와 cycle 후보 생성
5. 영상 기반 cycle annotation
6. production 및 exploratory FSM 평가

### 선택 이유

- 실제 타인 영상이므로 AI 생성 영상보다 subject generalization 근거가
  강하다.
- 측면 영상은 팔꿈치 굴곡을 시각적으로 확인하기 쉽다.
- 해상도와 프레임 점유율이 충분해 pose 추출 실패 원인을 구도 부족으로
  오인할 가능성이 낮다.
- 15fps이므로 현재 180ms hold는 약 3프레임에 해당한다. 빠른 동작에서
  hold 판정이 프레임률에 민감한지도 함께 드러낼 수 있다.

### 남은 위험과 다음 작업

- 현재 브라우저 코드는 live camera 입력 중심이며 외부 MP4를 batch로
  MoveNet 처리하는 도구가 아직 없다.
- 측면에서 잘 보이는 팔이 현재 고정 `right` joint indices와 다를 수
  있다.
- 영상이 alternating curl인지 single-arm curl인지 전체 cycle
  annotation으로 확정해야 한다.
- 데이터셋 원본의 subject ID, view, good/bad form metadata를 파일과
  함께 provenance로 보존해야 한다.

다음 구현은 외부 MP4를 동일한 MoveNet·validation·FSM 경로에 넣는
offline video inference runner다. 이 runner가 있어야 공개 데이터셋을
단순 참고 영상이 아니라 재현 가능한 외부 평가 입력으로 사용할 수
있다.

---

## D-015. 외부 MP4 inference를 브라우저 TF.js로 구현

### 문제

공개 데이터셋 MP4를 확보해도 기존 앱은 live camera 입력 중심이라
동일한 MoveNet·FSM 경로로 batch 처리할 수 없었다. Python의 다른 pose
모델을 사용하면 현재 production MoveNet의 외부 일반화 검증이
아니게 된다.

### 해결방안

`web/external-video.html`과
`web/js/external-video-analysis.js`를 추가했다.

Runner는:

- MP4/WebM 파일을 브라우저 video element로 decode
- production과 같은 TF.js 4.16.0 MoveNet Lightning 사용
- 지정 FPS로 프레임 sampling
- keypoint를 normalized coordinate로 저장
- 좌우 팔을 각각 validation·EMA·FSM replay
- 좌우 valid rate, confidence, angle ROM, rep count 계산
- production 및 exploratory 결과를 함께 export
- 양팔이 모두 반복 운동하면 한쪽을 임의 선택하지 않고
  `alternating_requires_dual_fsm`으로 표시

### 선택 이유

- production과 동일한 pose model family 및 runtime을 유지한다.
- 외부 영상 평가에서 pose model 차이라는 교란 변수를 만들지 않는다.
- 좌우 팔을 독립 분석해 side view와 alternating curl의 고정 오른팔
  한계를 숨기지 않는다.
- browser file input을 사용해 공개 영상 원본을 서버로 업로드하지
  않고 로컬에서 처리한다.
- threshold를 runner에서 조정하지 않아 external test 동결 원칙을
  지킨다.

### 검증 결과

- moving-arm selection 단위 테스트 3개 통과
- single moving arm 선택 확인
- 양팔 반복 시 dual-FSM 필요 상태 확인
- pose quality 부족 시 자동 거절 확인
- external-video inline JavaScript 문법 검사 통과
- 로컬 HTTP 응답 200 확인
- 전체 JavaScript 41개 테스트 통과
- 전체 Python 23개 테스트 통과

### 남은 위험과 다음 작업

- 실제 `curl-side-sample.mp4` MoveNet 처리는 브라우저 WebGL과 CDN 모델
  로딩이 필요한 수동 smoke test다.
- 처리 결과 JSON을 받은 뒤 좌우 angle trace와 실제 영상 cycle을
  비교해야 한다.
- 양팔이 번갈아 움직인다면 좌우 독립 FSM 결과를 합치는 정책은 별도
  검증 후 결정한다.

---

## D-016. 첫 외부 side-view에서 고정 각도 threshold 실패

### 문제

`curl-side-sample.mp4`를 동일 TF.js MoveNet Lightning으로 처리한 결과,
영상과 angle trace에는 반복 동작이 8개 존재하지만 production과
36.3579° exploratory FSM 모두 0회를 계산했다.

### 측정 결과

- 영상: 28.87초, 540×960, 15fps
- 처리 frame: 434개
- 선택 팔: right
- right valid joint rate: 99.8%
- right mean required-joint confidence: 0.696
- right angle ROM: 약 115.0°
- 8개 excursion 최소 각도 범위: 61.36–66.07°
- production predicted reps: 0
- exploratory predicted reps: 0

### 원인 판단

tracking은 안정적이므로 MoveNet pose 자체가 사라진 문제가 아니다.
측면 시점과 새로운 subject에서 MoveNet이 추정한 완전 수축 각도가
기존 자체 촬영보다 크게 나타났다.

모든 최소각이 production의 `down = 60°`보다 높아 FSM 수축 상태에
진입하지 못했다. 36.3579° full-contraction 기준은 더 엄격하므로
동일하게 실패했다.

### 해결방안

이 smoke-test 영상에 맞춰 threshold를 즉시 변경하지 않는다. 이
샘플은 외부 처리 경로 점검용으로 이미 확인했기 때문에 값을 조정하면
development 데이터가 된다.

다음 공개 subject를 추가로 처리해 다음 가설을 분리한다.

1. side view에서 공통으로 각도가 크게 추정되는 view effect
2. 해당 subject의 실제 ROM 차이
3. 덤벨과 손목 자세에 따른 keypoint geometry 차이
4. 고정 절대 각도 threshold 자체의 일반화 한계

후보 해결책은 external development subjects에서만 비교한다.

- 시작 자세 대비 상대 ROM
- 세션 calibration
- view support policy
- subject-independent percentile 기준

### 선택 이유

- 첫 실패 영상에 threshold를 맞추면 외부 평가의 독립성이 사라진다.
- tracking 품질과 FSM threshold 문제를 분리해야 올바른 해결책을
  선택할 수 있다.
- 실패 결과를 그대로 유지하는 것이 “자체 영상에만 맞춘 threshold”
  가능성을 정직하게 보여준다.
- 한 영상만으로 새로운 production 기준을 정하면 또 다른 과적합이
  된다.

### 검증 결과

외부 MP4 runner의 end-to-end 경로는 성공했다.

```text
MP4 decode
→ TF.js MoveNet 434 frames
→ right arm selection
→ angle trace 8 excursions
→ frozen production/exploratory FSM
→ result JSON export
```

따라서 이번 0회 결과는 runner 실패가 아니라 동결된 threshold의 외부
일반화 실패 증거다.

### 남은 위험과 다음 작업

- 8개 excursion은 angle trace와 overview 영상으로 확인했지만 독립된
  사람의 cycle annotation은 아직 없다.
- 공개 development subject를 최소 3명 더 처리하기 전에는 calibration
  방식을 선택하지 않는다.
- 최종 external test subject는 calibration 설계에 사용한 사람과
  분리해야 한다.

---

## 작업 기록 원칙

## D-017. 외부 front·diagonal 개발 샘플 비교

### 문제

첫 side-view 외부 샘플에서는 오른팔 추적률이 99.8%였지만 production과
exploratory FSM이 모두 0회를 출력했다. 이것이 특정 사람의 ROM, side 구도,
또는 고정 임계값 자체의 문제인지 분리하기 위해 서로 다른 사람의 front와
diagonal 영상을 같은 설정으로 처리할 필요가 있었다.

### 측정 결과

- front: 31.07초, 467 frames, 양팔 교대 동작
- front 왼팔: valid 94.6%, production 7회, exploratory 4회
- front 오른팔: valid 90.6%, production 7회, exploratory 6회
- diagonal: 30.00초, 451 frames, 오른팔 단일 동작
- diagonal 오른팔: valid 100%, 평균 confidence 0.758, ROM 129.97도
- diagonal 오른팔: production 7회, exploratory 0회
- diagonal 오른팔 최소 추정 각도: 49.74도

front 영상은 양팔이 교대로 움직였기 때문에 runner가 한 팔을 임의로 선택하지
않고 `alternating_requires_dual_fsm`으로 분류했다. 이 경우 양팔의 독립 FSM
결과를 합치지 않고 각각 보고해야 한다.

### 원인 판단

현재 production 기준은 두 새 샘플에서 반복 동작을 검출했지만, 36.3579도의
exploratory full-contraction 기준은 front에서 일부를 누락하고 diagonal에서는
전부 누락했다. 따라서 첫 side 샘플의 0회 결과만으로 MoveNet 전체가 외부
영상에서 실패했다고 볼 수 없다. 더 엄격한 절대 수축각이 사람과 구도 변화에
민감하다는 증거가 추가됐다.

front에서 최소 추정 각도가 0도에 가까운 값까지 내려간 것은 실제 해부학적
팔꿈치 각도라기보다 정면 2D 투영에서 어깨·팔꿈치·손목 점이 겹치며 생기는
기하학적 퇴화 가능성이 크다. 따라서 매우 작은 각도를 더 좋은 수축의 증거로
사용하면 안 된다.

### 해결방안

1. production과 exploratory 임계값을 아직 변경하지 않는다.
2. front와 diagonal 영상에 cycle-level 사람 annotation을 추가해 7회라는
   출력이 실제 TP인지 확인한다.
3. 개발 subject를 더 확보해 view별 최소각 분포와 유효 관절률을 비교한다.
4. 이후 절대각 유지, 시작 자세 대비 상대 ROM, 세션 calibration, 지원 view
   제한 중 하나를 개발 데이터에서 결정한다.
5. 최종 성능은 위 결정에 사용하지 않은 별도 external test subject에서 보고한다.

### 선택 이유

- annotation 없이 예측 7회를 정답 7회로 간주하면 자동 예측을 ground truth로
  재사용하는 순환 검증이 된다.
- front의 0도 근처 각도 때문에 threshold를 낮추거나 높이는 것은 2D 투영
  오류에 과적합할 가능성이 있다.
- 현재 결과는 production이 exploratory보다 외부 구도에 강하다는 방향성은
  보여주지만, 두 샘플만으로 일반화 성능 수치를 주장하기에는 부족하다.

### 검증 결과와 남은 위험

- 두 다운로드 JSON은 파싱에 성공했다.
- front의 양팔 분류 및 팔별 FSM 실행이 정상 동작했다.
- diagonal의 움직이는 오른팔 선택과 100% valid rate가 확인됐다.
- 영상별 실제 반복 수에 대한 사람 annotation은 아직 없다.
- front의 극단적인 2D 각도와 view별 추정 편향은 상대 ROM 또는 view policy
  검토가 필요하다는 근거다.

재현 가능한 요약은
`evaluation/python-validation/video-session-comparison/curl-front-diagonal-development-summary.json`
에 저장한다.

---

## D-018. 외부 분석 JSON의 cycle annotation 호환

### 문제

기존 Streamlit annotation 앱은 자체 촬영 schema 1.2 fixture 또는 이미 변환된
JS trace만 지원했다. 새 `external-video-1.0` 결과에는 원본 keypoint frame과
왼팔·오른팔별 production trace가 따로 있어 그대로 업로드하면 trace 형식 오류가
발생했다.

또한 front 샘플은 양팔 교대 동작이므로 자동 선택 팔이 없다. 이를 임의의 한
팔로 축약하면 반대 팔 반복이 누락되고, 두 팔 이벤트를 단순 합치면 팔별
오류와 confidence 차이를 평가할 수 없다.

### 해결방안

- `external-video-1.0` 구조를 판별하는 함수를 추가했다.
- 사용자가 선택한 팔의 production trace를 annotation trace 계약으로 변환한다.
- 원본 frame의 17개 normalized keypoint를 frame index로 다시 결합해 영상
  skeleton overlay를 유지한다.
- front 영상에서는 `Annotation arm`을 명시적으로 선택한다.
- annotation 상태와 파일이 서로 덮어쓰이지 않도록 세션 ID를
  `<testId>-left/right`로 분리한다.
- predicted `REP_COUNTED`는 annotation 후보일 뿐 ground truth로 자동 저장하지
  않는다.

### 선택 이유

- 팔별 trace를 유지하면 alternating curl도 단일-arm FSM 설계를 바꾸지 않고
  평가할 수 있다.
- 원본 keypoint를 결합하면 동일 timestamp의 영상과 pose를 사람이 직접
  확인할 수 있다.
- 예측을 자동 annotation으로 복사하지 않아 순환 검증을 방지한다.
- 별도의 외부 전용 annotation 앱을 만들지 않고 검증된 기존 CRUD, overlap
  검사, P4 evaluator를 재사용한다.

### 검증 결과

- Python 자동 테스트: 25개 통과
- front-left: 467 frames, production events 7개, keypoints 17개
- front-right: 467 frames, production events 7개, keypoints 17개
- diagonal-right: 451 frames, production events 7개, keypoints 17개
- alternating 영상에서 팔을 지정하지 않은 변환은 명시적 오류로 거절
- 잘못된 팔 이름도 사용 가능한 팔 목록과 함께 거절

### 남은 위험과 다음 작업

- 7개 prediction event는 아직 사람이 승인한 7개 ground-truth cycle이 아니다.
- front-left, front-right, diagonal-right를 영상으로 검토해 각각 독립된
  annotation JSON을 내려받아야 한다.
- front의 0도 근처 2D 각도는 overlay에서 관절 겹침 여부를 특히 확인해야 한다.

---

## D-019. 빈 외부 annotation 다운로드 방지

### 문제

front 좌·우와 diagonal 좌·우에서 내려받은 네 annotation JSON을 확인한 결과
세션 ID는 정확했지만 모두 `cycles: []`였다. 팔 선택과 파일 다운로드는
완료됐지만 실제 cycle을 추가하지 않은 상태였다.

기존 UI는 predicted rep 목록과 수동 annotation editor를 떨어뜨려 표시했고,
하단에서 빈 annotation도 정상 파일처럼 다운로드할 수 있었다. 사용자가
predicted rep 7개를 이미 annotation된 결과로 이해하기 쉬운 구조였다.

### 해결방안

- 외부 분석 세션에서는 선택한 팔의 production `REP_COUNTED` 이벤트를 자동으로
  human-review candidate 표에 표시한다.
- 각 candidate는 기본적으로 승인되지 않은 상태이며, 동기화 영상을 확인한 뒤
  `Human approved`를 직접 체크해야 annotation이 된다.
- 승인된 candidate 다운로드는 기존 provenance와 annotator 정보를 유지한다.
- 저장된 cycle이 0개이면 일반 annotation 다운로드 버튼을 비활성화한다.

### 선택 이유

- 7개 prediction을 자동 정답으로 복사하면 순환 검증이 되므로 자동 승인은
  허용하지 않는다.
- 사람이 timestamp를 매번 처음부터 입력하는 대신 prediction을 탐색 시작점으로
  사용하면 검토 부담과 입력 실수를 줄일 수 있다.
- 빈 파일 자체를 막으면 성공처럼 보이는 무효 평가 입력을 조기에 발견할 수 있다.

### 검증 결과와 다음 작업

- 다운로드된 기존 네 파일 모두 schema 1.0 파싱 성공, cycle 수 0개 확인
- Python 자동 테스트 25개 통과
- annotation 앱 재시작 및 health check 통과
- front-left, front-right, diagonal-right에서 각각 7개 candidate를 영상으로
  검토해 새 annotation을 내려받아야 한다.
- diagonal-left는 production event가 0개이고 움직이는 주 운동 팔도 아니므로
  이번 valid-rep 성능 평가 대상에서 제외한다.

---

## D-020. 동일 review candidate 재승인 시 구간 중복

### 문제

이미 annotation에 추가된 production candidate를 UI rerun 후 다시 승인하면 같은
구간을 새 cycle로 추가하려 해 `annotation intervals overlap` 검증 오류가
발생했다. 동일 candidate 승인이 멱등적이지 않은 문제였다.

### 해결방안과 선택 이유

- annotation note의 candidate provenance ID가 같으면 새 항목을 추가하지 않고
  기존 cycle을 갱신한다.
- 이전 데이터처럼 provenance 식별이 불완전하더라도 label, start, end,
  completion이 모두 같으면 동일 cycle로 간주해 갱신한다.
- 전체 overlap 검사를 느슨하게 만들지는 않았다. 서로 다른 candidate의 실제
  중복은 계속 오류로 막아 annotation 품질 검사를 유지한다.

### 검증 결과

- 같은 candidate를 두 번 승인하고 timestamp와 annotator를 수정하는 회귀 테스트 추가
- Python 자동 테스트 26개 통과
- annotation 앱 재시작 및 health check 통과

---

## D-021. 외부 front·diagonal prediction-assisted 검수 결과

### 입력과 검증

Downloads의 가장 최근 `(1)` annotation 세 파일을 사용했다.

- `curl-front-sample-left`: valid rep 7개
- `curl-front-sample-right`: valid rep 7개
- `curl-diagnal-sample-right`: valid rep 7개

모든 cycle은 `human-01`이 production candidate를 영상 검토 후 승인한 것이다.
빈 diagonal-left 파일은 주 운동 팔이 아니며 production candidate도 0개이므로
평가에서 제외했다.

### 결과

500ms event matching에서 세 세션 모두 production 7개와 승인 cycle 7개가
매칭됐다.

- front-left: TP 7, FP 0, FN 0
- front-right: TP 7, FP 0, FN 0
- diagonal-right: TP 7, FP 0, FN 0
- 합계: TP 21, FP 0, FN 0

표면적인 micro precision, recall, F1은 모두 1.0이다.

### 해석 제한

이 annotation은 production candidate에서 시작한 prediction-assisted review다.
사람이 21개 후보를 실제 반복으로 승인했으므로 이 샘플들에서 candidate
precision이 높다는 근거로 사용할 수 있다.

하지만 completion timestamp는 candidate의 prediction timestamp로 초기화됐다.
따라서 계산상 latency 0ms는 독립적인 판정 지연 측정값으로 보고하지 않는다.
또한 production 후보가 없는 구간을 대상으로 한 별도의 전체 영상 negative
search가 기록되지 않았으므로 FN 0과 recall 1.0은 잠정 결과다.

### 선택 이유와 다음 작업

- 승인 사실과 독립 annotation의 범위를 구분해 성능을 과장하지 않는다.
- 현재 결과는 frozen production 기준이 side 한 사람에서는 실패했지만 다른
  front·diagonal 사람에서는 승인된 반복 21개를 검출했다는 view/subject
  민감성 근거로 사용한다.
- 다음에는 prediction overlay를 숨긴 full-video pass로 전체 실제 반복 수와
  독립 completion timestamp를 기록해야 확정 recall과 latency를 보고할 수 있다.

재현 가능한 요약은
`evaluation/python-validation/video-session-comparison/external-front-diagonal-reviewed-evaluation.json`
에 저장한다.

---

## D-022. 추가 side-view 3개에서 frozen FSM 0회

### 입력 호환성 문제와 해결

`curl-side-sample2/3/4.mp4`는 OpenCV에서는 정상 decode됐지만 Chrome 내장
FFmpeg가 `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`로 거절했다. 모델 입력 내용을
바꾸지 않기 위해 원본을 보존하고 해상도, 15fps, 전체 frame 수를 유지한 VP8
WebM 사본을 생성했다.

- sample2: 478 frames, 810×1440, 15fps
- sample3: 491 frames, 810×1440, 15fps
- sample4: 493 frames, 810×1440, 15fps

이 처리는 브라우저 decode 호환성만 바꾸며 MoveNet, keypoint 후처리, FSM
threshold는 기존 frozen 설정을 그대로 사용한다.

### 측정 결과

- sample2-left: valid 95.6%, min 61.37도, ROM 96.65도, production 0
- sample3-left: valid 93.7%, min 90.43도, ROM 68.03도, production 0
- sample4-left: valid 90.3%, min 84.22도, ROM 78.90도, production 0
- 세 샘플 모두 exploratory도 0

평활 angle trace의 진단용 저점은 sample2 4개, sample3 6개, sample4 10개다.
이는 반복 파형의 존재를 확인하기 위한 signal diagnostic이며 사람 승인
ground truth count는 아니다.

### 원인 판단

기존 side1과 sample2는 최소 추정각이 각각 61.36도와 61.37도로 production
60도 경계 바로 밖에 있다. sample3·4는 84~90도보다 아래로 내려가지 않아
단순히 60도를 70도로 완화해도 회복되지 않는다.

관절 valid rate가 네 side 샘플 모두 90% 이상이고 반복 angle excursion이
존재하므로 전체 tracking loss만으로 일관된 0회를 설명하기 어렵다. side-view
2D keypoint geometry, 실제 수행 ROM, 데이터셋의 good/bad-form label이 함께
영향을 줄 수 있다.

### 선택 이유와 다음 작업

- 추가 side 샘플도 실패했으므로 첫 사람 하나에 대한 우연한 경계 실패 가능성은
  낮아졌다.
- 반대로 모든 excursion이 valid full curl이라는 독립 annotation은 없으므로
  production recall 0이라고 즉시 확정하지 않는다.
- `70도 + ROM 100도` 같은 규칙은 sample1은 통과시킬 수 있지만 sample2~4를
  일관되게 회복하지 못하므로 바로 production에 적용하지 않는다.
- source good/bad-form metadata를 확인하고 cycle feature table에서 절대각,
  상대 ROM, 상완 안정성 후보 A~E를 먼저 비교한다.

재현 가능한 요약은
`evaluation/python-validation/video-session-comparison/external-side-development-comparison.json`
에 저장한다.

---

## D-023. v1 MVP를 single-arm diagonal view로 한정

### 문제

현재 production FSM은 웹캠에서 한 사용자의 오른팔 single-arm curl과
front-diagonal에 가까운 구도를 중심으로 개발됐다. 그러나 외부 검증에서는
strict side와 bilateral/alternating front 영상을 섞어 사용해, 알고리즘 버그와
제품 범위 밖 입력 실패가 같은 성능 문제처럼 해석됐다.

### 결정

v1 MVP 지원 범위를 다음으로 고정한다.

- single-arm dumbbell curl
- diagonal camera view
- 왼팔 또는 오른팔 중 명확히 보이는 한 팔
- 반대 팔은 정지
- 운동 팔의 shoulder, elbow, wrist가 지속적으로 보임

strict side, strict front, simultaneous bilateral, alternating bilateral
curl은 비지원 또는 비권장 입력으로 분류한다.

### 데이터 역할

- 자체 normal/fast/partial/occlusion과 external diagonal single-arm은 MVP
  개발·검증 데이터로 사용한다.
- external side 1–4와 bilateral front는 범위 밖 diagnostic set으로 유지한다.
- 범위 밖 결과는 삭제하지 않지만 MVP 성능 지표의 분모에는 포함하지 않는다.

### 선택 이유

- side 네 영상은 90% 이상의 joint valid rate와 반복 파형이 있어도 고정 2D
  절대각 FSM이 0회를 출력해 view dependency를 보여줬다.
- bilateral 동작은 좌우 독립 FSM뿐 아니라 “팔별 횟수와 전체 횟수 중 무엇을
  표시할지”라는 제품 정의가 추가로 필요하다.
- 모든 view를 지원하려는 변경은 calibration, 상대 feature, view policy,
  추가 ground truth를 요구하므로 v1 범위를 넘어선다.
- 현재 실제로 개발·검증한 사용 사례를 명시하는 편이 지원하지 못하는 입력까지
  암묵적으로 약속하는 것보다 검증 가능하고 정직하다.

### 향후 검증과 후속 연구

- 새 MVP 검증 영상은 서로 다른 사용자의 single-arm diagonal 영상만 수집한다.
- 최종 일반화 주장을 위해 threshold를 조정하지 않은 외부 사용자 2–3명을
  추가하는 것을 권장한다.
- side/front bilateral 영상은 더 수집하지 않아도 된다.
- A–E 후보 실험은 MVP 수정이 아니라 view-generalized curl 지원 가능성을
  조사하는 future work로 이동한다.

상세 범위, 데이터 재분류, 촬영 가이드와 포트폴리오 문구는
`docs/MVP_SCOPE_AND_VALIDATION_POLICY.md`에 기록한다.

---

## D-024. single-arm 제한을 target-arm 독립 카운트로 수정

### 문제

D-023은 반대 팔이 정지한 single-arm curl만 지원한다고 정의했다. 그러나
현재 FSM의 실제 평가 입력은 선택한 팔의 shoulder, elbow, wrist이며 반대 팔
keypoint는 직접 사용하지 않는다. 따라서 반대 팔이 움직인다는 이유만으로
alternating diagonal 영상을 제외할 필요는 없다.

또한 공개 Mendeley curl 데이터는 모두 alternating이어서 single-arm 제한을
유지하면 외부 사용자 diagonal 데이터를 활용할 수 없었다.

### 수정된 MVP 계약

- diagonal camera view
- 사용자가 `left` 또는 `right` target arm을 사전에 지정
- 한 팔, 양팔 동시, 양팔 교대 동작 모두 허용
- 선택 팔의 반복만 독립적으로 카운트
- 반대 팔 동작은 무시하되 선택 팔을 가리면 tracking failure로 처리
- 양팔 합계와 세트 단위 카운트는 지원하지 않음

D-024는 동작 형태에 관한 D-023의 single-arm·반대 팔 정지 제한을 대체한다.
strict side/front 비지원 결정은 유지한다.

### 선택 이유

- 제품 출력의 의미가 “선택 팔 반복 수”로 명확하다.
- 기존 오른팔 구현과 외부 runner의 팔별 trace를 재사용할 수 있다.
- alternating 영상에서도 팔별 ground truth와 prediction을 비교할 수 있다.
- 자동으로 결과가 좋은 팔을 고르지 않고 사용자가 target arm을 먼저 지정하면
  평가 편향을 줄일 수 있다.

### 필요한 작업

- 웹캠 UI에 왼팔/오른팔 선택 추가
- targetArm을 세션·fixture·export metadata에 저장
- 팔별 keypoint mapping 중앙화
- 왼팔 fixture와 좌우 대칭 회귀 테스트 추가
- 기존 오른팔 canonical 결과 불변 확인
- external diagonal sample 1–4를 사전 지정 target arm으로 평가

상세 작업 순서와 완료 조건은
`docs/TARGET_ARM_MVP_IMPLEMENTATION_PLAN.md`에 기록한다.

---

## D-025. targetArm을 제품 입력 계약으로 구현하고 diagonal 개발 영상에 사전 등록 적용

### 문제

기존 웹캠 production 경로는 오른팔 keypoint를 사실상 고정 사용했고, 외부 분석기는
움직임이 잘 보이는 팔을 자동 선택했다. 이 상태에서는 왼팔을 선택할 수 없고, 분석
결과를 본 뒤 유리한 팔을 고르는 선택 편향도 생길 수 있었다. 양팔 또는 교대 curl
영상에서 제품이 무엇을 세는지도 불명확했다.

### 해결방안

- `targetArm = left | right`를 세션 입력 계약으로 추가했다.
- 왼팔은 MoveNet 5/7/9, 오른팔은 6/8/10을 사용하도록 mapping을 중앙화했다.
- 웹캠 시작 전에 분석 팔을 선택하며 진행 중에는 선택을 잠근다.
- 선택 팔의 confidence, angle, FSM만 count에 사용한다.
- fixture, recording JSON과 CSV에 `targetArm`을 저장한다.
- 좌우 대칭 synthetic replay와 기존 오른팔 canonical regression을 자동 테스트로
  고정했다.
- 외부 diagonal sample2~4는 결과 확인 전에 모두 anatomical left로 사전 등록했다.

### 선택 이유

제품 출력이 “선택한 팔의 반복 수”로 명확해지고, 한팔·동시 양팔·교대 양팔 입력을
같은 FSM으로 처리할 수 있다. 또한 카메라 가시성을 기준으로 팔을 먼저 고정하므로
카운트 결과에 따른 사후 선택을 막는다. 양팔 합산이나 자동 best-arm 선택은 별도
제품 정의와 평가가 필요하므로 MVP에 포함하지 않았다.

### 검증 결과

- JavaScript 자동 테스트: 16 files, 45 tests 통과
- 좌우 대칭 replay: 양쪽 모두 동일한 angle 규칙과 1회 count 확인
- 기존 오른팔 canonical fixture 결과 유지
- diagonal sample1~4 총 1,917프레임 분석 완료
- 사전 지정 팔 valid joint rate:
  sample1 100.0%, sample2 97.72%, sample3 89.23%, sample4 96.8%
- production 자동 후보:
  sample1 7, sample2 3, sample3 4, sample4 1

sample1의 7개 후보만 이전에 사람 승인이 끝났다. sample2~4의 자동 후보는 ground
truth가 아니므로 precision/recall로 보고하지 않는다. 특히 sample4는 추적률이
96.8%인데도 후보가 1개뿐이므로 독립 cycle 검수로 실제 반복 누락인지, 60도 기준
미통과인지 확인해야 한다. 이 결과만으로 threshold를 변경하지 않았다.

재현 가능한 요약은
`evaluation/python-validation/video-session-comparison/external-diagonal-target-arm-development-comparison.json`
에 저장했다.

---

## D-026. P5 자동 후보 승인과 전체 영상 cycle 검수를 분리

### 문제

production 후보만 승인하면 검출된 반복의 진위는 확인할 수 있지만 후보로 생성되지
않은 실제 반복은 보이지 않는다. 이 상태에서 후보 승인 수를 전체 정답 수로 사용하면
FN이 누락되어 recall이 과대평가된다.

### 해결방안

sample2~4는 `left` 팔을 유지하고 두 단계로 검수한다.

1. `production_rep` 후보를 영상으로 확인하여 실제 반복만 승인한다.
2. 영상을 처음부터 끝까지 독립 검수하여 후보가 없었던 실제 반복을 수동 cycle로
   추가한다.

### 선택 이유

Prediction-assisted review의 속도 이점은 유지하면서 prediction을 ground truth로
순환 정의하는 문제를 막는다. 승인 후보는 FP 판정에, 전체 영상 검수는 FN 판정에
필요하므로 두 단계가 모두 끝나야 precision과 recall을 보고할 수 있다.

### 사전 검증

- sample2 후보 3개, 최소 후보 간격 7,933.3ms
- sample3 후보 4개, 최소 후보 간격 6,800ms
- sample4 후보 1개
- review candidate 및 external video sync 관련 Python 테스트 9개 통과
- annotation 앱 `http://localhost:8501` 응답 확인

상세 검수 순서는 `docs/DIAGONAL_TARGET_ARM_HUMAN_REVIEW.md`에 고정했다.

---

## D-027. 기존 cycle과 겹치는 review candidate를 인접 경계로 제한

### 문제

sample4의 기존 사람 annotation `1050–2590ms`와 production 후보의 자동 구간
`2233.3–4233.3ms`가 겹쳐 `AnnotationDocument` 검증이 실패했다. 후보가 1개일 때
기본 시작점이 완료 시각보다 1,500ms 앞에 잡히는 규칙 때문에 발생했으며, 후보가
하나만 검출된 문제와는 별개의 annotation interval 문제다.

### 해결방안

- 후보 완료 시각이 기존 cycle 뒤에 있으면 후보 시작점을 기존 cycle 종료 경계로
  제한한다.
- 후보 완료 시각이 기존 cycle 안에 있으면 중복 cycle을 만들지 않고 기존
  annotation을 수정하라는 오류를 제공한다.
- `tracking_failure`는 다른 label과 문맥적으로 겹칠 수 있다는 기존 schema 정책을
  유지한다.

### 선택 이유

기존 사람이 정한 구간을 삭제하거나 덮어쓰지 않으면서 인접한 실제 반복을 추가할 수
있다. 완료 시각 자체가 기존 cycle 안에 있는 경우는 동일 반복일 가능성이 크므로
자동 병합보다 사람이 기존 항목을 수정하는 편이 ground truth provenance를 보존한다.

### 검증 결과

- sample4의 `1050–2590ms` + `2233.3–4233.3ms` 재현 테스트 통과
- 후보 완료 시각이 기존 cycle 내부인 중복 방지 테스트 통과
- review candidate 테스트 6개 통과
- Python 전체 테스트 28개 통과

---

## D-028. Completion을 최대 수축점이 아닌 반복 종료 시점으로 정정

### 문제

sample4 수동 annotation 8개에서 `completionMs`가 최대 수축 또는 복귀 도중에
기록됐다. evaluator는 이 값을 production의 `REP_COUNTED` 시각, 즉 수축 후 다시
신전되어 한 반복이 완료된 시각과 비교하므로 기존 값으로는 latency와 event matching이
왜곡된다.

### 해결방안

사람이 지정한 8개 label과 시작점은 유지하고 synchronized angle/video review에서
수축 이후 신전 최고점에 해당하는 시각으로 `endMs`와 `completionMs`를 수정했다.
수정이 자동 보조되었다는 provenance를 각 note에 남기고 원본은 보존했다.

### 선택 이유

FSM의 count event와 ground truth가 동일한 사건인 “한 반복 완료”를 나타내야
event-level TP/FN 및 latency 비교가 성립한다. 최대 수축점은 별도 phase landmark로
저장할 수 있지만 현재 annotation schema의 completion 의미로 사용하지 않는다.

### 검증 결과

- ground truth: 8회
- production prediction: 1회
- TP 1 / FP 0 / FN 7
- precision 1.0 / recall 0.125 / F1 0.2222
- matched event latency: -466.7ms
- annotation schema 검증 및 Python 전체 테스트 28개 통과

수정본은
`evaluation/python-validation/annotations/curl-diagnal-sample4.browser-left.annotations.corrected.json`
에 저장했으며 Downloads에도 같은 이름으로 복사했다.

---

## D-029. P5 diagonal target-arm count-level 개발 평가 완료

### 문제

sample1~3은 production 후보 승인은 있었지만 영상 전체에서 후보가 놓친 target-arm
반복을 확인하지 않으면 recall을 확정할 수 없었다. 반대로 후보 completion timestamp를
그대로 사용해 latency까지 보고하면 prediction과 ground truth가 순환 정의된다.

### 해결방안

- 1초 간격 전체 영상 contact sheet와 synchronized target-arm angle trace를 함께
  사용해 sample1~3의 완성 반복과 영상 끝 미완료 동작을 재검수했다.
- 사람 승인 후보의 label은 유지하고 전체 영상 누락 audit의 provenance를
  `AI-assisted`로 명시했다.
- sample2의 영상 종료 전 미복귀 동작은 `partial_rep`으로 기록했다.
- count-level TP/FP/FN만 P5의 확정 결과로 사용하고 candidate-derived completion의
  0ms latency는 독립 성능 근거에서 제외했다.

### 결과

| Sample | Target | GT | Pred | TP | FP | FN | Recall |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | right | 7 | 7 | 7 | 0 | 0 | 1.000 |
| 2 | left | 3 | 3 | 3 | 0 | 0 | 1.000 |
| 3 | left | 4 | 4 | 4 | 0 | 0 | 1.000 |
| 4 | left | 8 | 1 | 1 | 0 | 7 | 0.125 |
| 합계 | - | 22 | 15 | 15 | 0 | 7 | 0.682 |

aggregate precision은 1.0, recall은 0.6818, F1은 0.8108이다. 오검출은 없지만
FN 7개가 sample4에 집중되어 frozen `60° + 180ms` 조건의 subject/view 민감성을
보여준다. 이 개발 영상들에 맞춰 threshold를 조정하지 않고 최종 subject-disjoint
평가에서는 frozen 설정을 사용한다.

재현 가능한 결과는
`evaluation/python-validation/video-session-comparison/external-diagonal-target-arm-p5-final.json`
에 저장했다.

---

## D-030. P6 포트폴리오 설명을 target-arm 계약과 count-level 근거로 통일

### 문제

README와 초기 계획 문서에 `Right Arm Curl`, 외부 검증 20%, 전체 87%,
single-arm 제한 같은 과거 상태가 남아 있었다. 현재 구현은 좌우 선택 가능한
target-arm 계약이며 P5 개발 평가도 끝났으므로 코드, 결과와 설명이 충돌했다.

### 해결방안

- README 상단에 target-arm 제품 계약, 지원/비지원 view와 P5 표를 배치했다.
- 실행 절차에 해부학적 left/right 선택과 diagonal 촬영 조건을 추가했다.
- 알려진 한계에 sample4의 high-valid-rate/low-recall 사례를 명시했다.
- MVP 정책, 외부 검증 계획과 Python 검증 계획의 오래된 진행 상태를 현재 결과로
  갱신했다.
- 개발 평가와 향후 새로운 subject를 쓰는 frozen holdout 평가를 분리했다.

### 선택 이유

포트폴리오에서 높은 숫자만 제시하기보다 제품 계약, 성공한 sample과 실패한
sample, 검수 provenance를 함께 보여줘야 재현성과 문제해결 과정이 드러난다.
또한 개발 데이터의 결과를 최종 일반화 성능으로 오인하지 않도록 holdout을 별도
후속 단계로 유지한다.

### 검증 기준

- README의 GT/TP/FP/FN 및 aggregate 지표가 P5 JSON과 일치
- 모든 README 상대 링크가 실제 파일을 가리킴
- JavaScript 45개 및 Python 28개 테스트 유지

---

## D-031. README를 결과 중심 포트폴리오 랜딩 페이지로 재구성

### 문제

기존 README는 알고리즘 세부 설명이 순서대로 누적되어 있었지만 첫 화면에서 제품
정의, 핵심 성과와 대표 문제해결을 빠르게 파악하기 어려웠다. 동일 GitHub 계정의
JobOps Radar와 LEED Cost Predictor README와도 정보 구조와 시각적 톤이 달랐다.

### 해결방안

- 중앙 정렬 title·tagline·빠른 이동 링크와 기술 badge를 추가했다.
- 프로젝트 소개 다음에 핵심 결과와 demo를 배치했다.
- 제품 기능, 기술 스택, Mermaid 아키텍처와 실시간/검증 책임 분리를 정리했다.
- 대표 문제해결을 tracking/FSM 분리, target-arm 전환, candidate/GT 분리로
  구성했다.
- P5 표, 검수 provenance, trade-off와 현재 한계를 독립 section으로 유지했다.
- Quick Start, annotation UI와 핵심 문서 링크를 현재 경로에 맞췄다.

### 선택 이유

채용 검토자가 저장소 첫 화면에서 “무엇을 만들었고, 어떻게 측정했으며, 어떤 실패를
발견했는지”를 순서대로 읽을 수 있어야 한다. 장식만 추가하지 않고 두 기존
포트폴리오 README의 공통 구조를 적용해 GitHub 프로필 전체의 일관성을 높였다.

### 검증 기준

- 모든 상대 링크와 image path가 실제 파일을 가리킴
- README의 P5 수치가 최종 JSON과 일치
- GitHub Markdown에서 Mermaid, HTML badge와 table이 유효한 구조
- 기존 팀 참여자와 검증 한계 표기 유지

---

## D-032. 새 사용자 3개 영상을 설정 동결 holdout으로 평가

### 문제

개발용 external diagonal 영상 4개에서 precision 1.0, recall 0.682를 얻었지만,
동일 영상을 검수하고 구현을 완성하는 데 사용했으므로 이 수치를 최종 일반화
성능으로 해석할 수 없었다. 새 영상의 결과를 본 뒤 target arm이나 threshold를
선택하면 사후 과적합 위험도 생긴다.

### 해결방안

- Downloads의 `curl-diagnal-test`, `test2`, `test3`을 별도 holdout으로 고정했다.
- 영상 contact sheet만 보고 추론 전에 세 영상의 target arm을 모두 해부학적
  `left`로 사전 등록하고 파일 hash와 설정을 preregistration JSON에 저장했다.
- MoveNet Lightning, 15fps, confidence 0.4, EMA 0.35, extension 155°, contraction
  60°, hold 180ms를 그대로 사용했다.
- 결과가 낮은 영상을 포함해 세 영상 모두 평가했으며 threshold를 변경하지 않았다.
- 0.5초 및 1초 contact sheet 전체 검수와 target-left angle trace 탐색을 결합해
  실제 완료 cycle을 기록했다.
- trace-assisted completion timestamp는 독립 latency 정답이 아니므로 count-level
  TP/FP/FN만 확정 성능으로 사용했다.

### 결과

| Sample | 동작 | GT | Pred | TP | FP | FN | Recall |
|---|---|---:|---:|---:|---:|---:|---:|
| test1 | bilateral/alternating | 7 | 5 | 5 | 0 | 2 | 0.714 |
| test2 | alternating | 7 | 7 | 7 | 0 | 0 | 1.000 |
| test3 | simultaneous bilateral | 11 | 5 | 5 | 0 | 6 | 0.455 |
| 합계 | - | 25 | 17 | 17 | 0 | 8 | 0.680 |

Aggregate precision은 1.000, recall은 0.680, F1은 0.810이다. test3의
target-left joint valid rate는 82.9%였고, 일부 실제 cycle은 60° 수축 유지나
155° 복귀 상태 전이를 완전히 충족하지 못했다. 개발 평가와 거의 같은
high-precision/limited-recall 패턴이 새 사용자에서도 재현됐다.

### 선택 이유

좋은 결과가 나온 영상만 선택하거나 holdout을 보고 기준을 완화하면 일반화 근거가
약해진다. 낮은 recall을 그대로 보존하면 현재 v1의 실제 계약과 개선 우선순위가
명확해진다. 다음 알고리즘 개선은 이 세 영상을 다시 최종 test로 사용하지 않고
development 데이터로 전환한 뒤, 새로운 holdout을 별도로 확보해야 한다.

재현 가능한 결과는 다음 파일에 저장했다.

- `evaluation/python-validation/video-session-comparison/external-diagonal-holdout-preregistration.json`
- `evaluation/python-validation/video-session-comparison/external-diagonal-target-arm-holdout-final.json`
- `evaluation/python-validation/annotations/curl-diagnal-test*.annotations.holdout.json`

---

## D-033. Annotation 영상 scrub에서 decoder와 최근 frame을 재사용

### 문제

Annotation UI의 slider가 바뀔 때마다 Streamlit이 스크립트를 다시 실행하면서
업로드 영상을 새 임시 파일로 만들었다. `decode_video_frame`도 호출마다
`VideoCapture`를 다시 열었으며, WebM random seek metadata가 불안정하면 frame
0부터 목표 시점까지 다시 순차 디코딩했다. 긴 영상에서 연속 scrub 비용이 영상
길이에 비례해 반복될 수 있었다.

### 해결방안

- 같은 업로드는 SHA-256 key와 안정적인 session 임시 경로를 재사용한다.
- 경로별 열린 `VideoCapture`와 최근 frame을 재사용해 앞으로 이동할 때 현재
  위치부터 계속 디코딩한다.
- 가까운 뒤쪽 이동은 최근 frame cache에서 반환하고, cache 범위 밖으로
  되돌아갈 때만 capture를 다시 열어 seek/fallback을 수행한다.
- 메모리를 제한하기 위해 최대 3개 영상과 영상당 최근 180 frame만 유지한다.
- 다른 업로드로 교체하면 이전 capture를 release하고 임시 파일을 삭제한다.

### 선택 이유와 검증

전체 영상을 메모리에 올리는 방식은 긴 영상에서 비용이 커지고, 매번 random
seek만 사용하는 방식은 Chrome WebM metadata 문제를 해결하지 못한다. 열린
decoder와 bounded recent-frame cache를 함께 사용하면 일반적인 순방향 scrub을
상수 횟수의 open으로 처리하면서 메모리 사용량을 제한할 수 있다.

한 capture에서 `100ms → 200ms → 100ms` 요청을 처리하고 마지막 요청이 cache를
사용하는 단위 테스트를 추가했다. Python 29개와 JavaScript 45개 테스트가 모두
통과했다.

---

앞으로 다음 조건에 해당하는 변경은 이 문서에 기록한다.

- production 카운트 결과가 바뀌는 threshold 또는 FSM 변경
- 평가 방법, ground truth 또는 annotation 정책 변경
- 데이터 저장 형식과 schema 변경
- replay, 동기화 또는 전처리 방식 변경
- 실패 표본을 제외하거나 포함하는 평가 결정
- 사용자 데이터의 자동 복구 또는 변환

각 기록에는 최소한 문제, 해결방안, 선택 이유, 검증 결과와 남은
위험을 포함한다.
