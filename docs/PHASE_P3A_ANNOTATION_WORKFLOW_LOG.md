# Phase P3-A — Trace-based Cycle Annotation Workflow

## 작업 목적

신규 영상 세션을 기록할 수 없는 상황에서 P3 전체를 완료했다고 주장하지 않고,
cycle-level annotation workflow와 P4 evaluator 연결을 먼저 구현했다.

현재 입력:

```text
JavaScript F_FULL trace JSON
→ angle timeline
→ REP_COUNTED event
→ cycle annotation
→ P4 quick evaluation
```

영상 frame과 keypoint overlay는 신규 영상 세션이 필요한 P3-B로 남긴다.

## 역할 분리

### Core annotation module

`python/src/fitform_eval/annotation.py`

- trace JSON 검증
- 표시용 trace DataFrame 생성
- REP_COUNTED event 추출
- P4 PredictionDocument 변환
- 빈 AnnotationDocument 생성
- annotation 추가·수정·삭제
- 시간 순서 정렬
- JSON deterministic serialization
- 안전한 임시 파일 저장 후 교체

Core 모듈은 Streamlit에 의존하지 않아 pytest와 다른 UI에서도 사용할 수 있다.

### Streamlit UI

`python/app/annotation_app.py`

- trace JSON 업로드
- 기존 annotation JSON 불러오기
- raw/processed angle timeline
- 예측 REP_COUNTED 목록
- cycle start/end 입력
- valid rep completion timestamp 입력
- label, annotator, note 입력
- annotation 수정 및 삭제
- schema 검증 오류 표시
- annotations.json 다운로드
- predictions.json 다운로드
- P4 TP/FP/FN quick evaluation

## 지원 label

```text
valid_rep
partial_rep
preparation
repositioning
tracking_failure
ambiguous
```

### Label 원칙

- `valid_rep`: completion timestamp 필수
- `ambiguous`: trace만으로 의미를 확정할 수 없는 구간
- 영상이 없는 기존 fixture는 `ambiguous`를 우선 고려
- 추가 3개 cycle을 trace만 보고 false positive 또는 valid rep로 확정하지 않음

## 검증 규칙

- `endMs > startMs`
- completion timestamp가 annotation 내부에 존재
- valid rep의 completion timestamp 필수
- annotation 구간 중복 차단
- trace와 annotation session ID 일치
- 존재하지 않는 annotation index 수정·삭제 차단

## P4 연결

Trace에서 다음 형식의 prediction을 생성한다.

```json
{
  "sessionId": "curl-normal-01",
  "algorithmVersion": "trace-export",
  "configurationId": "F_FULL",
  "events": [
    {
      "timestampMs": 13861.2,
      "type": "REP_COUNTED",
      "rep": 1
    }
  ]
}
```

UI에서 만든 annotation과 prediction을 P4 evaluator에 즉시 전달해 다음을 미리 확인할 수
있다.

- TP
- FP
- FN
- precision
- recall
- event diagnostics

이 quick evaluation은 annotation 작성 보조 기능이다. 영상 없는 trace annotation 결과를
실제 성능 근거로 사용하지 않는다.

## 실행 방법

```powershell
cd python
$env:PYTHONPATH="src"
python -m streamlit run app\annotation_app.py
```

기본 주소:

```text
http://localhost:8501
```

입력 예:

```text
evaluation/rep-analysis/curl-normal-01--F_FULL.trace.json
```

## Streamlit 의존성

`pyproject.toml`의 annotation optional dependency로 분리했다.

```toml
[project.optional-dependencies]
annotation = ["streamlit>=1.37"]
```

분석 CLI만 사용하는 환경에서는 Streamlit을 설치할 필요가 없다.

## 테스트

Core 테스트:

- trace JSON parsing
- 표시용 DataFrame 생성
- REP_COUNTED prediction export
- annotation CRUD와 정렬
- overlap 차단
- JSON round trip 결정론
- annotation + trace prediction → P4 evaluator E2E

Streamlit 검증:

- Python compile
- Streamlit AppTest 실행
- initial page exception 0
- headless server health `ok`
- HTTP 200 응답

Python 전체:

```text
16 passed
```

## 현재 완료 범위

완료:

- annotation schema
- trace timeline UI
- annotation CRUD
- P4 quick evaluation
- JSON export
- Streamlit 실제 기동 검증

미완료:

- 영상 재생
- video frame과 keypoint timestamp 동기화
- skeleton overlay
- 오류 cycle MP4 추출
- 실제 사람 cycle-level ground truth

## 해석 한계

현재 UI는 trace 기반이다. 각도, confidence, invalid frame, event timestamp는 확인할 수
있지만 사용자가 실제로 어떤 동작을 했는지는 볼 수 없다.

따라서 현재 결과는 다음 용도로만 사용한다.

- annotation workflow 검증
- schema와 evaluator 연결 검증
- 향후 영상 annotation 준비
- 불확실 구간 후보 기록

다음 표현은 사용하지 않는다.

- 기존 정상 13개 cycle의 실제 label을 확정했다.
- AI 영상 데이터셋 구축을 완료했다.
- 영상과 keypoint 동기화를 검증했다.
- trace annotation을 사람 행동 ground truth로 사용했다.

## 다음 P3-B

신규 세션 기록이 가능해지면 다음을 추가한다.

```text
video + keypoint timestamp
→ OpenCV synchronization
→ skeleton/angle/event overlay
→ Streamlit video frame navigation
→ cycle-level human annotation
→ P4 real batch evaluation
```

