# Phase 2 작업 로그

## 작업 개요

- 작업일: 2026-07-27
- Phase: 2 — OpenCV.js 영상 품질 분석
- 기준 문서: `docs/VIDEO_ALGORITHM_DEVELOPMENT_PLAN.md`
- 변경 파일: `web/index.html`
- 상태: 구현 및 정적 검증 완료, 실제 카메라 환경에서 임계값과 메모리 사용 검증 필요

## 작업 목적

OpenCV를 단순 기술 스택 표시용으로 추가하지 않고, MoveNet 자세 추정의 입력 품질에 영향을 주는 촬영 환경을 분석하는 데 사용한다.

이번 Phase에서는 다음 두 가지 입력 품질을 측정한다.

- grayscale 평균값을 이용한 프레임 밝기
- Laplacian 결과의 분산을 이용한 프레임 선명도

## 참고한 공식 문서

- [OpenCV.js 사용 및 비동기 로딩](https://docs.opencv.org/4.10.0/d0/d84/tutorial_js_usage.html)
- [OpenCV.js 비디오 처리](https://docs.opencv.org/master/dd/d00/tutorial_js_video_display.html)
- [OpenCV Laplacian 연산자](https://docs.opencv.org/4.12.0/d5/db5/tutorial_laplace_operator.html)

공식 문서에 따라 OpenCV.js 준비 이후에 `cv.Mat`을 생성하며, 생성한 Mat은 작업 종료 시 명시적으로 `delete()` 한다.

## 구현 내용

### 1. OpenCV.js 비동기 로딩

고정 버전인 OpenCV.js 4.10.0을 비동기로 로드한다.

```text
https://docs.opencv.org/4.10.0/opencv.js
```

로딩 방식은 다음 상황을 처리한다.

- Emscripten `Module.onRuntimeInitialized` 호출
- `cv`가 Promise 형태로 제공되는 빌드
- 스크립트 네트워크 로딩 실패
- 중복 ready 이벤트 방지

OpenCV.js를 불러오지 못하더라도 MoveNet 자세 추정과 운동 횟수 판정은 계속 동작한다. 품질 분석만 `unavailable` 상태로 전환한다.

### 2. 분석용 축소 캔버스

원본 1280×720 프레임 전체를 처리하지 않고 너비 320px의 메모리 캔버스로 축소한다.

- 너비: 320px
- 높이: 원본 영상 종횡비로 계산
- DOM 화면에는 표시하지 않음
- `willReadFrequently` canvas context 사용

축소된 프레임은 밝기와 전역 선명도 측정에 충분하며 처리 부하와 메모리 할당량을 줄인다.

### 3. 분석 주기 제한

OpenCV 분석은 매 MoveNet 프레임마다 실행하지 않는다.

- 분석 간격: 500ms
- 예상 실행 빈도: 초당 약 2회
- MoveNet 추론 루프와 같은 브라우저 스레드에서 실행

분석에 걸린 시간은 `quality analysis` 값으로 측정해 개발자 도구에 표시한다.

### 4. 밝기 측정

처리 과정:

```text
RGBA frame
  → cv.COLOR_RGBA2GRAY
  → cv.mean(gray)[0]
```

초기 밝기 임계값은 `55`다.

평균 밝기가 55 미만이면 다음 안내를 표시한다.

> 조명이 어둡습니다. 얼굴과 관절이 보이도록 밝기를 높여주세요.

이 값은 절대적인 카메라 품질 기준이 아니라 실제 웹캠 테스트를 위한 초기값이다.

### 5. 선명도 측정

처리 과정:

```text
grayscale
  → 3×3 Gaussian blur
  → Laplacian, CV_64F
  → 표준편차 계산
  → variance = stddev²
```

초기 선명도 임계값은 `80`이다.

Laplacian variance가 80 미만이면 다음 안내를 표시한다.

> 영상이 흐립니다. 카메라를 고정하고 렌즈를 확인하세요.

밝기와 흐림이 동시에 기준 미달이면 낮은 조도 안내를 먼저 표시한다. 낮은 조도 자체가 Laplacian 응답을 낮출 수 있기 때문이다.

### 6. 운동 피드백 연결

관절 confidence 검사가 통과한 경우에도 프레임 품질 경고가 있으면 HUD에 촬영 환경 안내를 우선 표시한다.

품질 경고가 발생해도:

- MoveNet 추론은 중단하지 않는다.
- 운동 상태 머신은 계속 동작한다.
- 단순한 촬영 환경 경고만 제공한다.

향후 수동 테스트 결과에 따라 심각한 품질 저하 시 판정을 보류하는 정책을 별도로 결정한다.

### 7. 개발자 도구 지표

다음 항목을 추가했다.

- OpenCV.js 상태: `loading`, `ready`, `unavailable`, `error`
- 평균 밝기
- Laplacian variance 선명도
- 품질 분석 처리시간
- 현재 품질 경고

### 8. 메모리 관리

분석 한 번마다 다음 `cv.Mat`이 생성된다.

- `src`
- `gray`
- `blurred`
- `laplacian`
- `mean`
- `stddev`

모든 객체는 `finally`에서 `delete()` 한다. 분석 중간에 예외가 발생해도 이미 생성된 Mat은 해제된다.

## 설정값

| 설정 | 현재 값 | 목적 |
|---|---:|---|
| OpenCV.js 버전 | 4.10.0 | 재현 가능한 고정 버전 |
| 분석 캔버스 너비 | 320px | 처리 부하 감소 |
| 분석 간격 | 500ms | MoveNet 루프 영향 제한 |
| 최소 밝기 | 55 | 낮은 조도 초기 기준 |
| 최소 선명도 | 80 | 흐림 감지 초기 기준 |
| Gaussian kernel | 3×3 | Laplacian 전 노이즈 완화 |

## 검증 결과

### 완료한 자동 검증

- head 초기화 스크립트와 메인 inline JavaScript 문법 검사
- `node --check` 통과
- OpenCV 관련 상태 및 API 참조 정적 검색
- `git diff --check` 통과
- 존재하지 않는 TTS 및 아바타 식별자 없음

### 코드 안전성 확인

- OpenCV 로딩 실패가 자세 추정 루프를 중단하지 않음
- 분석 간격 이전에는 Mat을 생성하지 않음
- 비디오 크기가 준비되지 않은 상태에서는 분석하지 않음
- 모든 Mat을 `finally`에서 해제함
- OpenCV 분석 오류를 품질 분석 내부에서 격리함

## 남은 수동 검증

실제 카메라와 OpenCV WebAssembly 실행환경에서 다음을 확인해야 한다.

1. OpenCV.js가 `ready` 상태로 전환되는지
2. 정상 실내 조명에서 평균 밝기 값
3. 어두운 환경에서 밝기 55 기준의 적절성
4. 정상 초점 상태의 Laplacian variance
5. 의도적으로 렌즈를 흐리게 했을 때 선명도 80 기준의 적절성
6. 분석 활성화 전후 MoveNet FPS 차이
7. 품질 분석 1회 처리시간
8. 카메라를 10분 이상 실행했을 때 메모리 증가 여부
9. OpenCV CDN을 차단해도 자세 추정이 계속 동작하는지

## 알려진 한계

- 밝기와 선명도 임계값은 실제 장비로 보정하지 않은 초기값이다.
- 프레임 전체 평균이므로 사용자 주변 배경의 밝기 영향을 받는다.
- 움직임이 빠른 프레임과 카메라 초점 불량을 모두 `흐림`으로 판단할 수 있다.
- Laplacian variance는 장면의 무늬와 배경 복잡도에 영향을 받는다.
- 현재 품질 분석은 사용자 영역 ROI가 아닌 전체 프레임을 사용한다.
- OpenCV.js는 외부 CDN에 의존한다.

## 다음 작업

Phase 3에서는 성능 모니터링을 정식으로 구현한다.

1. 모델 로딩 시간 측정
2. MoveNet 추론 지연시간 측정
3. 전체 프레임 처리시간과 추론시간 분리
4. 평균/P50/P95/최대 지연시간 계산
5. 안정화된 FPS 계산
6. 세션 결과 JSON 또는 CSV 내보내기

