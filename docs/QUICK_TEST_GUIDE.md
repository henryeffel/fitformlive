# FitForm Live 빠른 테스트 가이드

## 목적

코드 변경 이후에도 카메라, 자세 추정 및 운동 카운트가 정상적으로 동작하는지 확인하고 실제 횟수와 측정 횟수의 차이를 기록한다.

상세한 조건별 검증 절차는 `MANUAL_TEST_PROTOCOL.md`를 참고한다.

## 1. 로컬 서버 실행

프로젝트 루트에서 PowerShell을 열고 실행한다.

```powershell
python -m http.server 8000 --directory web
```

Chrome 또는 Edge에서 다음 주소로 접속한다.

```text
http://localhost:8000
```

### OpenCV.js 로컬 파일 확인

OpenCV.js는 외부 CDN이 아니라 프로젝트의 `web/vendor/opencv-4.10.0.js`에서 불러온다.
처음에는 약 10MB 파일을 읽고 초기화하므로 잠시 기다린다.

1. 브라우저에서 `Ctrl+Shift+R`로 강력 새로고침한다.
2. 개발자 도구의 Network 탭에서 `opencv-4.10.0.js` 응답이 `200`인지 확인한다.
3. 개발자 도구에서 `OpenCV.js: ready`가 표시되는지 확인한다.
4. 카메라 시작 후 `brightness`, `sharpness`가 숫자로 표시되는지 확인한다.

`unavailable`이 계속 표시되면 페이지를 파일로 직접 열지 않았는지 확인하고,
Network 탭의 요청 URL과 HTTP 상태 코드를 테스트 기록에 남긴다.

웹캠 권한과 모델 리소스 로딩 때문에 `web/index.html` 파일을 직접 열지 않고 로컬 HTTP 서버를 사용한다.

## 2. 기본 동작 확인

1. 페이지가 정상적으로 표시되는지 확인한다.
2. `카메라 시작`을 누른다.
3. 웹캠 권한을 허용한다.
4. 영상 위에 스켈레톤이 표시되는지 확인한다.
5. `개발자 도구`에서 다음 항목을 확인한다.

```text
OpenCV.js: ready
valid frames 증가
brightness 숫자 표시
sharpness 숫자 표시
inference 지연시간 표시
fps (EMA) 표시
rejected angular velocity samples 표시
```

OpenCV.js가 `loading`이면 몇 초 기다린다. `unavailable` 또는 `error`이면 인터넷 연결과 브라우저 개발자 콘솔을 확인한다.

각속도가 `1000 deg/s`를 넘는 대신 `0.0 deg/s`로 제외되는지 확인한다.
관절을 잠시 가렸다가 다시 보여주면 첫 유효 프레임은 새 기준점으로 사용되며,
이상치가 감지되면 `rejected angular velocity samples`가 증가한다.

## 3. 정상 팔 컬 회귀 테스트

### 테스트 정보 입력

개발자 도구에서 다음 값을 입력한다.

```text
테스트 ID: curl-normal-01
테스트 조건: 정상 환경
실제 수행 횟수: 10
테스트 메모: 정상 조명, 오른팔 전체가 보이는 거리
```

### 수행 순서

1. `성능 지표 초기화`를 누른다.
2. `트레이닝 모드`로 이동한다.
3. 운동을 `Right Arm Curl`로 선택한다.
4. 오른쪽 어깨·팔꿈치·손목이 모두 화면에 보이게 선다.
5. `운동 시작`을 누른다.
6. 카운트다운 후 팔 컬 10회를 수행한다.
7. 매회 팔을 충분히 굽힌 후 다시 완전히 편다.
8. 운동을 정지한다.
9. `개발자 도구`로 이동한다.
10. 실제 횟수, 예측 횟수 및 절대 오차를 확인한다.
11. JSON과 CSV 결과를 저장한다.

정상 결과 예시:

```text
true reps: 10
predicted reps: 10
absolute rep error: 0
```

예측 횟수가 일치하지 않아도 결과를 삭제하지 않는다. 발생 조건과 누락 또는 중복 상황을 메모한다.

## 4. 카운트 문제 확인 방법

### 상태 머신

개발자 도구의 `rep phase`가 다음 순서로 바뀌는지 확인한다.

```text
ready → bottom_hold → returning → ready
```

- `ready`에서 바뀌지 않음: 팔을 충분히 굽히지 않았을 가능성
- `bottom_hold` 이후 카운트되지 않음: 팔을 충분히 펴지 않았을 가능성
- 빠른 동작만 누락됨: 180ms 유지시간 또는 EMA 반응 지연 가능성

### 관절 검증

`validation` 항목을 확인한다.

정상 상태:

```text
필수 관절 인식 정상
```

문제 상태:

```text
운동에 필요한 관절이 선명하게 보이도록 위치를 조정하세요.
운동에 필요한 관절이 화면 안에 들어오도록 이동하세요.
```

정상 환경에서도 `valid joint rate`가 낮으면 카메라 거리, 조명 또는 confidence 기준을 검토한다.

## 5. 최소 추가 테스트

### 불완전 팔 컬

```text
테스트 ID: curl-partial-01
테스트 조건: 동작 범위 부족
실제 수행 횟수: 0
```

팔을 절반 정도만 굽히는 동작을 5회 시도한다.

여기서 실제 수행 횟수는 시도 횟수 5회가 아니라 올바르게 완료한 횟수 `0`이다.

기대 결과:

```text
predicted reps: 0
```

### 빠른 팔 컬

```text
테스트 ID: curl-fast-01
테스트 조건: 빠른 동작
실제 수행 횟수: 10
```

팔 컬 10회를 빠르게 수행한다. 누락이 발생하면 횟수와 `rep phase` 변화를 메모한다.

### 관절 가림

```text
테스트 ID: curl-occlusion-01
테스트 조건: 관절 일부 가림
```

운동 중 오른쪽 손목 또는 팔꿈치를 약 2초간 가린다.

확인 사항:

- 관절 인식 경고가 표시되는가
- 가림 중 횟수가 증가하지 않는가
- 관절이 다시 보이면 새 반복을 정상적으로 측정하는가

## 6. 스쿼트 테스트

```text
테스트 ID: squat-normal-01
테스트 조건: 정상 환경
실제 수행 횟수: 10
```

1. `Squat`을 선택한다.
2. 왼쪽 엉덩이·무릎·발목이 잘 보이도록 약간 측면으로 선다.
3. 정상 스쿼트 10회를 수행한다.
4. 실제 횟수와 예측 횟수를 비교한다.

현재 스쿼트는 왼쪽 다리 관절 각도를 기준으로 분석한다.

## 7. 결과 저장

각 테스트 후 개발자 도구에서 저장한다.

- `JSON 결과 저장`: 설정, 환경, 원본 지연시간 샘플 포함
- `CSV 결과 저장`: 테스트 한 건의 요약
- `영상·관절 기록 시작/중지`: 같은 세션 시간축으로 WebM과 keypoint를 기록
- `세션 JSON 저장`: schema 1.2 keypoint·FSM event·영상 metadata
- `세션 영상 저장`: 세션 JSON의 `capture.video.filename`과 이름이 같은 WebM

P3-B 촬영은 운동 시작 후 테스트 ID를 입력하고 `영상·관절 기록 시작`을 누른다.
촬영 전에 `촬영 저장 폴더 선택`을 눌러 프로젝트의 `data/recordings/raw`를 선택한다.
동작이 끝나 기록을 중지하면 JSON과 WebM이 해당 폴더에 자동 저장된다. 두 파일의 기본
이름은 같은 test ID를 사용한다.

Chrome/Edge가 폴더 직접 저장을 지원하지 않거나 권한이 거부되면 기존 저장 버튼이
Downloads fallback으로 동작한다.

```powershell
cd python
python -m pip install -e ".[annotation]"
python -m streamlit run app\annotation_app.py
```

사이드바에 세션 JSON과 WebM을 함께 올리고 `영상·관절 탐색 위치`를 움직여 skeleton과
실제 동작이 일치하는지 확인한다.

다운로드한 파일을 다음 폴더에 복사할 수 있다.

```text
evaluation/results/
```

`data/recordings/raw`, `annotations`, `processed`의 실제 결과 파일은 Git 추적에서
제외되어 있다. 개인 얼굴이 포함된 영상은 저장소에 커밋하지 않는다.

## 8. 시간이 부족할 때의 최소 범위

다음 두 테스트만 먼저 수행한다.

1. 정상 팔 컬 10회
2. 불완전 팔 컬 5회 시도, 올바른 완료 횟수 0회

예상 소요 시간은 약 10~15분이다.

테스트 후 다음 값을 기록한다.

- 실제 횟수
- 예측 횟수
- 절대 오차
- 유효 관절 검출률
- EMA FPS
- 평균/P95 추론시간
- 발생한 문제와 촬영 조건
