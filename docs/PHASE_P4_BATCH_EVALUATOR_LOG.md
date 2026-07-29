# Phase P4 — Cycle-level Batch Evaluator

## 작업 목적

여러 세션의 cycle-level ground truth와 JavaScript 판정 이벤트를 자동 비교하는 Python
평가 엔진을 구현했다.

현재 동기화된 실제 영상 annotation은 없으므로 엔진과 입출력 계약은 합성 데이터로
검증했다. 이번 결과는 실제 사용자 성능 수치가 아니다.

## 평가 입력

### Annotation

```json
{
  "schemaVersion": "1.0",
  "sessionId": "subject-01_normal-01",
  "cycles": [
    {
      "startMs": 500,
      "endMs": 1200,
      "completionMs": 1100,
      "label": "valid_rep",
      "annotator": "human-01"
    }
  ]
}
```

지원 label:

```text
valid_rep
partial_rep
preparation
repositioning
tracking_failure
ambiguous
```

검증 규칙:

- start/end 순서
- valid rep의 completion timestamp 존재
- completion timestamp가 cycle 구간 내부인지 확인
- annotation 구간 중복 검사
- session ID 일치

### Prediction

```json
{
  "sessionId": "subject-01_normal-01",
  "algorithmVersion": "git-sha",
  "configurationId": "F_FULL",
  "events": [
    {
      "timestampMs": 1160,
      "type": "REP_COUNTED",
      "rep": 1
    }
  ]
}
```

### Batch Manifest

```json
{
  "schemaVersion": "1.0",
  "dataProvenance": "human-annotated",
  "sessions": [
    {
      "sessionId": "subject-01_normal-01",
      "condition": {
        "movementSpeed": "normal",
        "tracking": "stable"
      },
      "annotations": "normal.annotations.json",
      "predictions": "normal.predictions.json"
    }
  ]
}
```

`dataProvenance`를 결과 summary에 그대로 기록해 합성 데이터와 실제 annotation을
구분한다.

## Event Matching 규칙

GT `completionMs`와 예측 `REP_COUNTED timestampMs`를 tolerance window 안에서
대응시킨다.

```text
GT completion event
↕ ± tolerance
Predicted REP_COUNTED event
```

단순 nearest-neighbor greedy matching을 사용하지 않았다.

순서를 보존하는 동적 계획법으로 다음을 우선한다.

1. 전체 matched event 수 최대화
2. matched 수가 같으면 총 절대 latency 최소화
3. 하나의 GT와 prediction은 한 번만 사용

이 규칙은 가까운 첫 event를 선택해 뒤의 valid match를 잃는 문제를 방지한다.

현재 기본 tolerance는 500ms이며 합성 CLI 예제는 250ms를 사용한다. 실제 데이터에
적용하기 전 annotation 정책과 판정 지연 분포를 바탕으로 tolerance를 고정해야 한다.

## 세션 지표

- ground truth rep count
- predicted rep count
- absolute rep count error
- true positive
- false positive
- false negative
- precision
- recall
- F1
- mean signed detection latency
- median absolute latency
- P95 absolute latency
- tracking failure interval 수
- tracking failure 중 predicted count
- ambiguous annotation 수

False positive timestamp가 annotation 구간 내부에 있으면 해당 label을
`annotationContext`로 기록한다.

예:

```text
false_positive at 2,200ms
annotationContext: tracking_failure
```

## 조건별 집계

Manifest의 `condition.*` 필드로 여러 세션을 묶는다.

예:

```text
movementSpeed = normal
tracking = stable

movementSpeed = normal
tracking = failure
```

조건별 TP, FP, FN은 세션 metric의 평균이 아니라 event count를 합산한 뒤 precision,
recall, F1을 다시 계산한다.

## 합성 End-to-end 검증

두 개의 합성 세션을 사용했다.

### Synthetic stable session

```text
GT: 2
Prediction: 2
TP: 2
FP: 0
FN: 0
Precision/Recall/F1: 1.0 / 1.0 / 1.0
```

### Synthetic tracking-failure session

```text
GT: 2
Prediction: 3
TP: 2
FP: 1
FN: 0
Precision/Recall/F1: 0.667 / 1.0 / 0.8
Tracking failure 중 count: 1
```

이 수치는 evaluator가 예상한 event matching과 failure interval 집계를 수행하는지
검증하기 위한 합성 결과다. FitForm Live의 실제 성능으로 사용하지 않는다.

## 산출물

```text
evaluation/python-validation/batch-synthetic/
  session-results.csv
  condition-results.csv
  event-diagnostics.csv
  batch-summary.json
  condition-report.svg
```

각 역할:

| 파일 | 역할 |
| --- | --- |
| session-results.csv | 세션별 metric |
| condition-results.csv | 조건별 event count와 metric |
| event-diagnostics.csv | matched, FP, FN timestamp |
| batch-summary.json | manifest provenance와 조건 결과 |
| condition-report.svg | 조건별 precision/recall 시각화 |

## 구현 파일

```text
python/src/fitform_eval/
  models.py
  evaluator.py
  cli.py

python/examples/synthetic-batch/
  manifest.json
  *.annotations.json
  *.predictions.json

python/tests/
  test_evaluator.py
```

## 테스트

검증 항목:

- match 수를 우선하는 순서 보존 event matching
- TP/FP/FN과 latency 계산
- tracking failure interval FP 집계
- valid rep completion 누락 차단
- session/condition/diagnostic 산출물 생성
- 두 번 실행한 CSV/JSON/SVG byte equality

Python 전체:

```text
11 passed
```

## 현재 완료 범위

완료:

- annotation/prediction/manifest 계약
- event matching
- session metric
- condition aggregation
- failure event diagnostics
- CLI
- 자동 리포트
- 합성 end-to-end 테스트

대기:

- 실제 사용자 cycle annotation
- 실제 조건별 성능표
- tolerance 독립 설정
- 영상 clip과 diagnostic event 연결

## 포트폴리오 표현

현재 가능한 표현:

> Python 기반 cycle-level batch evaluator를 구현해 GT completion event와 JavaScript
> `REP_COUNTED` 이벤트를 순서 보존 방식으로 matching하고, 조건별 TP·FP·FN,
> precision·recall·F1, detection latency와 추적 실패 구간 count를 자동 집계했습니다.
> 평가 엔진은 합성 annotation으로 검증했으며 실제 사용자 성능 평가는 동기화 영상
> 수집 전이라 분리했습니다.

현재 사용하면 안 되는 표현:

- 실제 사용자 조건별 F1을 측정했다.
- 영상 데이터셋 구축을 완료했다.
- 합성 결과를 제품 성능으로 제시한다.
- tolerance 250ms가 최적값이다.

