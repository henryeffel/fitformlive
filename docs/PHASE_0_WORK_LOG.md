# Phase 0 작업 로그

## 작업 개요

- 작업일: 2026-07-27
- Phase: 0 — 안전한 정리
- 기준 문서: `docs/VIDEO_ALGORITHM_DEVELOPMENT_PLAN.md`
- 최종 실행본: `web/index.html`
- 상태: 코드 정리 및 정적 검증 완료, 브라우저 카메라 수동 확인 필요

## 작업 목적

영상처리 알고리즘 개발을 시작하기 전에 메인 애플리케이션과 연결되지 않거나 지원 방향과 관련성이 낮은 기능을 제거하고, 단일 실행본을 기준으로 개발할 수 있는 상태를 만든다.

## 사전 확인

전체 파일과 참조 관계를 검색하여 다음 내용을 확인했다.

- 실제 통합 실행본은 `web/index.html`이다.
- 별도 `avatar/` 폴더 외에도 메인 HTML 내부에 Three.js 아바타 코드가 포함되어 있었다.
- Azure Speech SDK와 `/api/getspeechtoken` 호출이 메인 HTML에 포함되어 있었지만, 토큰 API를 제공하는 백엔드는 저장소에 없었다.
- `classification model/`의 RandomForest 모델과 노트북은 메인 애플리케이션에서 사용되지 않았다.
- `mypt-azure-main-tts/`는 동영상과 Azure TTS 코드가 포함된 과거 중복 버전이었다.
- README와 메인 HTML의 한국어 원문은 UTF-8로 정상 저장되어 있었다. 이전에 보인 깨진 문자는 PowerShell 기본 디코딩 방식에 따른 표시 문제였다.

## 변경 내용

### 메인 애플리케이션 정리

`web/index.html`에서 다음 내용을 제거했다.

- 아바타 모드 메뉴와 뷰
- 아바타 스타일 선택 UI
- 아바타 렌더링 컨테이너와 전신 인식 경고 UI
- Three.js import map
- Three.js 및 GLTFLoader import
- GLB 모델 로딩과 렌더 루프
- MoveNet 관절을 3D bone에 적용하는 코드
- 아바타 모드 전용 상태와 이벤트 분기
- Azure Speech SDK 외부 스크립트
- Speech token API 호출
- TTS 초기화, 음성 캐시 및 아바타 음성 코드

메뉴 전환 코드는 다음 세 화면만 다루도록 단순화했다.

- 트레이닝 모드
- 도전 모드
- 개발자 도구

개발자 도구 설명도 ML 모델 분석 문구에서 관절 좌표, 운동 판정 상태 및 영상처리 성능 지표를 확인하는 방향으로 변경했다.

### 삭제한 디렉터리

다음 디렉터리를 삭제했다.

| 경로 | 삭제 이유 |
|---|---|
| `avatar/` | 사용하지 않는 별도 3D 아바타 실험 |
| `classification model/` | 메인 앱과 연결되지 않은 ML 학습 실험 |
| `mypt-azure-main-tts/` | Azure TTS가 포함된 과거 중복 데모 |
| `web/models/` | 제거된 아바타 기능의 GLB 리소스 |
| `data/` | 1바이트짜리 미사용 placeholder |
| `output/` | 1바이트짜리 미사용 placeholder |

삭제 전 모든 대상의 절대경로가 프로젝트 작업공간 내부인지 확인했다.

### README 정리

- 프로젝트 제목을 `FitForm Live`로 정리했다.
- 현재 구현에 맞춰 웹캠, MoveNet, 관절 각도 분석을 핵심 파이프라인으로 설명했다.
- 현재 코드에서 사용하지 않는 Python, YOLOv8, OpenCV, Azure 및 Gradio 배지를 제거했다.
- JavaScript, TensorFlow.js 및 MoveNet 배지로 교체했다.
- 제거된 Classification, Avatar, Azure 역할 표현을 현재 범위와 맞는 표현으로 수정했다.

OpenCV.js는 Phase 2에서 실제로 구현한 뒤 README 기술 스택에 추가한다.

## 검증 결과

### 완료한 자동 검증

- `web/index.html`의 inline JavaScript를 추출해 `node --check` 실행
- JavaScript 문법 오류 없음
- 메인 파일에서 다음 문자열의 잔여 참조 검색
  - `avatar`
  - `three`
  - `GLTFLoader`
  - `SpeechSDK`
  - `getspeechtoken`
  - `Azure`
- 삭제한 디렉터리와 모델을 가리키는 메인 코드 참조 없음
- README와 HTML을 UTF-8로 읽었을 때 한국어가 정상 표시됨

### 남은 수동 검증

브라우저 카메라 권한과 실제 MoveNet CDN 로딩은 정적 검사로 검증할 수 없으므로 다음 항목을 직접 확인해야 한다.

1. 로컬 HTTP 서버로 `web/`을 실행한다.
2. 브라우저에서 카메라 권한을 허용한다.
3. 카메라 시작과 정지가 정상 동작하는지 확인한다.
4. 스켈레톤이 영상 위에 표시되는지 확인한다.
5. 운동 시작, 카운트다운, 횟수 초기화가 정상 동작하는지 확인한다.
6. 트레이닝, 도전, 개발자 도구 메뉴 전환을 확인한다.
7. 개발자 콘솔에 `ReferenceError`가 없는지 확인한다.

## 현재 파일 구조

```text
fitformlive/
├─ docs/
│  ├─ VIDEO_ALGORITHM_DEVELOPMENT_PLAN.md
│  └─ PHASE_0_WORK_LOG.md
├─ images/
│  ├─ demo.gif
│  ├─ demo.mp4
│  └─ pipeline.png
├─ web/
│  └─ index.html
├─ jd.png
└─ README.md
```

## 주의사항

- 현재 `.git` 디렉터리가 정상적인 Git 저장소로 인식되지 않아 `git status`나 Git을 통한 복구를 사용할 수 없다.
- 삭제된 파일은 현재 작업공간의 Git 이력으로 복구할 수 없다. 별도 원본 저장소나 백업이 있다면 그곳에서만 복원할 수 있다.
- `images/demo.*`와 `images/pipeline.png`는 과거 기능을 보여줄 수 있으므로 Phase 5에서 현재 구현과 일치하는 자료로 교체해야 한다.
- 메인 HTML에는 제거된 TTS 호출 지점을 안전하게 무시하기 위한 작은 no-op 함수가 남아 있다. Phase 1 리팩터링 때 호출부와 함께 완전히 제거한다.

## 다음 작업

Phase 1에서는 다음 순서로 판정 안정화를 진행한다.

1. 운동별 필수 관절 confidence 검사
2. 잘못된 좌표 및 화면 범위 검사
3. EMA 관절 좌표 평활화
4. `deltaTime` 기반 각도 변화량 계산
5. Right Arm Curl 시간 기반 상태 머신
6. 운동 상태와 오류 원인별 피드백 정리

