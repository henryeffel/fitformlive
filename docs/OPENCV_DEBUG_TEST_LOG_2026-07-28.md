# OpenCV.js 디버깅 및 재검증 로그

## 작업 개요

- 작업일: 2026-07-28
- 범위: OpenCV.js 로딩 장애 수정, 자세 추정 우선순위 보완, 실제 브라우저 재검증
- 상태: 로컬 OpenCV.js 로딩 및 팔 컬 10회 인식 확인

## 발생한 문제

초기 실제 테스트에서는 MoveNet 자세 추정과 팔 컬 카운트는 동작했지만 다음 상태가 확인됐다.

```text
OpenCV.js: unavailable
brightness: -
sharpness: -
quality analysis: 0.0 ms
```

브라우저 콘솔에는 기존 OpenCV 공식 문서 서버의 스크립트를 불러오지 못했다는 오류가 표시됐다.
따라서 영상 품질 분석만 비활성화되고 자세 추정과 카운트는 계속 실행되는 상태였다.

## OpenCV.js 로컬 고정

외부 서버 상태와 직접 파일 접근 정책에 영향을 받지 않도록 다음 파일을 프로젝트에 고정했다.

```text
web/vendor/opencv-4.10.0.js
```

- 패키지: `@techstark/opencv-js@4.10.0-release.1`
- OpenCV 버전: 4.10.0
- 파일 크기: 10,378,215 bytes
- 라이선스: Apache License 2.0
- SHA-256: `19B46167B59EFBEF9CC3836264B0B657110833E4B1DF84282004B8B3141C048D`

출처와 라이선스 정보는 `web/vendor/NOTICE.md`와
`web/vendor/OPENCV_JS_LICENSE.txt`에 기록했다.

로컬 서버에서 다음 요청이 HTTP 200으로 처리되는 것을 확인했다.

```text
GET /vendor/opencv-4.10.0.js HTTP/1.1 200
```

`favicon.ico`와 Chrome DevTools의 `.well-known/appspecific/com.chrome.devtools.json`
요청에서 발생한 404는 애플리케이션 기능과 무관한 선택적 파일 요청이다.

## 자세 추정 우선순위 보완

OpenCV가 정상 로딩되면서 이전에는 실행되지 않던 품질 분석 경로가 활성화됐다.
핵심 운동 인식에 미치는 영향을 줄이기 위해 다음과 같이 수정했다.

- MoveNet 추론과 카운트 처리 후 OpenCV 품질 분석 실행
- 품질 분석 간격을 500ms에서 1000ms로 변경
- 품질 분석 너비를 320px에서 240px로 변경
- 촬영 환경 경고가 운동 단계 라벨과 성공 상태를 덮어쓰지 않도록 변경
- OpenCV 분석 오류가 발생해도 다음 MoveNet 프레임을 계속 처리하도록 오류 격리

OpenCV는 촬영 환경을 진단하는 보조 기능으로 사용하고,
자세 추정과 반복 횟수 판정을 우선하는 구조로 정리했다.

## 실제 재검증 결과

### 테스트 조건

- 운동: Right Arm Curl
- 조건: normal
- 사용자가 수행한 횟수: 10회
- 화면의 실제 횟수 입력란: 미입력
- 예측 횟수: 10회

### 측정값

```text
exercise: right_curl
rep phase: ready
angle: 154.3
angular velocity: -1593.9 deg/s
fps (EMA): 57.0
model load: 4011.0 ms
inference avg/p50/p95/max: 15.4 / 15.0 / 18.4 / 33.6 ms
frame avg/p50/p95/max: 15.8 / 15.4 / 19.4 / 34.0 ms
performance samples: 3000
warm-up frames remaining: 0
inference errors: 0
true / predicted reps: - / 10
absolute rep error: -
valid frames: 6105
invalid frames: 973
valid joint rate: 86.3%
OpenCV.js: ready
brightness: 89.5
sharpness: 2518.4
quality analysis: 6.8 ms
quality warning: none
EMA alpha: 0.35
min confidence: 0.4
```

## 결과 해석

- OpenCV.js가 `ready` 상태로 정상 초기화됐다.
- 밝기와 선명도 측정값이 생성됐으며 품질 경고는 발생하지 않았다.
- OpenCV 품질 분석 1회 처리시간은 6.8ms였다.
- 평균 MoveNet 추론시간은 15.4ms, P95는 18.4ms였다.
- EMA FPS는 57.0이며 추론 오류는 없었다.
- 사용자가 수행한 팔 컬 10회를 시스템도 10회로 예측했다.
- 이전 테스트의 유효 관절 검출률 83.2%보다 높은 86.3%를 기록했다.

실제 횟수 입력란이 비어 있어 애플리케이션이 절대 오차를 계산하지는 않았다.
다음 테스트부터 실제 횟수 `10`을 입력해 `absolute rep error: 0`을 결과 파일에 남긴다.

## 발견된 후속 개선점

현재 프레임의 각속도가 `-1593.9 deg/s`로 표시됐다.
관절을 잠시 놓쳤다가 다시 검출하거나 프레임 사이 좌표가 급격히 변하면서 발생한 이상치로 추정한다.

다음 작업에서는 다음 항목을 우선 검토한다.

1. 유효하지 않은 프레임 이후 이전 각도와 시간 기준값 초기화
2. 지나치게 짧은 시간 간격의 각속도 계산 생략
3. 최대 허용 각속도를 넘는 값을 이상치로 제외
4. 제외된 각속도 이상치 개수 기록
5. 수정 전후 팔 컬 회귀 테스트

## 결론

OpenCV.js 로컬 고정과 품질 분석 활성화 이후에도 MoveNet 추론,
운동 단계 판정 및 팔 컬 10회 카운트가 정상 동작하는 것을 확인했다.

현재 가장 우선적인 후속 작업은 각속도 이상치 처리와 실제 횟수를 입력한 반복 테스트 결과 축적이다.
