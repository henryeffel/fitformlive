# Phase P5 — Enhanced FSM In-sample Robustness

## 작업 목적

신규 세션을 기록할 수 없는 상황에서 독립 검증을 주장하지 않고, 기존 canonical fixture
안에서 탐색적 완전 수축 FSM이 단일 parameter에만 의존하는지 확인했다.

Python은 configuration grid 생성, JavaScript runner orchestration, 결과 집계와 시각화를
담당한다. 판정 source of truth는 `web/js/pose-enhanced-fsm.js`다.

## 평가 범위

```text
Full contraction threshold: 25° ~ 60°, 1° 간격
Hold time: 0ms ~ 500ms, 10ms 간격
Hysteresis: 8° 고정
Contract start: 60° 고정
Full extension: 155° 고정

총 configuration: 36 × 51 = 1,836개
Fixture: normal, boundary contraction, tracking failure
총 FSM replay: 5,508회
```

Confidence threshold와 invalid reset duration은 F_FULL trace 생성 단계에 결합되어 있어
이번 sweep에서는 변경하지 않았다. 서로 다른 계층의 parameter를 한 실험에서 동시에
바꾸지 않기 위한 선택이다.

## 평가 기준 분리

### 동작 정의 안정성

```text
Normal predicted reps = 13
Boundary predicted reps = 0
```

경계 동작을 거부하면서 기존 canonical 정상 cycle을 추가로 누락하지 않는지 본다.

### 전체 실패 안전성

```text
Normal predicted reps = 13
Boundary predicted reps = 0
Tracking-failure predicted reps = 0
```

동작 정의 개선과 기존 강한 추적 실패 조건의 보수적 무카운트를 동시에 유지하는지 본다.

두 기준을 분리한 이유는 경계 오인식 제거와 tracking failure 안전성이 서로 다른 문제이기
때문이다.

## 결과

### 동작 정의 안정성

```text
안정 configuration: 97 / 1,836
```

대표 안정 범위:

| Hold time | Full contraction threshold 안정 범위 |
| ---: | ---: |
| 100~150ms | 25°~31° |
| 160ms | 32°~44° |
| 170~190ms | 32°~45° |

기존 탐색 설정에 가까운 `36° / 180ms`도 다음을 유지했다.

```text
Normal: 13
Boundary: 0
```

따라서 약 36°가 단 하나의 우연한 점에서만 성립한 것은 아니다. 현재 fixture에서는
`hold 160~190ms`와 `threshold 32~44° 이상`의 인접 범위에서 같은 동작 정의 결과가
나타났다.

이 결과는 `in-sample parameter stability`이며 일반화 또는 독립 검증이 아니다.

### 전체 실패 안전성

```text
안정 configuration: 0 / 1,836
```

Normal 13과 Boundary 0을 만족한 97개 configuration은 모두 tracking-failure fixture에서
1회를 count했다.

반대로 tracking failure를 0으로 억제한 configuration에서는 normal predicted reps가
최대 12회였다.

즉 현재 enhanced FSM의 parameter만 조절해서는 다음 세 조건을 동시에 만족하지 못했다.

```text
Normal 13 유지
+ Boundary 0
+ Tracking failure 0
```

## Tracking-failure 1회 진단

`36° / 180ms`에서 발생한 count:

```text
28,447.3ms FULL_CONTRACTION_CONFIRMED
29,568.8ms REP_COUNTED
구간 내부 STATE_RESET 없음
```

이 event는 reset 직후 동일 동작이 분할된 단순 사례가 아니다. 해당 fixture는 실제 완전
동작 3회를 시도한 강한 추적 실패 세션이므로, 이 1회가 잘못된 count인지 추적이 잠시
회복된 실제 완전 cycle인지 영상 없이 확정할 수 없다.

따라서 `tracking-failure predicted reps = 0`은 기존 보수적 failure-safety proxy로
유지하되, cycle-level ground truth라고 표현하지 않는다.

## 발견한 설계 trade-off

이번 결과는 threshold 튜닝만으로 해결할 수 없는 상호작용을 보여준다.

```text
낮은 threshold + 짧은 hold
→ 정상과 경계 분리에 유리
→ 추적 회복 구간의 완전 ROM cycle을 count할 수 있음

긴 hold
→ tracking failure count 억제
→ 정상 cycle 누락 증가
```

따라서 다음 개선은 threshold 한 점을 더 조정하는 것이 아니다.

검토 대상:

- recovery 직후 일정 시간의 FSM 재무장 조건
- 연속 valid frame 또는 valid duration 조건
- FULLY_CONTRACTED 진입 전 추적 안정성 조건
- cycle 내부 invalid ratio 상한
- 영상 기반 tracking-failure event annotation

단, 신규 영상 없이 규칙을 추가하면 기존 fixture에 과적합될 위험이 있으므로 production
로직은 변경하지 않는다.

## 구현

### JavaScript

`scripts/run-enhanced-fsm-sweep.js`

- canonical fixture 3개 trace 생성
- configuration 목록 순차 실행
- rep, incomplete rejection, reset count 출력
- 동일 configuration의 결정론적 재실행 지원

### Python

`python/src/fitform_eval/robustness.py`

- parameter grid 생성
- Node.js sweep runner 실행
- 동작 정의 안정성과 전체 안전성 분리
- 연속 threshold 범위 탐색
- CSV, JSON, SVG heatmap 생성

## 산출물

```text
evaluation/python-validation/robustness/
  sweep-configurations.json
  sweep-raw-results.json
  robustness-results.csv
  robustness-summary.json
  robustness-heatmap.svg
```

## 테스트

Python:

```text
7 passed
```

JavaScript sweep integration:

```text
동일 configuration 목록 2회 실행 결과 일치
```

전체 JavaScript 테스트는 최종 회귀 검증에서 다시 실행한다.

## 포트폴리오 표현

가능한 표현:

> Python이 생성한 1,836개 parameter 조합을 기존 JavaScript FSM에 재실행해 threshold와
> hold time의 민감도를 분석했습니다. 정상 cycle 유지와 경계 오인식 제거는 인접 범위에서
> 함께 성립했지만, 강한 추적 실패 조건까지 포함하면 세 조건을 동시에 만족하는 조합은
> 없었습니다. 이를 통해 단일 threshold 튜닝의 한계를 확인하고 recovery 이후 재무장
> 조건과 영상 기반 cycle annotation을 다음 검증 과제로 정의했습니다.

사용하면 안 되는 표현:

- 36°가 일반화된 최적 threshold다.
- 1,836개 독립 데이터로 검증했다.
- tracking failure 1회는 false positive다.
- enhanced FSM이 모든 조건에서 기존 FSM보다 우수하다.

