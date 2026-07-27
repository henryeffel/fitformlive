# Phase 5 작업 로그

## 작업 개요

- 작업일: 2026-07-27
- Phase: 5 — 지원용 문서 정리
- 기준 문서: `docs/VIDEO_ALGORITHM_DEVELOPMENT_PLAN.md`
- 변경 파일: `README.md`, `web/index.html`
- 상태: 현재 구현 기준 README 작성 완료, 실제 결과와 최신 화면 자료는 수동 테스트 후 추가

## 작업 목적

README가 과거 팀 프로젝트의 기능과 제거된 ML·아바타·Azure 기능을 중심으로 보이지 않도록 현재 실제 코드의 영상처리 알고리즘과 성능 검증 구조를 정확하게 설명한다.

측정하지 않은 정확도, FPS 또는 지연시간은 작성하지 않는다.

## README 변경 내용

### 프로젝트 정의

프로젝트를 다음과 같이 재정의했다.

> 웹캠 영상에서 신체 관절을 실시간으로 추정하고, 영상 품질 분석과 관절 좌표 후처리를 거쳐 운동 횟수와 자세 상태를 판정하는 브라우저 기반 영상처리 프로젝트

### 핵심 기능

현재 코드에 존재하는 기능만 정리했다.

- 웹캠 영상 입력
- MoveNet Lightning 자세 추정
- 관절 confidence와 화면 범위 검사
- EMA 좌표 평활화
- 관절 각도와 각속도 계산
- 시간 기반 횟수 상태 머신
- OpenCV.js 밝기·선명도 분석
- 성능 계측
- JSON/CSV 검증 결과 저장

### 파이프라인

과거 `images/pipeline.png`를 README에서 직접 사용하지 않고 현재 구현과 일치하는 텍스트 파이프라인으로 교체했다.

```text
Webcam
  → OpenCV.js
  → MoveNet
  → Joint validation
  → EMA smoothing
  → Angle and velocity
  → State machine
  → Feedback and metrics
  → Evaluation result
```

### 알고리즘 설명

다음 내용을 코드 설정값과 일치하도록 설명했다.

- confidence `0.4`
- EMA alpha `0.35`
- 최저점·복귀점 유지시간 `180ms`
- 히스테리시스 `8°`
- invalid 상태 초기화 `1초`
- OpenCV 분석 간격 `500ms`
- 밝기 초기값 `55`
- 선명도 초기값 `80`

### 실행 방법

로컬 HTTP 서버 실행 명령을 추가했다.

```powershell
python -m http.server 8000 --directory web
```

접속 주소:

```text
http://localhost:8000
```

파일 직접 열기 대신 로컬 서버를 사용해야 하는 이유와 카메라 권한, CDN 인터넷 연결 요구사항도 설명했다.

### 성능 검증

다음 측정 항목과 계산 방법을 설명했다.

- 모델 로딩 시간
- 추론 average/P50/P95/max
- 전체 프레임 average/P50/P95/max
- EMA FPS
- 유효 관절 검출률
- OpenCV 분석시간
- 워밍업 5프레임 제외
- 최대 3,000개 샘플

실제 동일 환경 테스트를 수행하지 않았음을 명시하고 임의의 수치를 작성하지 않았다.

### 제한적 기능 검증

README에서 다음 문서로 연결했다.

- `docs/MANUAL_TEST_PROTOCOL.md`
- `evaluation/test-results-template.csv`

대규모 모델 정확도 평가가 아니라 제한된 시스템 기능 검증이라는 범위를 명시했다.

### 기술 스택

기술 이름만 나열하지 않고 실제 사용 목적을 표로 정리했다.

| 기술 | 실제 역할 |
|---|---|
| JavaScript | 후처리, 상태 머신, 계측 |
| TensorFlow.js | 브라우저 추론 |
| MoveNet | 관절 추정 |
| OpenCV.js | 밝기와 선명도 분석 |
| Canvas API | 렌더링 |
| MediaDevices API | 카메라 입력 |

### 프로젝트 구조와 문서 링크

현재 저장소 구조와 Phase 0~4 작업 로그를 README에서 확인할 수 있도록 링크했다.

### 알려진 한계

다음 내용을 명확하게 공개했다.

- 임계값 최종 보정 전
- 전체 프레임 기반 영상 품질 분석
- 단일 인체 2D 추정
- 카메라 방향과 원근의 영향
- 스쿼트 왼쪽 다리 기준
- 장시간 메모리 검증 전
- 특정 하드웨어 벤치마크 전
- 의료적 진단이나 부상 방지를 보장하지 않음

### 프로젝트 출처

Microsoft AI School 팀 프로젝트에서 시작되었음을 유지하고 원 프로젝트 참여자의 GitHub 링크를 간결하게 정리했다.

## 코드 의존성 정리

메인 HTML에 남아 있던 다음 미사용 스크립트를 제거했다.

- `@mediapipe/pose`

현재 자세 추정은 TensorFlow.js pose-detection의 MoveNet 경로만 사용한다.

## 검증 항목

- README 상대 링크 대상 존재 여부
- README의 설정값과 `POSE_CONFIG` 일치 여부
- 지원 운동 목록과 UI 노출 목록 일치 여부
- 외부 라이브러리 설명과 script 태그 일치 여부
- 제거된 ML, 아바타, Azure 및 TTS 기능을 현재 기능으로 주장하지 않는지 확인
- 측정하지 않은 성능 수치가 없는지 확인

## 남은 작업

실제 카메라 테스트 이후 다음 내용을 추가해야 한다.

1. 테스트 환경 표
2. 정상 팔 컬·스쿼트 결과
3. 조건별 실제 횟수와 측정 횟수
4. 평균/P95 추론 지연시간
5. 유효 관절 검출률
6. 임계값 변경 전후 비교
7. 최신 실행 화면 GIF 또는 이미지

현재 `images/demo.*`와 `images/pipeline.png`는 과거 프로젝트 자료다. README에서는 사용하지 않으며, 최신 화면 자료를 만든 뒤 교체 또는 제거한다.

