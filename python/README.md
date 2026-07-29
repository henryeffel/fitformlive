# FitForm Python Evaluation

FitForm Live의 JavaScript 실시간 판정 결과를 검증하고 cycle 단위로 분석하는 Python
평가 도구다. FSM을 Python으로 다시 구현하지 않고 JavaScript offline runner가 생성한
fixture, trace, cycle CSV를 입력으로 사용한다.

## 책임

```text
JavaScript
→ 실시간 추론과 운동 판정의 source of truth

Python
→ 데이터 계약 검증, cycle feature 분석, 통계 집계, 리포트 생성
```

## 실행

저장소 루트 기준:

```powershell
cd python
$env:PYTHONPATH="src"
```

Canonical fixture 검증:

```powershell
python -m fitform_eval.cli validate-fixture `
  ..\tests\fixtures\canonical\curl-normal-01.derived.json
```

정상 cycle 분석:

```powershell
python -m fitform_eval.cli analyze-cycles `
  --fixture ..\tests\fixtures\canonical\curl-normal-01.derived.json `
  --cycles ..\evaluation\rep-analysis\curl-normal-01--F_FULL.cycles.csv `
  --trace ..\evaluation\rep-analysis\curl-normal-01--F_FULL.trace.json `
  --output ..\evaluation\python-validation
```

테스트:

```powershell
python -m pytest -q
```

Enhanced FSM in-sample robustness sweep:

```powershell
python -m fitform_eval.cli robustness-sweep `
  --repository .. `
  --output ..\evaluation\python-validation\robustness `
  --threshold-min 25 `
  --threshold-max 60 `
  --threshold-step 1 `
  --hold-min 0 `
  --hold-max 500 `
  --hold-step 10
```

Cycle-level batch evaluation:

```powershell
python -m fitform_eval.cli evaluate-batch `
  --manifest examples\synthetic-batch\manifest.json `
  --output ..\evaluation\python-validation\batch-synthetic `
  --tolerance-ms 250
```

`examples/synthetic-batch`는 evaluator 동작 검증용 합성 데이터다. 실제 사용자 성능 근거로
사용하지 않는다.

Trace 기반 cycle annotation UI:

```powershell
python -m streamlit run app\annotation_app.py
```

입력:

- JavaScript `F_FULL.trace.json`
- 기존 `annotations.json` 선택

출력:

- cycle-level `annotations.json`
- trace에서 추출한 `predictions.json`
- 현재 annotation에 대한 P4 quick evaluation

영상이 없는 현재 단계에서는 angle timeline과 event timestamp를 사용한다. UI가 생성한
label은 영상 기반 행동 의미를 확정한 ground truth로 간주하지 않는다.

## 현재 출력

- `normal-cycle-features.csv`: 13개 cycle의 운동학·추적 품질 feature
- `normal-cycle-comparison.json`: aligned 10개와 unmatched 3개의 그룹 요약
- `normal-cycle-feature-strip.svg`: 대표 feature 분포 시각화
- `robustness/robustness-results.csv`: 1,836개 parameter 조합 결과
- `robustness/robustness-summary.json`: 동작 정의 및 전체 실패 안전성 요약
- `robustness/robustness-heatmap.svg`: threshold × hold time 결과 지도
- `batch-synthetic/session-results.csv`: 합성 세션별 event matching 결과
- `batch-synthetic/condition-results.csv`: 합성 조건별 집계 예제
- `batch-synthetic/event-diagnostics.csv`: matched/FP/FN event 목록

## 해석 제한

Python 분석은 unmatched cycle이 기존 정상 cycle과 운동학적으로 유사한지 비교할 수
있다. 동기화된 영상과 cycle-level ground truth가 없으므로 실제 추가 동작, 준비 동작,
라벨 누락 중 무엇인지는 확정하지 않는다.
