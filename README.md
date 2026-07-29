# FitForm Live

웹캠 영상에서 신체 관절을 실시간으로 추정하고, 영상 품질 분석과 관절 좌표 후처리를 거쳐 운동 횟수와 자세 상태를 판정하는 브라우저 기반 영상처리 프로젝트입니다.

Microsoft AI School 8기 팀 프로젝트로 시작했으며, 현재 저장소는 카메라 기반 영상처리 알고리즘과 성능 검증 과정을 명확하게 보여주는 방향으로 개선하고 있습니다.

## 핵심 기능

- 브라우저 웹캠을 이용한 실시간 영상 입력
- TensorFlow.js MoveNet Lightning 기반 단일 인체 자세 추정
- 필수 관절 confidence 및 화면 범위 검사
- EMA를 이용한 관절 좌표 평활화
- 관절 각도와 시간 기준 각속도 계산
- 히스테리시스와 시간 기반 상태 머신을 이용한 반복 횟수 측정
- OpenCV.js 기반 밝기 및 선명도 분석
- 낮은 조도, 흐림, 관절 가림 및 화면 이탈 안내
- 모델 로딩, 추론 지연시간, 전체 프레임 처리시간 측정
- 평균, P50, P95, 최대 지연시간 및 EMA FPS 표시
- 테스트 조건과 실제 횟수를 포함한 JSON/CSV 결과 저장

현재 검증 대상으로 노출하는 운동은 다음 두 가지입니다.

- Right Arm Curl
- Squat

## 처리 파이프라인

```text
Webcam frame
  → MoveNet pose estimation
  → Required-joint confidence and boundary validation
  → EMA landmark smoothing
  → Joint-angle and angular-velocity calculation
  → Time-based repetition state machine
  → OpenCV.js frame-quality analysis
  → Pose feedback and performance metrics
  → JSON/CSV evaluation result
```

## 직접 구현한 영상처리 알고리즘

### 관절 검증

운동 판정에 필요한 관절의 좌표와 confidence가 모두 유효할 때만 각도와 상태를 갱신합니다.

- 최소 confidence: `0.4`
- 좌표가 비디오 프레임 내부인지 검사
- confidence가 낮거나 관절이 화면 밖이면 횟수 판정 보류
- invalid 상태가 1초 이상 지속되면 진행 중인 불완전 반복 초기화

이미 완료된 횟수는 유지합니다.

### EMA 좌표 평활화

MoveNet 관절 좌표의 프레임 간 흔들림을 줄이기 위해 Exponential Moving Average를 적용합니다.

```text
filtered = 0.35 × current + 0.65 × previous
```

카메라 시작·종료, 운동 변경 및 세션 초기화 시 필터 상태도 초기화합니다.

### 시간 기반 반복 상태 머신

단순히 각도가 임계값을 한 번 넘었다고 횟수를 증가시키지 않습니다.

```text
READY
  → BOTTOM_HOLD
  → RETURNING
  → READY + 1 rep
```

- 최저점에서 180ms 유지
- 최저점 이탈 시 8° 히스테리시스 적용
- 시작 각도로 돌아와 180ms 유지
- 완전한 왕복 동작에만 1회 증가

프레임 개수가 아닌 경과 시간을 사용하여 기기별 FPS 차이가 판정에 미치는 영향을 줄였습니다.

### OpenCV.js 영상 품질 분석

MoveNet 입력 영상의 품질을 약 1000ms 간격으로 분석합니다.

```text
RGBA frame
  → grayscale
  → mean brightness
  → Gaussian blur
  → Laplacian
  → Laplacian variance
```

- 분석 프레임 너비: `320px`
- 초기 최소 밝기: `55`
- 초기 최소 선명도: `80`
- OpenCV.js 로딩 또는 분석 실패 시에도 MoveNet 파이프라인은 계속 동작
- 생성한 모든 `cv.Mat`은 `finally`에서 명시적으로 해제

밝기와 선명도 임계값은 실제 카메라 테스트를 통해 조정할 초기값입니다.

## 성능 측정

개발자 도구에서 다음 지표를 확인할 수 있습니다.

- MoveNet 최초 모델 로딩 시간
- MoveNet 추론 average/P50/P95/max
- 전체 프레임 처리 average/P50/P95/max
- EMA 기반 FPS
- 유효·무효 관절 프레임 수
- 유효 관절 검출률
- OpenCV.js 품질 분석 처리시간
- 밝기와 선명도
- 추론 오류 횟수

초기 5개 MoveNet 추론 프레임은 워밍업으로 통계에서 제외합니다. 추론시간과 전체 프레임 처리시간은 각각 최근 최대 3,000개 샘플을 유지합니다.

> 실제 FPS와 지연시간은 아직 동일한 장비와 조건에서 수동 검증하지 않았습니다. 측정 전에는 임의의 성능 수치를 제시하지 않습니다.

## 실행 방법

별도의 빌드 과정은 필요하지 않습니다. 웹캠 권한과 CDN 리소스 로딩을 위해 파일을 직접 열지 말고 로컬 HTTP 서버를 사용합니다.

알고리즘 기술 포트폴리오는 프로젝트 루트에서 서버를 실행한 뒤
`http://localhost:8766/portfolio/`에서 확인할 수 있습니다.

```powershell
python -m http.server 8766 --directory .
```

### Python 사용

```powershell
python -m http.server 8000 --directory web
```

브라우저에서 다음 주소를 엽니다.

```text
http://localhost:8000
```

### 실행 순서

1. Chrome 또는 Edge에서 페이지를 엽니다.
2. `카메라 시작`을 누르고 웹캠 권한을 허용합니다.
3. `수행 동작 선택`에서 운동을 선택합니다.
4. 필요한 관절이 화면 안에 보이도록 위치를 조정합니다.
5. `운동 시작`을 누르고 카운트다운 후 운동을 수행합니다.
6. 개발자 도구에서 관절 검출률과 성능 지표를 확인합니다.
7. 테스트 조건과 실제 횟수를 입력한 후 JSON 또는 CSV 결과를 저장합니다.

### 실행 요구사항

- 최신 Chrome 또는 Edge
- 웹캠
- CDN 리소스를 불러올 수 있는 인터넷 연결
- `localhost` 또는 HTTPS 환경

주요 외부 리소스:

- TensorFlow.js 4.16.0
- TensorFlow.js pose-detection
- MoveNet SinglePose Lightning
- 프로젝트에 고정된 OpenCV.js 4.10.0

## 제한적 기능 검증

현재 저장소에는 대규모 학습 데이터셋이나 자체 학습 모델이 없습니다. 검증 목표는 제한된 환경에서 다음 항목을 확인하는 것입니다.

- 실제 횟수와 측정 횟수의 절대 오차
- 정확 일치 여부
- ±1회 이내 여부
- 유효 관절 검출률
- 정상·빠른 동작·불완전 동작에서의 카운트 안정성
- 저조도·흐림·관절 가림 조건에서의 동작
- 평균 및 P95 추론 지연시간

빠르게 테스트하려면 [QUICK_TEST_GUIDE.md](./docs/QUICK_TEST_GUIDE.md), 상세한 조건별 절차는 [MANUAL_TEST_PROTOCOL.md](./docs/MANUAL_TEST_PROTOCOL.md), 결과 양식은 [test-results-template.csv](./evaluation/test-results-template.csv)를 참고합니다.

실제 결과 파일은 환경 정보와 사용자 메모를 포함할 수 있어 기본적으로 Git 추적에서 제외합니다.

## 자동 회귀 테스트

브라우저 앱과 자동 테스트가 동일한 `web/js/pose-algorithms.js` 모듈을 사용합니다.
각도·각속도·반복 횟수 상태 머신을 변경하면 다음 명령으로 기존 판정 조건이 유지되는지 확인할 수 있습니다.

```powershell
npm install
npm.cmd test
```

현재 단위 및 고정 입력 시퀀스 테스트 10개가 구성되어 있습니다.
합성 fixture와 실제 카메라 측정 결과를 구분하며, 후속 단계에서 익명 관절 좌표 데이터셋으로 확장할 예정입니다.

## 기술 스택

| 기술 | 사용 목적 |
|---|---|
| JavaScript | 카메라 제어, 좌표 후처리, 상태 머신, 성능 계측 |
| TensorFlow.js | 브라우저 내 MoveNet 추론 |
| MoveNet Lightning | 17개 인체 관절 좌표 추정 |
| OpenCV.js | grayscale 밝기와 Laplacian 선명도 분석 |
| Vitest | 각도·각속도·상태 머신 자동 회귀 테스트 |
| Canvas API | 카메라 프레임 및 스켈레톤 렌더링 |
| MediaDevices API | 브라우저 웹캠 입력 |

## 프로젝트 구조

```text
fitformlive/
├─ docs/
│  ├─ VIDEO_ALGORITHM_DEVELOPMENT_PLAN.md
│  ├─ MANUAL_TEST_PROTOCOL.md
│  └─ PHASE_*_WORK_LOG.md
├─ evaluation/
│  ├─ results/
│  └─ test-results-template.csv
├─ images/
├─ tests/
│  ├─ fixtures/
│  ├─ integration/
│  └─ unit/
├─ web/
│  ├─ js/
│  │  └─ pose-algorithms.js
│  ├─ vendor/
│  └─ index.html
├─ package.json
└─ README.md
```

브라우저 제어와 UI는 `web/index.html`에 유지하고,
재현 가능한 검증이 필요한 핵심 계산과 상태 머신은 `web/js/pose-algorithms.js`로 분리했습니다.

OpenCV.js는 외부 문서 서버의 직접 파일 접근 정책에 영향을 받지 않도록 `web/vendor/opencv-4.10.0.js`에 버전을 고정하여 동일 출처에서 제공합니다. 배포 파일의 출처와 SHA-256은 [vendor NOTICE](./web/vendor/NOTICE.md)에 기록되어 있습니다.

## 설계 문서

- [영상처리 알고리즘 개발 계획](./docs/VIDEO_ALGORITHM_DEVELOPMENT_PLAN.md)
- [빠른 테스트 가이드](./docs/QUICK_TEST_GUIDE.md)
- [수동 기능 검증 프로토콜](./docs/MANUAL_TEST_PROTOCOL.md)
- [Phase 0 작업 로그](./docs/PHASE_0_WORK_LOG.md)
- [Phase 1 작업 로그](./docs/PHASE_1_WORK_LOG.md)
- [Phase 2 작업 로그](./docs/PHASE_2_WORK_LOG.md)
- [Phase 3 작업 로그](./docs/PHASE_3_WORK_LOG.md)
- [Phase 4 작업 로그](./docs/PHASE_4_WORK_LOG.md)
- [Phase 5 작업 로그](./docs/PHASE_5_WORK_LOG.md)
- [Phase 6 작업 로그](./docs/PHASE_6_WORK_LOG.md)
- [Phase 7 작업 로그](./docs/PHASE_7_WORK_LOG.md)
- [Phase 8 작업 로그](./docs/PHASE_8_WORK_LOG.md)
- [OpenCV.js 디버깅 및 재검증 로그](./docs/OPENCV_DEBUG_TEST_LOG_2026-07-28.md)
- [Right Arm Curl 정상 조건 검증 결과](./docs/CURL_NORMAL_VALIDATION_2026-07-28.md)
- [Algorithm + 포트폴리오 개선점](./docs/ALGORITHM_PORTFOLIO_IMPROVEMENTS.md)
- [영상 알고리즘 HTML 포트폴리오](./portfolio/index.html)

## 알려진 한계

- confidence, EMA, 각도 및 영상 품질 임계값은 실제 사용자 테스트를 통한 최종 보정 전입니다.
- 밝기와 선명도는 사용자 ROI가 아닌 전체 프레임을 분석합니다.
- Laplacian variance는 배경의 무늬와 움직임에도 영향을 받습니다.
- 단일 인체만 추정합니다.
- 2D 관절 좌표를 사용하므로 카메라 방향과 원근에 영향을 받습니다.
- 스쿼트는 현재 왼쪽 다리 관절을 기준으로 분석합니다.
- 장시간 OpenCV.js 실행 시 메모리 사용량을 실제 브라우저에서 추가 확인해야 합니다.
- 현재 성능 지표는 특정 하드웨어에서 검증된 벤치마크가 아닙니다.
- 운동 및 자세 안내는 의료적 진단이나 부상 방지를 보장하지 않습니다.

## 프로젝트 배경

이 프로젝트는 Microsoft AI School 8기 1차 팀 프로젝트로 시작했습니다.

원 프로젝트 참여자:

- [김태훈](https://github.com/bauhaus-k)
- [이동현](https://github.com/oliverlee9292)
- [고영후](https://github.com/henryeffel)
- [이재웅](https://github.com/medori9999)
- [허진호](https://github.com/15nayana1021)
- [이누리](https://github.com/Leenurii)
