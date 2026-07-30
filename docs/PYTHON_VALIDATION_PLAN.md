# Python 검증

## 진행 상태

| 단계 | 상태 | 기록 |
| --- | --- | --- |
| P1 Dataset Schema and Validator | 완료 | `PHASE_P1_P2_PYTHON_VALIDATION_LOG.md` |
| P2 Cycle Feature Analyzer | 완료 | `PHASE_P1_P2_PYTHON_VALIDATION_LOG.md` |
| P3 Video Synchronization and Annotation | 완료 | 영상·pose 동기화 및 cycle annotation UI 완료 |
| P4 Batch Evaluation | 완료 | 실제 annotation/prediction TP·FP·FN 평가 적용 |
| P5 Robustness and External Development Validation | 완료 | in-sample sweep 및 external diagonal sample1~4 개발 평가 |

P5 count-level 결과는
`evaluation/python-validation/video-session-comparison/external-diagonal-target-arm-p5-final.json`
에 기록했다. candidate approval과 AI-assisted 전체 영상 누락 audit를 결합했으며,
새 subject를 사용하는 최종 holdout 평가는 개발 평가와 별도 후속 단계로 유지한다.

## 문서 목적

FitForm Live의 실시간 애플리케이션과 평가 환경의 책임을 분리하고, 현재 프로젝트에 남은
데이터 및 검증상의 한계를 Python 기반 파이프라인으로 보완하기 위한 계획을 기록한다.

이 작업의 목적은 기존 JavaScript 코드를 Python으로 포팅하는 것이 아니다.

```text
JavaScript
→ 브라우저 실시간 카메라 애플리케이션

Python
→ 영상 데이터셋 구축, ground truth 생성, 성능시험 자동화
```

언어를 추가하는 것 자체가 아니라 각 실행 환경에 적합한 책임을 배치하는 것이 핵심이다.

---

## 1. 현재 프로젝트의 역할

### JavaScript Runtime

현재 브라우저 애플리케이션이 담당하는 기능이다.

- 웹캠 실시간 입력
- TensorFlow.js MoveNet 추론
- 17개 관절 keypoint 수집
- 필수 관절 confidence 및 화면 범위 검증
- EMA 좌표 평활화
- 관절 각도 및 각속도 계산
- 시간 기반 운동 상태 머신
- 반복 횟수 판정
- 추적 실패 시 진행 상태 초기화
- 실시간 사용자 피드백
- 관절 fixture 기록

JavaScript는 제품 실행 환경이며 운동 판정 로직의 source of truth로 유지한다.

### Python Evaluation Platform

새로 구축할 평가 환경이 담당할 기능이다.

- 세션 단위 영상 데이터셋 관리
- 데이터 스키마 및 파일 무결성 검증
- 영상 frame과 keypoint timestamp 동기화
- rep cycle 단위 ground truth annotation
- 오류 cycle 영상 clip 자동 추출
- 여러 fixture에 대한 batch evaluation
- threshold 및 hold time 민감도 분석
- 조건별 성능표와 그래프 자동 생성
- 평가 파이프라인 자동화 테스트

---

## 2. Python 검증이 필요한 이유

### 2.1 정상 GT 10회와 감지 cycle 13개의 의미가 확정되지 않음

현재 정상 canonical fixture의 결과는 다음과 같다.

```text
사용자가 의도한 정상 반복: 10회
canonical 입력에서 감지한 cycle: 13개
탐색적 FSM 적용 전·후: 13 → 13
```

추가 3개가 다음 중 무엇인지 현재 데이터만으로 확정할 수 없다.

- 실제 추가 동작
- 준비 동작
- 재시도 또는 자세 재정렬
- 하나의 rep가 중복 분할된 결과
- 최종 횟수 ground truth의 라벨 누락

기존 fixture에는 cycle-level annotation과 동기화된 원본 영상이 없기 때문이다.

Python 분석기는 추가 3개가 정상 cycle과 운동학적으로 유사한지 비교할 수 있지만,
영상 없이 실제 행동의 의미를 확정할 수는 없다.

### 2.2 약 36.4° 기준이 같은 fixture에서 도출·검증됨

현재 완전 수축 후보 기준의 도출 과정은 다음과 같다.

```text
정상 라벨 정렬 cycle 최소 각도: 16.2° ~ 28.9°
경계 수축 cycle 최소 각도: 43.8° ~ 57.9°
두 범위 사이의 탐색적 중간값: 약 36.4°
```

같은 fixture에서 기준을 찾고 같은 fixture에서 경계 false positive 감소를 확인했으므로
독립 검증이 아니다.

현재 결과가 보여주는 것은 개선 가능성과 in-sample 분리다. 일반 사용자에게 적용할 수
있는 최적 threshold를 증명한 것은 아니다.

### 2.3 fixture 3개는 재현성을 보여주지만 다양성을 보여주지 않음

현재 `3 fixture × 6 configuration = 18개 조합`은 동일 입력에서 결과와 이벤트가
결정론적으로 재현된다는 근거다.

그러나 다음을 의미하지는 않는다.

- 여러 사용자에게 일반화됨
- 다양한 조명에서 동작함
- 빠른 동작과 느린 동작 모두 처리함
- 다양한 가림과 카메라 위치에서 안정적임

새로운 조건과 사용자를 세션 데이터셋에 추가하고 자동으로 평가할 수 있어야 한다.

### 2.4 최종 횟수 중심 ground truth의 한계

`정상 10회`, `경계 동작 0회`와 같은 최종 횟수만으로는 각 동작의 시작과 종료,
준비 동작, 불완전 동작, 추적 실패를 구분할 수 없다.

다음과 같은 cycle-level ground truth가 필요하다.

```text
Rep 01: 2.1s ~ 3.5s, valid_rep
Rep 02: 4.0s ~ 5.2s, valid_rep
Motion 03: 5.8s ~ 6.4s, preparation
Failure 01: 8.2s ~ 10.1s, tracking_failure
```

---

## 3. 목표 시스템 구조

```text
JavaScript Browser Application
TensorFlow.js + MoveNet
    │
    ├─ video
    ├─ keypoints
    ├─ confidence
    ├─ timestamp
    ├─ algorithm events
    └─ algorithm config/version
           │
           ▼
Python Evaluation Platform
    ├─ Dataset Validator
    ├─ Video-Keypoint Synchronizer
    ├─ Cycle Annotation Tool
    ├─ Error Clip Exporter
    ├─ Batch Evaluator
    ├─ Robustness Analyzer
    └─ Report Generator
```

판정 알고리즘을 Python으로 별도 재구현하지 않고 기존 JavaScript offline runner를
사용한다.

```text
Python
→ 실험 configuration 생성
→ JavaScript offline runner 실행
→ trace JSON 및 event 결과 수집
→ Python에서 GT matching, 통계 집계, 시각화
```

이 구조를 사용하면 브라우저와 Python 구현 사이에서 FSM 결과가 달라지는 문제를 피할
수 있다.

---

## 4. 데이터셋 구조

### 세션 디렉터리

```text
dataset/
  sessions/
    subject-01_normal-01/
      session.json
      video.mp4
      keypoints.json
      annotations.json
```

### 세션 메타데이터 예시

```json
{
  "schemaVersion": "2.0",
  "sessionId": "subject-01_normal-01",
  "subjectId": "subject-01",
  "exercise": "right_curl",
  "condition": {
    "movementSpeed": "normal",
    "lighting": "normal",
    "occlusion": "none",
    "cameraDistance": "medium",
    "cameraHeight": "chest",
    "mirrored": true
  },
  "assets": {
    "video": "video.mp4",
    "keypoints": "keypoints.json",
    "annotations": "annotations.json"
  },
  "algorithm": {
    "version": "git-commit-sha",
    "config": {}
  }
}
```

### 데이터 검증 항목

Pydantic 또는 Pandera를 사용해 다음을 자동 검증한다.

- 필수 파일 존재
- schema version 지원 여부
- 파일 SHA-256 일치
- keypoint timestamp 단조 증가
- 영상 길이와 keypoint timestamp 범위 일치
- 필수 관절 key 존재
- confidence 범위가 0~1인지 확인
- annotation 시작 시간이 종료 시간보다 작은지 확인
- 허용되지 않은 label 차단
- annotation 구간 중복 또는 충돌 검사
- algorithm version 및 config 존재

---

## 5. Python 구현 기능

### 5.1 Cycle Feature Analyzer

기존 JavaScript runner가 생성한 trace와 cycle event를 입력으로 사용한다.

각 cycle에서 다음 feature를 추출한다.

- 최소·최대 관절 각도
- Range of Motion
- 전체 cycle duration
- 수축 duration
- 이완 duration
- 수축·이완 hold time
- peak angular velocity
- median angular velocity
- 평균 및 최소 confidence
- invalid frame ratio
- 연속 invalid 최대 시간
- 이전 rep와의 시간 간격
- reset 및 recovery 횟수
- threshold 아래에 머문 시간

비교 대상은 다음과 같이 분리한다.

```text
브라우저 라벨과 정렬된 정상 cycle 10개
vs
정렬되지 않은 추가 cycle 3개
```

표본이 작으므로 초기 분석에서는 복잡한 통계 검정보다 다음을 우선한다.

- cycle feature table
- median과 IQR
- feature range
- strip plot
- robust z-score
- 이상치 후보 표시

#### 해석 범위

추가 3개가 정상 cycle과 유사한 경우:

> 추가 cycle을 알고리즘 오탐으로 단정하기 어렵고, cycle-level ground truth가 없는
> 기존 라벨 구조가 원인 판별을 제한했다.

추가 3개가 duration, velocity, confidence 등에서 극단적인 경우:

> ROM만으로는 불완전 동작을 분리하기 어려우며 duration, velocity 또는 confidence
> 조건을 추가로 검토할 필요가 있다.

어느 경우에도 영상 확인 없이 실제 행동 label을 확정하지 않는다.

### 5.2 OpenCV Video-Keypoint Synchronizer

OpenCV를 사용해 다음 기능을 구현한다.

- 영상 FPS와 frame timestamp 추출
- keypoint timestamp와 가장 가까운 video frame 정렬
- skeleton overlay
- elbow angle 표시
- 필수 관절 confidence 표시
- FSM phase와 rep count 표시
- invalid/reset/recovery event marker 표시
- GT annotation overlay

출력 예시:

```text
artifacts/
  subject-01_normal-01/
    rep-01-valid.mp4
    rep-07-unmatched.mp4
    tracking-failure-01.mp4
```

오류 숫자만 확인하는 것이 아니라 오류가 발생한 영상 구간을 자동 추출해 실제 원인을
확인하는 것이 목적이다.

### 5.3 Cycle Annotation Tool

Streamlit 기반 최소 annotation 도구를 구현한다.

기능:

- 영상 재생 및 일시 정지
- frame 또는 timestamp 이동
- rep start/end 지정
- cycle label 선택
- 메모 입력
- keypoint timestamp와 현재 video timestamp 표시
- JSON 저장
- 기존 annotation 불러오기 및 수정

초기 label:

```text
valid_rep
partial_rep
preparation
repositioning
tracking_failure
ambiguous
```

`ambiguous` label을 제공해 불확실한 동작을 억지로 정답으로 만들지 않는다.

annotation 예시:

```json
{
  "schemaVersion": "1.0",
  "sessionId": "subject-01_normal-01",
  "cycles": [
    {
      "startMs": 2100,
      "endMs": 3500,
      "completionMs": 3500,
      "label": "valid_rep",
      "annotator": "human-01",
      "note": ""
    }
  ]
}
```

### 5.4 Batch Evaluator

여러 세션을 한 번에 평가한다.

조건 예시:

- normal speed
- fast
- slow
- incomplete contraction
- short occlusion
- recovery after occlusion
- low light
- different camera distance
- different camera height
- mirrored input

평가 지표:

- rep count absolute error
- cycle true positive
- cycle false positive
- cycle false negative
- precision
- recall
- F1
- cycle detection latency
- invalid frame ratio
- valid joint rate
- reset latency
- recovery latency
- inference latency

예측 event와 GT event는 timestamp tolerance window를 사용해 matching한다.

```text
Predicted REP_COUNTED timestamp
↕ tolerance window
GT cycle completion timestamp
```

일반 분류 metric을 계산하기 전에 event matching 규칙과 tolerance를 문서화한다.

### 5.5 Threshold Robustness Analyzer

한 개의 threshold를 정답으로 선택하는 대신 parameter 안정 구간을 탐색한다.

예시 범위:

```text
full contraction threshold: 25° ~ 60°
hold time: 0ms ~ 500ms
confidence threshold: 여러 후보
invalid reset duration: 여러 후보
```

각 조합에서 저장할 결과:

- 정상 predicted reps
- 정상 절대 횟수 오차
- 경계 false positive
- tracking failure 중 count
- incomplete rejection
- invalid reset count
- recovery latency

목표 결과는 최적 단일값이 아니라 다음과 같은 안정 구간이다.

```text
34° ~ 39°
- 정상 canonical cycle 유지
- 경계 false positive 0
- tracking failure 중 count 0
```

현재 fixture에서 안정 구간이 확인되더라도 `in-sample stability`로 표현한다.
일반화를 주장하려면 development session과 validation session을 분리해야 한다.

```text
Development sessions
→ parameter 후보 및 안정 구간 탐색

Validation sessions
→ 선택 범위를 고정한 독립 평가
```

---

## 6. 권장 Python 기술 스택

| 도구 | 역할 |
| --- | --- |
| Python | 평가 파이프라인 실행 환경 |
| pandas | 세션·cycle feature 및 결과표 집계 |
| NumPy | 수치 계산과 parameter sweep |
| OpenCV | 영상 frame 탐색, timestamp 정렬, overlay, clip export |
| Pydantic | 데이터셋 스키마와 입력 검증 |
| Streamlit | cycle-level annotation UI |
| Matplotlib | 조건별 성능 및 민감도 그래프 |
| pytest | 데이터 검증기와 evaluator 자동화 테스트 |
| SciPy | 표본 증가 후 통계 분석이 필요할 때 선택적으로 사용 |

SciPy와 scikit-learn은 기술 스택을 늘리기 위해 먼저 도입하지 않는다. 데이터 규모와
평가 요구가 생길 때 사용한다.

---

## 7. 구현 순서

### Phase P1 — Dataset Schema and Validator

- 세션 디렉터리 구조 정의
- Pydantic schema 작성
- 파일 및 timestamp 검증
- SHA-256 provenance 기록
- pytest 작성

완료 기준:

```text
유효 세션 fixture 검증 통과
필수 파일 누락 검출
timestamp 역순 검출
annotation 충돌 검출
알고리즘 config 누락 검출
```

### Phase P2 — Cycle Feature Analyzer

- JavaScript trace 및 cycle CSV 파싱
- cycle feature table 생성
- 정상 정렬 10개와 추가 3개 비교
- strip plot 및 요약 리포트 생성
- 분석 결과의 해석 범위 기록

완료 기준:

```text
13개 cycle feature 자동 추출
10 aligned vs 3 unmatched 비교표 생성
각 feature의 median/IQR/range 출력
동일 입력에서 동일 결과 재현
```

### Phase P3 — Video Synchronization and Annotation

- 영상과 keypoint timestamp 정렬
- OpenCV overlay preview 생성
- Streamlit annotation UI 구현
- annotation JSON 저장 및 재로딩
- cycle별 오류 clip export

완료 기준:

```text
video frame과 keypoint timestamp 정렬 확인
cycle start/end 및 label 저장
annotation 재로딩과 수정 가능
선택 cycle clip 자동 생성
```

### Phase P4 — Batch Evaluation

- JavaScript runner orchestration
- GT event matching
- 조건별 TP/FP/FN 및 latency 계산
- 세션·조건별 CSV 생성
- 요약 그래프 자동 생성

완료 기준:

```text
여러 session 일괄 실행
조건별 결과표 생성
cycle-level precision/recall 계산
실패 session과 cycle 목록 자동 출력
```

### Phase P5 — Robustness and Independent Validation

- threshold 및 hold time sweep
- 안정 구간 탐색
- development/validation session 분리
- 독립 session 평가
- production 적용 여부 결정

완료 기준:

```text
parameter sweep 결과 CSV 생성
안정 구간 시각화
development와 validation 결과 분리
현재 약 36.4° 기준의 유지·수정·폐기 근거 기록
```

---

## 8. 최소 신규 데이터 수집 범위

초기에는 모든 조건을 한 번에 수집하지 않는다.

우선순위:

1. 정상 속도
2. 빠른 동작
3. 명확한 부분 수축
4. 짧은 가림 후 복구

가능하면 사용자 2명에게 동일 조건을 적용해 조건 다양성과 사용자 다양성을 함께
확보한다.

각 세션은 다음 항목을 모두 포함해야 한다.

```text
video
+ keypoint JSON
+ algorithm initial state
+ cycle-level annotation
+ source/config version
```

---

## 9. JD 대응

### 카메라 기반 영상처리 시스템 구현 및 성능 테스트

JavaScript 브라우저 애플리케이션으로 대응한다.

> TensorFlow.js MoveNet 기반 브라우저 실시간 자세 추정 시스템을 구현하고,
> confidence gate, EMA, 관절 각도 계산, 시간 기반 FSM을 적용했습니다. 실제 카메라
> 입력을 fixture로 저장해 동일 조건에서 알고리즘 설정별 성능을 비교했습니다.

### AI 영상처리 데이터셋 구축 및 애플리케이션 성능 테스트

Python 평가 플랫폼으로 대응한다.

> Python·OpenCV·Streamlit 기반으로 영상, 관절 좌표, confidence, timestamp를
> 동기화한 평가 데이터셋을 구축하고 rep cycle 단위 ground truth를 생성했습니다.
> pandas·NumPy 기반 batch evaluator로 조건별 오검출, 미검출, 추적 실패 및 복구
> 성능을 자동 측정했습니다.

위 문장은 실제 구현과 데이터 수집이 완료된 뒤에만 완료형으로 사용한다.

---

## 10. 포트폴리오 문제 해결 스토리

### Problem

> 브라우저 기반 운동 판정 시스템은 실시간 동작했지만, 최종 횟수 중심 ground truth와
> 소수 fixture만으로는 정상 10회 대비 추가 검출된 3개 cycle의 의미와 약 36.4°
> 기준의 일반화 가능성을 충분히 검증할 수 없었습니다.

### Action

> JavaScript는 실시간 판정의 source of truth로 유지하고, Python·OpenCV 기반 평가
> 플랫폼을 별도로 구축했습니다. 영상과 관절 timestamp를 동기화하고 Streamlit
> annotation 도구로 rep cycle 단위 ground truth를 생성했으며, pandas·NumPy 기반
> batch evaluator로 조건별 오류와 parameter 민감도를 자동 분석했습니다.

### Result

독립 데이터 검증 결과에 따라 다음 중 정확한 표현을 선택한다.

#### 안정 구간과 독립 검증이 확인된 경우

> 오류 cycle을 영상 기준으로 분류하고, 단일 threshold가 아닌 인접 안정 구간에서
> 정상 rep 유지와 경계 false positive 제거가 동시에 성립함을 독립 세션에서
> 확인했습니다.

#### 데이터가 아직 부족한 경우

> 기존 관절 JSON만으로 추가 cycle의 실제 의미를 확정할 수 없음을 확인하고,
> 영상 동기화와 cycle-level annotation을 fixture schema의 필수 조건으로 정의했습니다.

두 번째 결과도 실패가 아니다. 검증이 불가능한 이유를 발견하고 데이터 수집 구조를
개선한 결과다.

---

## 11. 제외 범위

현재 단계에서는 다음을 수행하지 않는다.

- 실시간 JavaScript 애플리케이션 전체를 Python으로 포팅
- Python으로 별도의 production FSM 구현
- 근거 없이 IMU 또는 심박 센서 데이터 추가
- 표본 3개로 통계적 일반화 주장
- 약 36.4°를 최적 threshold로 표현
- annotation 없이 추가 3개 cycle을 false positive로 확정

웨어러블 센서 경험에 대해서는 다음과 같이 사실대로 설명한다.

> 현재 프로젝트는 카메라 기반 입력을 대상으로 했습니다. timestamp 기반 시계열 처리와
> 상태 판정 구조는 센서 데이터에도 적용 가능한 형태지만, 실제 IMU나 심박 데이터 검증
> 경험은 아직 없습니다.

---

## 12. 최종 포지셔닝

Python 검증 작업이 완료되면 FitForm Live는 다음과 같이 설명할 수 있다.

> JavaScript 기반 실시간 카메라 애플리케이션과 Python 기반 영상 데이터셋·성능평가
> 파이프라인을 함께 구축한 프로젝트

역할 분리:

```text
JavaScript
→ 실시간 사용자 경험과 운동 판정

Python
→ 데이터 품질, ground truth, 조건별 성능시험, 오류 분석
```

이 포지셔닝은 카메라 기반 영상처리 시스템 구현, AI 영상 데이터셋 구축, 알고리즘 개발,
애플리케이션 성능 테스트 경험을 하나의 문제 해결 흐름으로 연결한다.
