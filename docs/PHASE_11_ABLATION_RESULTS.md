# Phase 11: Canonical Fixture Ablation 결과

## 1. 작업 목적

동일한 실제 관절 입력과 동일한 초기 상태에서 후처리 기능을 한 단계씩
추가해 누적 파이프라인의 결과 변화를 비교한다.

이 실험은 각 기능의 완전히 독립적인 인과 효과를 증명하는 factorial
experiment가 아니다. 한 번에 기능 하나만 추가해 현재 누적 파이프라인
안에서의 한계 효과를 관찰한다.

권장 설명:

> 고정된 실제 관절 입력에 후처리 요소를 한 단계씩 추가해 누적
> 파이프라인의 횟수 오차, 부분 동작 오인식과 추적 실패 안전성 변화를
> 비교했다.

## 2. 고정 조건

모든 실험은 다음 조건을 공유한다.

- 같은 canonical fixture
- 같은 normalized 관절 좌표와 timestamp
- 초기 phase `READY`
- 초기 rep `0`
- 초기 EMA `null`
- 같은 팔꿈치 각도 임계값: 수축 60도, 이완 155도
- 같은 canonical source SHA
- 기능 플래그 외 설정 동일

Canonical fixture는 회귀와 ablation 입력이다. 브라우저 end-to-end 정확도
결과로 표현하지 않는다.

## 3. 실험 구성

| ID | Confidence/범위 검사 | EMA | Hysteresis | Hold time | Invalid reset |
|---|---:|---:|---:|---:|---:|
| A_BASELINE | X | X | X | X | X |
| B_VALIDATION | O | X | X | X | X |
| C_SMOOTHING | O | O | X | X | X |
| D_HYSTERESIS | O | O | O | X | X |
| E_STABLE_FSM | O | O | O | O | X |
| F_FULL | O | O | O | O | O |

### Baseline 정의

Baseline은 필수 관절의 좌표가 유한한지만 검사한다. confidence 점수와 화면
범위는 사용하지 않는다.

```text
READY에서 angle <= 60
→ 수축 확정

수축 이후 angle >= 155
→ rep + 1
```

숨겨진 시간 debounce, EMA, 히스테리시스와 무효 구간 초기화는 없다.

### 단계별 해석 범위

- A → B: confidence 및 화면 범위 validation 추가 효과
- B → C: EMA 추가 효과
- C → D: hysteresis 추가 효과
- D → E: hold time 추가 효과
- E → F: 장시간 invalid 상태 초기화 추가 효과

기능 간 상호작용이 있으므로 이 차이를 다른 구성과 무관한 독립 효과로
일반화하지 않는다.

## 4. 구현

### 공유 엔진

`web/js/pose-ablation.js`에 다음을 구현했다.

- 6개 기능 플래그 구성
- 공통 frame validation
- 선택적 EMA
- 선택적 hysteresis와 hold time
- 선택적 invalid reset
- 표준 상태 이벤트
- 조건별 해석 지표

표준 이벤트:

```text
CONTRACTION_CANDIDATE
CONTRACTION_CONFIRMED
STATE_CHANGED
REP_COUNTED
STATE_RESET
TRACKING_RECOVERED
```

### Runner

다음 명령으로 3 fixture × 6 configuration, 총 18개 결과를 생성한다.

```powershell
npm.cmd run ablation:run
```

결과 위치:

```text
evaluation/ablation/
├─ fixture--configuration.json
├─ summary.json
└─ summary.csv
```

각 조합은 두 번 실행하고 이벤트를 포함한 전체 결과의 SHA-256을 비교한다.
두 hash가 다르면 runner가 실패한다.

## 5. 전체 결과

### 정상 canonical fixture

Ground truth: 10

| 구성 | Predicted | 절대 오차 | 전이 | 후보/확정 | Reset |
|---|---:|---:|---:|---:|---:|
| A Baseline | 18 | 8 | 54 | 18/18 | 0 |
| B Validation | 16 | 6 | 50 | 17/17 | 0 |
| C Smoothing | 16 | 6 | 50 | 17/17 | 0 |
| D Hysteresis | 16 | 6 | 50 | 17/17 | 0 |
| E Stable FSM | 15 | 5 | 47 | 16/16 | 0 |
| F Full | 13 | 3 | 47 | 17/17 | 4 |

해석:

- Validation 추가로 초과 카운트가 18회에서 16회로 감소했다.
- EMA와 hysteresis는 이 fixture의 최종 횟수를 바꾸지 않았다.
- Hold time 추가 후 15회로 1회 감소했다.
- Invalid reset 추가 후 13회로 2회 감소했다.
- 전체 구성도 ground truth보다 3회 많다. 현재 임계값과 canonical 구간에서
  완전히 해결되지 않은 중복 전이가 존재한다.

Invalid reset은 후보·확정 수를 단순히 감소시키지 않았다. 진행 중 상태를
READY로 되돌리면서 새로운 수축 후보가 생길 수 있으므로 이벤트 시계열을
함께 봐야 한다.

### Boundary contraction fixture

Ground truth: 완전 동작 0

| 구성 | Predicted | 부분 동작 오인식 | 전이 | 후보/확정 | Reset |
|---|---:|---:|---:|---:|---:|
| A Baseline | 4 | 4 | 12 | 4/4 | 0 |
| B Validation | 4 | 4 | 12 | 4/4 | 0 |
| C Smoothing | 3 | 3 | 9 | 3/3 | 0 |
| D Hysteresis | 3 | 3 | 9 | 3/3 | 0 |
| E Stable FSM | 3 | 3 | 9 | 3/3 | 0 |
| F Full | 3 | 3 | 9 | 3/3 | 1 |

해석:

- Validation만으로는 경계 수축 오인식이 감소하지 않았다.
- EMA 추가 후 오인식이 4회에서 3회로 줄었다.
- Hysteresis, hold time과 invalid reset은 최종 횟수를 추가로 바꾸지 않았다.
- 최소 각도가 약 44도이므로 이 데이터는 명확한 70~100도 부분 컬이 아니라
  수축 임계값 민감도 사례다.
- 전체 구성에서도 부분 동작 false positive 3회가 남아 있다.

EMA가 항상 정확도를 개선한다고 일반화하지 않는다. 이 fixture에서는
감소했지만 정상 fixture의 최종 횟수에는 영향이 없었다.

### Tracking failure fixture

Ground truth metadata: 완전 동작 3, 유효 관절률 12.4%

| 구성 | Predicted | 절대 오차 | 추적 실패 구간 내 Count | Recovery | Reset |
|---|---:|---:|---:|---:|---:|
| A Baseline | 11 | 8 | 9 | 0 | 0 |
| B Validation | 3 | 0 | 2 | 44 | 0 |
| C Smoothing | 2 | 1 | 0 | 44 | 0 |
| D Hysteresis | 2 | 1 | 0 | 44 | 0 |
| E Stable FSM | 1 | 2 | 0 | 44 | 0 |
| F Full | 1 | 2 | 0 | 44 | 9 |

해석:

- Baseline은 confidence를 무시해 추적 실패 구간에서 9회를 카운트했다.
- Validation은 전체 카운트를 11회에서 3회로 줄였지만, raw event 기준
  tracking interruption 내부에서 2회가 발생했다.
- EMA부터 tracking interruption 내부 count가 0이 됐다.
- Hold time은 전체 카운트를 2회에서 1회로 줄였다.
- Invalid reset은 최종 횟수를 추가로 줄이지 않았지만 9번의 상태 초기화를
  명시적으로 수행했다.

B Validation의 predicted 3과 ground truth 3이 같다는 사실만으로 성공이라고
판정하지 않는다. 그중 2회가 추적 실패 구간에 있어 우연한 횟수 일치일 수
있다. 이 조건에서는 absolute error보다 실패 구간 오카운트와 reset 동작이
핵심이다.

F Full이 3회를 맞히지 못한 것도 일반 정확도 실패로만 해석하지 않는다.
관절 입력의 87.6%가 무효인 강한 추적 붕괴 조건에서 안전하게 상태를
초기화하고 잘못된 카운트를 억제하는 trade-off가 있다.

## 6. 구성별 관찰 요약

### Confidence validation

- 정상: 2회 감소
- Boundary: 변화 없음
- Tracking failure: 11회에서 3회로 감소

추적 붕괴 안전성에 가장 큰 변화가 있었다.

### EMA

- 정상: 변화 없음
- Boundary: 1회 감소
- Tracking failure: 1회 감소 및 실패 구간 count 2 → 0

효과가 조건별로 다르며 단순한 전역 개선으로 표현하지 않는다.

### Hysteresis

세 fixture에서 predicted reps 변화가 없었다. 이것은 기능이 불필요하다는
증거가 아니라 현재 입력과 임계값에서 최종 횟수에 추가 효과가 관찰되지
않았다는 의미다. 각도 경계의 짧은 진동을 별도로 분석해야 실제 역할을
평가할 수 있다.

### Hold time

- 정상: 1회 감소
- Boundary: 변화 없음
- Tracking failure: 1회 감소

짧은 임계값 통과를 억제했을 가능성이 있다. 후보와 확정 timestamp의
시계열 분석이 후속으로 필요하다.

### Invalid reset

- 정상: 2회 감소, reset 4회
- Boundary: 횟수 변화 없음, reset 1회
- Tracking failure: 횟수 변화 없음, reset 9회

Invalid reset의 주요 가치는 항상 횟수를 줄이는 것이 아니라 추적 중단 후
진행 중 상태를 폐기해 안전한 READY 상태로 복귀시키는 데 있다.

## 7. 지표 해석 주의사항

- `predicted > ground truth`를 모두 duplicate count로 확정하지 않는다.
- 정상 fixture에서는 `possibleDuplicateCounts`로 표시한다.
- Boundary fixture count는 `partialMotionFalsePositives`로 표시한다.
- Tracking fixture에서는 `countsDuringTrackingFailure`와 reset을 우선한다.
- Canonical ground truth는 참고 라벨이며 브라우저 end-to-end 정확도와
  동일한 의미가 아니다.
- 6개 누적 구성은 완전한 factorial experiment가 아니다.

## 8. 자동 검증

다음을 자동 테스트한다.

- 구성 6개 존재
- 인접 구성 사이 기능 플래그 하나만 변경
- Baseline이 낮은 confidence를 허용하되 비수치 좌표는 제외
- fixture × configuration 결과 hash 결정론
- `repCountEvents === predictedReps`
- F_FULL의 predicted reps와 valid/invalid frame 수가 기존 replay와 일치

검증 결과:

```text
Test Files  7 passed (7)
Tests       26 passed (26)
Ablation results 18/18 deterministic
```

## 9. 포트폴리오용 핵심 문장

> 동일한 실제 관절 시계열에 confidence 검사, EMA, 히스테리시스, 유지시간과
> 무효 구간 초기화를 한 단계씩 추가해 누적 파이프라인을 비교했습니다.
> 정상 fixture의 절대 횟수 오차는 단순 임계값 baseline의 8회에서 전체
> 구성의 3회로 감소했습니다. 강한 추적 실패 fixture에서는 baseline이
> 추적 실패 구간에서 9회를 카운트한 반면, EMA 이후 구성은 해당 구간
> 카운트를 0회로 억제했습니다. 반면 hysteresis는 현재 세 fixture에서
> 최종 횟수 변화가 없어 입력 조건과 기능 효과의 한계도 함께 기록했습니다.

이 문장은 canonical 입력 기반 누적 비교 결과로만 사용한다.

## 10. 다음 작업

1. configuration별 angle·phase·candidate·reset 시계열 데이터 생성
2. 정상과 boundary fixture의 추가 전이 원인 구간 식별
3. 결과 표와 핵심 시계열 그래프를 포트폴리오 Evidence 섹션에 반영
4. 최종 배포 전 schema 1.1 정상 및 복구 fixture로 end-to-end parity 확인

Rep-event 원인 분석과 탐색적 상태 머신 개선은
`docs/PHASE_12_REP_EVENT_ANALYSIS_PLAN.md`에 완료 결과까지 기록했다.
