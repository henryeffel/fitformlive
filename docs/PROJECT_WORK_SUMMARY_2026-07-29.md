# FitForm Live 통합 작업 기록

작성일: 2026-07-29  
목적: 지금까지 구현·검증·분석·문서화한 작업을 하나의 진입점에서 확인한다.

---

## 1. 프로젝트 현재 정의

FitForm Live는 두 실행 계층으로 역할을 분리했다.

```text
JavaScript Browser Runtime
→ 실시간 카메라 입력, MoveNet 추론, 후처리, 운동 판정

Python Evaluation Platform
→ 데이터 계약, cycle 분석, parameter sweep, annotation, batch evaluation
```

JavaScript 판정 로직을 Python으로 다시 구현하지 않는다. JavaScript를 운동 판정의
source of truth로 유지하고 Python이 configuration을 생성하거나 trace와 event를
분석한다.

최종 포지셔닝:

> JavaScript 기반 실시간 카메라 애플리케이션과 Python 기반 영상 데이터셋·성능평가
> 파이프라인을 함께 구축한 프로젝트

현재 Python 계층은 영상 없는 기존 trace와 합성 annotation까지 검증됐다. 실제 영상
동기화와 사용자 cycle-level ground truth는 아직 완료되지 않았다.

---

## 2. JavaScript 실시간 시스템

### 구현 범위

- 브라우저 웹캠 입력
- TensorFlow.js MoveNet 실시간 추론
- 17개 keypoint 처리
- 필수 관절 confidence 검증
- 화면 범위 검증
- EMA 좌표 평활화
- 팔꿈치 각도 및 각속도 계산
- 시간 기반 FSM
- hysteresis와 hold time
- 장시간 invalid 입력 상태 초기화
- 실시간 skeleton 및 사용자 안내
- JSON fixture recorder
- 평가 결과 JSON/CSV 출력
- OpenCV.js 입력 품질 보조 분석

### 초기 정상 테스트

최초 브라우저 테스트에서 정상 컬:

```text
Ground truth: 10
Browser prediction: 10
```

이 결과는 최초 baseline evidence로만 사용한다. 현재 프로젝트의 중심 근거는 이후
fixture replay, ablation, event analysis, Python evaluation으로 확장한 과정이다.

관련 문서:

- `CURL_NORMAL_VALIDATION_2026-07-28.md`
- `OPENCV_DEBUG_TEST_LOG_2026-07-28.md`
- `MANUAL_TEST_PROTOCOL.md`
- `PHASE_0_WORK_LOG.md` ~ `PHASE_8_WORK_LOG.md`

---

## 3. 실제 Pose Fixture와 Offline Replay

### 확보한 원본 조건

```text
curl-normal-01
curl-partial-01
curl-occlusion-01
```

기존 schema 1.0 fixture를 분석하며 다음 한계를 발견했다.

> 관절 좌표와 timestamp만 저장해도 당시 브라우저 판정을 완전히 복원할 수 없다.
> 초기 EMA, FSM 상태, 분석 활성 상태와 configuration이 함께 필요하다.

### Schema 개선

schema 1.1 방향:

- algorithm version
- config at capture
- initial algorithm state
- analysis active state
- frame count
- timestamp
- provenance

### Raw와 Canonical 분리

```text
tests/fixtures/raw/
→ 원본 증거

tests/fixtures/canonical/
→ 동일 입력 회귀와 ablation용 파생 fixture
```

Canonical fixture에는 다음을 보존했다.

- 원본 경로
- SHA-256
- 추출 범위
- transform name/version
- 객관적 movement window 규칙
- 정답 또는 예측 횟수를 구간 선택에 사용하지 않았다는 표시

Canonical 결과는 end-to-end browser 정확도로 표현하지 않는다.

관련 문서:

- `PHASE_9_WORK_LOG.md`
- `PHASE_10_CANONICALIZATION_PLAN.md`

---

## 4. JavaScript Ablation

동일한 실제 관절 입력에 후처리 요소를 누적 적용했다.

```text
Baseline
→ Validation
→ EMA
→ Hysteresis
→ Hold time
→ Invalid reset
```

평가:

```text
3 canonical fixtures × 6 configurations = 18 combinations
18 / 18 deterministic replay
```

핵심 압축 결과:

| 구성 | 정상 오차 | 경계 FP | 실패 구간 Count |
| --- | ---: | ---: | ---: |
| Baseline | 8 | 4 | 9 |
| Validation | 6 | 4 | 2 |
| EMA | 6 | 3 | 0 |
| Stable FSM | 5 | 3 | 0 |
| Full | 3 | 3 | 0 |

해석:

- Confidence validation과 EMA가 tracking failure count를 감소시켰다.
- 경계 수축 false positive 3개는 full 구성에서도 남았다.
- 잔여 오류는 입력 안정화가 아니라 운동 상태 정의 문제일 가능성이 커졌다.

관련 문서:

- `PHASE_11_ABLATION_RESULTS.md`

산출물:

```text
evaluation/ablation/
```

---

## 5. Rep-event 원인 분석

F_FULL 결과의 모든 `REP_COUNTED`를 cycle 단위로 분석했다.

Cycle 진단값:

- 최소·최대 각도
- ROM
- cycle duration
- contraction/extension hold
- invalid duration
- reset/recovery
- 이전 rep와의 간격
- 브라우저 rep event 정렬

### 정상 canonical 13개

```text
Ground truth: 10
Detected canonical cycles: 13
```

정렬되지 않은 7, 8, 9번 cycle도:

- 충분한 최소 각도
- 약 145° 이상의 ROM
- 짧은 jitter가 아닌 완전 왕복
- cycle 내부 reset 없음

을 보였다.

영상이 없으므로 다음을 확정하지 않았다.

- 실제 추가 동작
- 준비 동작
- 라벨 누락
- 알고리즘 false positive

### 경계 수축 3개

경계 cycle은 기존 60° 기준을 통과했지만 정상 label cycle보다 충분히 수축하지 않았다.

```text
정상 label-aligned 최소 각도: 16.2° ~ 28.9°
경계 최소 각도: 43.8° ~ 57.9°
탐색적 중간 기준: 약 36.4°
```

발견한 상태 정의 문제:

```text
기존:
60° = 수축 시작이면서 완전 수축

탐색 개선:
60° = CONTRACTING
약 36° = FULLY_CONTRACTED
155° = full extension
```

동일 fixture 재실행:

```text
Normal canonical: 13 → 13
Boundary false positive: 3 → 0
```

약 36.4°는 탐색값이며 production 기본값으로 적용하지 않았다.

관련 문서:

- `PHASE_12_REP_EVENT_ANALYSIS_PLAN.md`
- `PHASE_13_PORTFOLIO_EVIDENCE_LOG.md`

산출물:

```text
evaluation/rep-analysis/
portfolio/assets/boundary-rep-analysis.svg
portfolio/assets/normal-overview.svg
portfolio/assets/normal-unmatched-rep.svg
portfolio/assets/minimum-angle-distribution.svg
```

---

## 6. HTML 및 3페이지 포트폴리오

### 상세 HTML

상세 페이지의 읽기 순서를 다음과 같이 개편했다.

```text
Hero
→ Key Results
→ Problem
→ Evidence
→ Algorithm
→ Architecture
→ Scope
```

Hero 핵심 지표:

```text
18 / 18 deterministic ablation
9 → 0 counts during tracking failure
3 → 0 boundary false positives
```

Production FSM과 experimental FSM을 명확히 분리했다.

### 제출용 3페이지

```text
1페이지: 무엇을 만들었고 왜 필요한가
2페이지: 동일 입력으로 어떻게 평가했는가
3페이지: 어떤 원인을 찾아 FSM을 개선했는가
```

추가한 근거:

- 정상·경계 최소 각도 분포
- 약 36.4° 탐색 기준의 계산 근거
- 정상 GT 10과 canonical 13의 차이 설명
- MoveNet pretrained 영역과 custom algorithm 영역 분리

파일:

- `portfolio/index.html`
- `portfolio/three-page.html`
- `portfolio/fitformlive-3page-expanded.pdf`

관련 문서:

- `PHASE_14_PORTFOLIO_INFORMATION_ARCHITECTURE_LOG.md`

---

## 7. Python P1 — Fixture Schema and Validator

Pydantic 기반 canonical fixture 검증기를 구현했다.

검증:

- schema version
- ground truth 관계
- algorithm version
- initial state
- frame count
- timestamp 단조 증가
- keypoint score 0~1
- 필수 오른팔 관절 존재
- valid/invalid count
- SHA-256 형식
- canonical transform metadata

실제 canonical fixture 3개 모두 검증을 통과했다.

파일:

```text
python/src/fitform_eval/models.py
python/src/fitform_eval/validator.py
```

---

## 8. Python P2 — Cycle Feature Analyzer

JavaScript F_FULL trace와 cycle CSV를 Python에서 분석했다.

추출 feature:

- minimum/maximum angle
- ROM
- duration
- hold time
- peak/median angular velocity
- mean/min confidence
- invalid frame ratio
- previous rep gap
- reset/recovery

기존 JavaScript와 동일한 순서 보존 alignment로 다음을 재현했다.

```text
Aligned:   1, 2, 3, 4, 5, 6, 10, 11, 12, 13
Unmatched: 7, 8, 9
```

주요 결과:

| Feature | Aligned 10 | Unmatched 3 |
| --- | ---: | ---: |
| Minimum angle median | 18.19° | 13.35° |
| ROM median | 146.56° | 147.73° |
| Duration median | 1,681.65ms | 2,254.10ms |
| Peak velocity median | 435.85°/s | 610.31°/s |
| Mean confidence median | 0.532 | 0.495 |
| Invalid ratio median | 0.225 | 0.432 |

결론:

> 추가 3개는 완전 ROM과 정상 범위 안의 duration을 가져 단순 jitter 또는 짧은 duplicate로
> 제거할 근거가 부족하다. 각속도와 invalid ratio가 높은 경향은 영상 확인이 필요한 진단
> 후보이며 원인 확정은 아니다.

산출물:

```text
evaluation/python-validation/
  normal-cycle-features.csv
  normal-cycle-comparison.json
  normal-cycle-feature-strip.svg
```

관련 문서:

- `PHASE_P1_P2_PYTHON_VALIDATION_LOG.md`

---

## 9. Python P5 — Parameter Robustness

신규 세션 없이 기존 fixture의 in-sample 안정성을 분석했다.

Sweep:

```text
Full contraction threshold: 25° ~ 60°, 1° 간격
Hold time: 0ms ~ 500ms, 10ms 간격
Hysteresis: 8° 고정

1,836 configurations
3 fixtures
5,508 FSM replays
```

### 동작 정의 안정성

조건:

```text
Normal = 13
Boundary = 0
```

결과:

```text
97 / 1,836 configurations
```

대표 범위:

| Hold | Threshold |
| ---: | ---: |
| 100~150ms | 25°~31° |
| 160ms | 32°~44° |
| 170~190ms | 32°~45° |

`36° / 180ms`는 인접 범위 안에 있어 단일 우연한 점은 아니었다.

### 전체 실패 안전성

조건:

```text
Normal = 13
Boundary = 0
Tracking failure = 0
```

결과:

```text
0 / 1,836 configurations
```

Threshold와 hold만으로 세 조건을 동시에 만족하지 못했다. Enhanced FSM은
tracking-failure fixture에서 1회를 count했다.

해당 count는 내부 reset 없이 full contraction과 extension을 거쳤다. 실제 회복된 완전
동작인지 false positive인지 영상 없이 확정할 수 없다.

발견한 trade-off:

```text
짧은 hold
→ 정상 유지와 경계 분리에 유리
→ tracking recovery 구간 count 가능

긴 hold
→ tracking count 억제
→ 정상 cycle 누락
```

Production FSM은 변경하지 않았다.

산출물:

```text
evaluation/python-validation/robustness/
```

관련 문서:

- `PHASE_P5_ROBUSTNESS_LOG.md`

---

## 10. Python P4 — Batch Evaluator

Cycle-level GT와 예측 event를 비교하는 평가 엔진을 구현했다.

### Event matching

순서 보존 동적 계획법:

1. matched event 수 최대화
2. 동일 match 수에서 총 절대 latency 최소화
3. event 중복 대응 금지

### 지표

- TP, FP, FN
- precision, recall, F1
- rep count absolute error
- mean signed latency
- median/P95 absolute latency
- tracking failure interval count
- tracking failure 중 prediction
- ambiguous annotation count

### 자동 산출물

- session-results.csv
- condition-results.csv
- event-diagnostics.csv
- batch-summary.json
- condition-report.svg

실제 annotation이 없어 합성 데이터로 엔진만 검증했다.

```text
evaluation/python-validation/batch-synthetic/
```

`dataProvenance: synthetic-example-only`를 명시해 실제 사용자 성능과 구분했다.

관련 문서:

- `PHASE_P4_BATCH_EVALUATOR_LOG.md`

---

## 11. Python P3-A — Trace Annotation Workflow

Streamlit 기반 trace annotation UI를 구현했다.

기능:

- F_FULL trace JSON 업로드
- raw/processed angle timeline
- predicted REP_COUNTED 목록
- cycle start/end 지정
- valid rep completion timestamp
- label, annotator, note
- annotation 추가·수정·삭제
- 구간 중복 및 schema 검증
- annotations.json 다운로드
- predictions.json 다운로드
- P4 quick evaluation

지원 label:

```text
valid_rep
partial_rep
preparation
repositioning
tracking_failure
ambiguous
```

실행:

```powershell
cd python
$env:PYTHONPATH="src"
python -m streamlit run app\annotation_app.py
```

주소:

```text
http://localhost:8501
```

파일:

```text
python/app/annotation_app.py
python/src/fitform_eval/annotation.py
```

관련 문서:

- `PHASE_P3A_ANNOTATION_WORKFLOW_LOG.md`

영상이 없으므로 trace annotation으로 실제 행동 의미를 확정하지 않는다.

---

## 12. 현재 자동화 테스트

### Python

```text
16 passed
```

검증 범위:

- fixture schema
- 실제 canonical fixture
- timestamp 오류
- cycle alignment
- feature 분석
- deterministic artifacts
- robustness grid/range
- annotation schema와 CRUD
- trace prediction export
- P4 event matcher
- batch aggregation
- Streamlit 초기 화면

### JavaScript

```text
29 passed
9 test files
```

검증 범위:

- pose algorithms
- fixture parsing
- 실제 fixture replay
- canonical provenance
- ablation
- rep-event analysis
- enhanced FSM sweep 결정론

---

## 13. 현재 완료 상태

| 영역 | 상태 |
| --- | --- |
| 브라우저 실시간 MoveNet 시스템 | 완료 |
| Pose 후처리와 production FSM | 완료 |
| Fixture recorder | 완료 |
| Canonical fixture 3개 | 완료 |
| Offline replay | 완료 |
| 6단계 ablation | 완료 |
| Rep-event 원인 분석 | 완료 |
| 탐색적 full-contraction FSM | 현재 fixture 검증 완료, production 미적용 |
| Python P1 validator | 완료 |
| Python P2 cycle analyzer | 완료 |
| Python P3-A trace annotation | 완료 |
| Python P3-B video synchronization | 보류 |
| Python P4 batch evaluator engine | 완료 |
| P4 실제 사용자 평가 | 보류 |
| Python P5 in-sample robustness | 완료 |
| P5 independent validation | 보류 |
| 상세 HTML 포트폴리오 | 완료 |
| 제출용 3페이지 포트폴리오 | 완료 |

---

## 14. 남은 논리적 한계

### 정상 GT 10 vs canonical 13

운동학적 비교는 완료했지만 영상이 없어 추가 3개의 실제 label은 확정되지 않았다.

### 약 36.4° 기준

기존 fixture 안에서 인접 안정 구간은 확인했지만 독립 사용자 검증은 없다.

### Tracking failure count

Enhanced FSM의 1회 count가 실제 회복 동작인지 오류인지 영상 없이 확정할 수 없다.

### 데이터 다양성

Canonical fixture 3개는 재현성 근거이지 사용자·환경 일반화 근거가 아니다.

### 합성 Batch 결과

P4 합성 결과는 평가 엔진 검증용이며 제품 성능 수치가 아니다.

---

## 15. 다음 작업

신규 영상 기록이 가능해질 때 P3-B를 진행한다.

```text
video + keypoints + timestamp 동시 기록
→ OpenCV frame-keypoint synchronization
→ skeleton/angle/FSM overlay
→ Streamlit video frame navigation
→ cycle-level human annotation
→ P4 actual batch evaluation
→ development/validation session 분리
→ P5 independent validation
```

최소 신규 조건:

1. 정상 속도
2. 빠른 동작
3. 명확한 부분 수축
4. 짧은 가림 후 복구

가능하면 사용자 2명으로 수집한다.

영상 기록이 계속 불가능하다면 다음은 가능하다.

- 기존 keypoint의 deterministic synthetic perturbation
- confidence 감소
- keypoint noise
- 관절 누락 지속 시간
- timestamp jitter
- frame drop
- 입력 열화 강도별 failure boundary 분석

이 결과는 실제 사용자 일반화가 아니라 controlled stress test로만 표현한다.

---

## 16. 주요 문서 인덱스

### 전체 계획

- `VIDEO_ALGORITHM_DEVELOPMENT_PLAN.md`
- `PYTHON_VALIDATION_PLAN.md`
- `ALGORITHM_PORTFOLIO_IMPROVEMENTS.md`

### JavaScript 평가

- `PHASE_10_CANONICALIZATION_PLAN.md`
- `PHASE_11_ABLATION_RESULTS.md`
- `PHASE_12_REP_EVENT_ANALYSIS_PLAN.md`
- `PHASE_13_PORTFOLIO_EVIDENCE_LOG.md`

### 포트폴리오

- `PHASE_14_PORTFOLIO_INFORMATION_ARCHITECTURE_LOG.md`

### Python 평가

- `PHASE_P1_P2_PYTHON_VALIDATION_LOG.md`
- `PHASE_P3A_ANNOTATION_WORKFLOW_LOG.md`
- `PHASE_P4_BATCH_EVALUATOR_LOG.md`
- `PHASE_P5_ROBUSTNESS_LOG.md`

### 실행 안내

- `QUICK_TEST_GUIDE.md`
- `../python/README.md`

---

## 17. 포트폴리오 핵심 문장

> MoveNet을 단순 연결하는 데서 멈추지 않고 confidence validation, EMA, 관절 geometry,
> 시간 기반 FSM을 직접 구현했습니다. 실제 관절 입력을 fixture로 저장해 동일 조건에서
> 6개 후처리 구성을 비교하고, rep-event 단위 분석으로 입력 안정화 문제와 운동 상태 정의
> 문제를 분리했습니다. 이후 JavaScript는 실시간 판정의 source of truth로 유지하면서,
> Python 기반 fixture validation, cycle feature 분석, 1,836개 parameter sweep,
> cycle-level event matching과 annotation workflow를 구축했습니다. 분석 과정에서 경계
> 오인식 제거와 tracking failure 안전성이 동시에 유지되지 않는 trade-off를 발견했으며,
> 이를 숨기지 않고 영상 기반 ground truth와 독립 검증이 필요한 다음 과제로 정의했습니다.

