# Phase 12: Rep-event 원인 분석 및 상태 머신 개선 계획

## 1. 작업 목적

Phase 11 ablation에서 후처리 기능을 순차적으로 추가해 다음 결과를
확보했다.

```text
정상: baseline 18회 → full 13회
경계 수축: baseline 4회 → full 3회
추적 실패 구간 count: baseline 9회 → EMA 이후 0회
```

이제 기능 추가 자체보다 다음 질문에 답해야 한다.

> 각 `REP_COUNTED` 이벤트가 어떤 각도 변화와 상태 전이를 거쳐
> 발생했으며, ground truth보다 많은 이벤트는 라벨 구간 문제인지
> 상태 머신 설계 문제인지 구분할 수 있는가?

그래프 생성은 목적이 아니라 이 질문을 검증하는 도구다.

## 2. 계획 변경

### 이전 계획

```text
angle·phase·candidate·reset 시계열 생성
→ 포트폴리오 그래프 작성
```

### 수정 계획

```text
프레임 trace
→ REP_COUNTED 기준 cycle 분할
→ cycle별 관찰 사실 계산
→ 원인 진단 후보 분류
→ 정상/경계 분포 비교
→ 근거가 있을 때만 상태 머신 개선
→ 동일 canonical 입력 재실행
→ 대표 그래프 생성
```

수정 이유는 전체 시계열만 그리면 13개와 3개 카운트의 발생 원인을
설명하기 어렵고, 결과를 보고 임계값을 임의로 맞출 위험이 있기 때문이다.

## 3. 분석 대상

우선 다음 두 결과만 상세 분석한다.

1. `curl-normal-01.derived.json × F_FULL`
2. `curl-boundary-contraction-01.derived.json × F_FULL`

비교 기준으로 A_BASELINE의 rep 위치를 사용할 수 있지만 18개 구성 전체의
trace를 생성하지 않는다.

추적 실패 fixture는 Phase 11에서 confidence와 EMA의 실패 안전성 효과를
확인했으므로 이번 상태 머신 수축 기준 분석의 1차 대상에서 제외한다.

## 4. 프레임 Trace 스키마

각 프레임에 다음 값을 기록한다.

```json
{
  "frameIndex": 812,
  "timestampMs": 12450,
  "rawAngle": 57.2,
  "processedAngle": 61.8,
  "requiredJointMinConfidence": 0.73,
  "valid": true,
  "invalidReason": null,
  "phaseBefore": "ready",
  "phaseAfter": "bottom_hold",
  "candidateBefore": "bottom",
  "candidateAfter": null,
  "candidateStartedAtMs": 12300,
  "candidateAgeMs": 150,
  "angularVelocityDegPerSec": -82.4,
  "timeSinceLastValidMs": 17,
  "trackingInterruptionId": null,
  "repCount": 4,
  "events": ["CONTRACTION_CONFIRMED"]
}
```

`processedAngle`은 현재 구성에서 상태 머신에 실제 입력된 각도다. EMA가
꺼진 구성에서도 같은 스키마를 쓸 수 있도록 `smoothedAngle`이라는 이름은
사용하지 않는다.

## 5. Rep cycle 스키마

`CONTRACTION_CONFIRMED`부터 `REP_COUNTED`까지를 하나의 완료 cycle로 본다.
각 cycle에 다음 값을 계산한다.

- cycle 시작·종료 timestamp
- cycle duration
- contraction candidate·confirmed timestamp
- returning 진입 timestamp
- extension candidate·confirmed timestamp
- raw/processed 최소·최대 각도
- observed ROM
- contraction hold 시간
- extension hold 시간
- invalid 누적시간
- 최대 연속 invalid 시간
- reset 횟수
- tracking recovery 횟수
- 이전 rep과의 간격
- 직전 reset/recovery와 cycle 시작 사이 간격
- 가장 가까운 raw 브라우저 `REP_COUNTED` 라벨 이벤트와의 거리

## 6. 관찰 사실과 진단 후보 분리

다음 값은 직접 측정한 사실이다.

```text
cycle duration
minimum angle
previous rep gap
reset count
time since reset
nearest browser rep event distance
```

다음은 확정 원인이 아니라 진단 플래그로만 저장한다.

```text
possible_short_cycle
possible_reset_induced_split
possible_recovery_induced_split
no_nearby_browser_rep_label
boundary_definition_mismatch
```

초기 경험적 진단 기준:

```text
shortCycleMs: 1000
postResetWindowMs: 1000
postRecoveryWindowMs: 1000
nearbyBrowserRepToleranceMs: 500
```

이 기준들은 count를 제거하는 판정 규칙이 아니다. 원인 조사 대상을
자동 표시하기 위한 값이며 최적값으로 주장하지 않는다.

## 7. 정상 13회 분석 가설

다음 가설을 데이터로 구분한다.

1. Canonical 구간에 준비·종료 동작이 포함된 라벨 구간 불일치
2. invalid reset 이후 동일 물리 동작이 새 cycle로 분리
3. 두 임계값을 실제로 반복 왕복한 추가 동작
4. 짧은 보조 동작을 별도 rep으로 정의한 운동 정의 불일치
5. 아직 분류할 수 없는 원인

Raw 브라우저 rep 이벤트 10개와 canonical F_FULL 이벤트 13개의 시간 거리를
함께 저장하되, 임의 tolerance로 정답에 맞춰 이벤트를 제거하지 않는다.

## 8. 경계 수축 분석과 상태 머신 개선 조건

현재 수축 임계값은 60도이고 경계 fixture 최소 각도는 약 44도다. 현재
코드 정의에서는 카운트가 발생하는 것이 자연스럽지만 ground truth는 완전
동작 0회다. 이는 알고리즘 임계값과 라벨의 완전 수축 정의가 충돌한다.

후보 개선:

```text
EXTENDED
→ angle <= contractStartAngle: CONTRACTING
→ angle <= fullContractAngle: FULLY_CONTRACTED
→ angle >= fullExtendAngle: rep + 1
```

그러나 `fullContractAngle`을 20~30도로 미리 확정하지 않는다.

다음 조건을 먼저 확인한다.

1. 정상 13개 cycle의 최소 각도 분포
2. raw 브라우저 라벨과 가까운 정상 cycle의 최소 각도 분포
3. 경계 3개 cycle의 최소 각도 분포
4. 두 집단을 분리하는 각도 구간이 실제로 존재하는지

분리 가능한 경우에만 3-state FSM을 구현한다. 분리되지 않으면 다음
대안을 비교한다.

- 최소 observed ROM
- 최소 cycle duration
- rep refractory period
- 각도 움직임 방향

## 9. 시각화

### 전체 세션 개요

- raw angle
- processed angle
- 60도 수축선
- 155도 이완선
- rep event marker
- invalid 영역
- reset marker

### Rep-event 확대

진단 후보 cycle의 `REP_COUNTED ± 2초`를 표시한다.

- threshold 통과
- candidate와 confirmed
- invalid/reset/recovery
- 이전 rep과 간격

포트폴리오에는 전체 그래프 1개와 대표 확대 그래프 1~2개만 사용한다.

## 10. 완료 기준

1. 모든 F_FULL `REP_COUNTED` 주변 프레임 trace 추출
2. 정상 13개와 경계 3개 cycle 진단값 생성
3. 관찰 사실과 suspected 원인 분리
4. 라벨 구간 문제와 알고리즘 정의 문제 구분
5. 정상/경계 최소 각도 분포 비교
6. 근거가 있을 때만 3-state FSM 또는 대안 구현
7. 동일 canonical 입력에서 개선 전·후 재검증
8. 전체 및 대표 확대 그래프 생성
9. 결과 JSON/CSV와 문서 저장

## 11. 구현 결과

### 생성된 분석 데이터

다음 명령으로 F_FULL trace, cycle CSV와 요약 JSON을 생성한다.

```powershell
npm.cmd run rep:analyze
```

결과:

```text
evaluation/rep-analysis/
├─ curl-normal-01--F_FULL.trace.json
├─ curl-normal-01--F_FULL.cycles.csv
├─ curl-boundary-contraction-01--F_FULL.trace.json
├─ curl-boundary-contraction-01--F_FULL.cycles.csv
└─ summary.json
```

총 16개 완료 cycle을 생성했다.

- 정상 F_FULL: 13 cycles
- 경계 수축 F_FULL: 3 cycles

각 trace에는 raw/processed angle, confidence, valid 상태, phase before/after,
candidate, 각속도, tracking interruption, reset/recovery와 rep 이벤트가
포함된다.

### 브라우저 라벨 정렬

정상 canonical cycle 13개와 raw 브라우저 `REP_COUNTED` 이벤트 10개를
timestamp 순서를 보존한 최소 거리 정렬로 연결했다.

이 정렬은 tolerance를 조정해 원하는 결과를 만드는 방식이 아니다.
10개 라벨을 13개 cycle에 중복 없이 단조 정렬하고 남는 cycle을 진단
대상으로 표시한다.

정렬되지 않은 cycle:

| Rep | Count 시점 | 최소 각도 | ROM | 이전 rep 간격 | Cycle 내부 reset |
|---|---:|---:|---:|---:|---:|
| 7 | 46.52초 | 13.3° | 147.7° | 13.59초 | 0 |
| 8 | 49.27초 | 13.0° | 149.3° | 2.75초 | 0 |
| 9 | 55.02초 | 16.6° | 144.9° | 5.75초 | 0 |

세 cycle은 다음 특징을 가진다.

- 모두 60도 수축 기준을 크게 통과
- 모두 155도 이완 기준까지 복귀
- 정상 라벨 cycle과 유사한 145도 이상의 ROM
- cycle 내부 reset 없음
- 1초 미만 short cycle 아님
- 단순 임계값 주변 진동으로 설명할 수 없는 완전한 왕복

따라서 현재 증거로는 다음 원인을 지지하지 않는다.

- 짧은 threshold jitter
- invalid reset 직후 동일 cycle 분할
- 불완전 ROM의 잘못된 카운트

가장 강한 진단은 다음이다.

> Canonical movement window에는 raw 브라우저 라벨 10회에 포함되지 않은
> 세 번의 완전 범위 관절 왕복이 존재한다.

이것이 실제 추가 운동, 테스트 중간의 재시도 또는 라벨 활성 구간 차이인지는
영상 없이 확정할 수 없다. 따라서 `label-window mismatch` 진단으로
분류하고 알고리즘 false positive로 단정하지 않는다.

### Recovery 플래그 해석

confidence 흔들림이 많아 대부분의 cycle 시작 전 1초 안에 짧은 recovery가
존재한다. 이 플래그만으로 원인을 설명할 수 없다.

정상 unmatched cycle은 reset과 short-cycle 증거가 없고 충분한 ROM을
가지므로 recovery 근접성은 동반 현상으로 기록하고 확정 원인으로 사용하지
않는다.

## 12. 경계 수축 원인

경계 fixture의 F_FULL cycle:

| Rep | 최소 각도 | 최대 각도 | ROM | Cycle duration |
|---|---:|---:|---:|---:|
| 1 | 57.9° | 160.7° | 102.8° | 1.46초 |
| 2 | 43.8° | 162.0° | 118.2° | 1.69초 |
| 3 | 46.6° | 159.1° | 112.6° | 0.99초 |

세 cycle 모두 현재 완전 수축 기준인 60도를 통과하고 155도 이상으로
복귀했다. 현재 상태 머신 정의에서는 세 번 모두 카운트되는 것이
일관된 결과다.

그러나 ground truth는 완전 동작 0회다. 따라서 직접 원인은 다음과 같다.

> 60도를 수축 진입과 완전 수축 기준으로 동시에 사용한 코드 정의가
> 사람이 부여한 완전 동작 라벨과 일치하지 않는다.

이 문제는 confidence, hysteresis나 hold time만으로 해결되지 않았다.

## 13. 정상/경계 각도 분포

브라우저 라벨에 단조 정렬된 정상 10개 cycle의 최소 processed angle:

```text
16.2° ~ 28.9°
```

경계 3개 cycle의 최소 processed angle:

```text
43.8° ~ 57.9°
```

현재 데이터에서는 두 범위 사이에 14.9도의 간격이 존재한다.

탐색적 `fullContractAngle` 후보는 두 경계의 중간값으로 계산했다.

```text
normal upper bound: 28.90°
boundary lower bound: 43.82°
candidate midpoint: 36.36°
```

36.36도는 현재 두 fixture에서 계산한 탐색적 값이며 최적값이나 일반 사용자
기준으로 주장하지 않는다. 별도 검증 데이터 없이 브라우저 production
설정에 적용하지 않는다.

## 14. 상태 머신 개선

기존:

```text
READY
→ angle <= 60°: contracted
→ angle >= 155°: rep counted
```

탐색적 개선:

```text
EXTENDED
→ angle <= 60°: CONTRACTING
→ angle <= 36.36° + hold: FULLY_CONTRACTED
→ angle 상승: RETURNING
→ angle >= 155° + hold: rep counted
```

내부 구현은 진입, 완전 수축과 복귀를 명시하기 위해 네 phase를 사용한다.
사용자 관점의 세 milestone은 extended, full contraction, extended return이다.

동일 canonical 입력 재실행 결과:

| Fixture | 기존 F_FULL | 개선 FSM | 변화 |
|---|---:|---:|---:|
| 정상 | 13 | 13 | 0 |
| 경계 수축 | 3 | 0 | -3 |

경계 수축에서는 세 cycle 모두 `INCOMPLETE_CONTRACTION_REJECTED`로
처리됐다. 정상의 unmatched 세 cycle은 최소 각도가 13.0~16.6도로
완전 수축 후보까지 통과하므로 그대로 13회다.

이 결과는 두 문제를 분리한다.

1. 경계 3회: 완전 수축 정의를 분리해 해결 가능한 상태 머신 문제
2. 정상 추가 3회: 실제 데이터에 완전 ROM 왕복이 존재하는 라벨 구간 문제

정상 결과를 10회에 맞추기 위해 refractory period나 임의 구간 제거를
추가하지 않았다.

## 15. 그래프

다음 명령으로 결정론적 SVG 차트를 생성한다.

```powershell
npm.cmd run rep:charts
```

생성 결과:

- `evaluation/rep-analysis/charts/curl-normal-01--overview.svg`
- `evaluation/rep-analysis/charts/curl-boundary-contraction-01--overview.svg`
- `evaluation/rep-analysis/charts/normal-unmatched-rep--zoom.svg`
- `evaluation/rep-analysis/charts/boundary-rep--zoom.svg`

차트에는 raw/processed angle, 60도·155도 threshold, invalid 영역, reset과
rep marker가 포함된다. SVG XML 유효성 검사도 수행했다.

## 16. 자동 검증 결과

```text
Test Files  8 passed (8)
Tests       28 passed (28)
SVG XML valid: 4
```

추가 테스트:

- 13 cycles와 10 labels의 단조·중복 없는 정렬
- 정상에서 정렬되지 않은 cycle 3개 고정
- 정상과 경계 최소 각도 범위 분리 확인
- 개선 FSM에서 정상 13회 유지
- 개선 FSM에서 경계 3회 → 0회

## 17. 포트폴리오용 결론

> Ablation 이후 정상 fixture에는 13회, 경계 수축 fixture에는 3회의
> 추가 카운트가 남았습니다. 모든 rep 이벤트를 cycle로 분해해 최소 각도,
> ROM, reset과 raw 브라우저 라벨을 비교했습니다. 정상의 추가 세 cycle은
> 145도 이상의 완전 ROM과 충분한 시간 간격을 가져 임계값 진동이나 reset
> 분할이 아니라 라벨 활성 구간 밖의 실제 관절 왕복으로 분류했습니다.
> 반면 경계 cycle은 43.8~57.9도까지 수축해 기존 60도 기준을 통과했지만
> 완전 동작 라벨은 0회였습니다. 수축 진입과 완전 수축 기준을 분리한
> 상태 머신을 동일 입력에 재실행해 정상 결과는 유지하면서 경계 오인식을
> 3회에서 0회로 줄였습니다.

반드시 함께 명시할 제한:

- 개선 threshold는 현재 fixture에서 도출한 탐색적 후보
- 독립 검증 fixture가 없어 일반화 성능을 주장하지 않음
- 정상 추가 세 cycle의 물리적 의미는 영상 부재로 확정할 수 없음
- canonical 결과와 browser end-to-end 결과는 별도 증거

## 18. 다음 작업

1. Phase 11 ablation 표와 Phase 12 대표 그래프를 포트폴리오 Evidence에 반영
2. 상태 머신 변경은 탐색 기능 플래그로 유지
3. 최종 배포 전 schema 1.1 정상 fixture로 threshold 후보 독립 검증
4. 검증 전에는 production 기본 임계값을 변경하지 않음

## 19. 포트폴리오 Evidence 반영

Phase 12 결과를 `portfolio/index.html`의 Evidence 섹션에 반영했다.

### 그래프 변경

경계 수축 확대 그래프에 다음 정보를 추가했다.

- 60도 `contraction start`
- 약 36.4도 `Exploratory full contraction`
- 155도 `full extension`
- 기존 FSM `Legacy: REP_COUNTED`
- 개선 FSM `Improved: REJECTED`

같은 관절 입력과 시간축에서 상태 정의만 바뀌었다는 점을 직접 비교할 수
있다. 포트폴리오 본문에서는 과도한 정밀도를 피하기 위해 `약 36°`로
표현하고, 그래프와 상세 결과에만 36.36도 계산값을 남겼다.

### Evidence 정보 구조

```text
축약 ablation 표
→ 경계 수축 확대 그래프
→ 기존/개선 FSM 비교
→ 동일 입력 재실행 결과
→ 정상 전체 개요와 unmatched R7 확대
→ 일반화 한계
```

포트폴리오용 ablation 표는 면접관이 빠르게 읽을 수 있도록 다음 지표만
표시한다.

- 정상 절대 오차
- 경계 오인식
- 추적 실패 구간 count

6개 전체 구성과 모든 진단 지표는 Phase 11 문서와
`evaluation/ablation/` 결과에 보존한다. Hysteresis는 현재 fixture에서
최종 횟수 변화가 없어 축약 표에서는 제외했지만 원본 실험에서 삭제하지
않았다.

### 표현 원칙

포트폴리오에서는 다음처럼 표현한다.

> 개선 FSM은 기존 canonical 정상 cycle 13개를 추가로 누락시키지 않으면서
> 경계 수축 오인식을 3회에서 0회로 줄였다.

다음 표현은 사용하지 않는다.

```text
정상 정확도가 13회로 개선됐다.
약 36°가 최적 threshold다.
정상 추가 3회가 모두 알고리즘 duplicate다.
```

### Production 상태

탐색 FSM은 분석·비교 모듈에만 구현했다. 독립 schema 1.1 fixture 검증 전에는
브라우저 production 기본 상태 머신과 임계값을 변경하지 않는다.
