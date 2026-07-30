# Phase P3-B 영상 동기화 구현 기록

작성일: 2026-07-30

## 완료 범위

브라우저에서 카메라 stream을 `MediaRecorder`로 WebM에 기록하는 동안 같은
`performance.now()` 기준으로 MoveNet keypoint와 FSM event를 schema 1.2 JSON에
저장한다.

한 세션은 다음 두 파일로 구성된다.

```text
<testId>.json
<testId>.webm
```

Chrome/Edge의 File System Access API로 사용자가 프로젝트의
`data/recordings/raw` 폴더를 선택할 수 있다. 기록을 중지하면 두 파일을 해당 폴더에
자동 저장한다. API 미지원 또는 권한 거부 시 Downloads 방식을 유지한다.

JSON의 `capture.video`에는 filename, MIME type, 크기, duration, chunk timestamp를
기록한다. 각 pose frame에는 normalized keypoint, valid 상태, processed angle,
rep count와 phase를 저장한다.

## Python annotation

Streamlit UI는 schema 1.2 JSON을 기존 trace 계약으로 변환한다. WebM을 함께 올리면
OpenCV가 선택한 millisecond 위치의 video frame을 읽고 가장 가까운 pose frame을
찾는다.

표시 정보:

- skeleton과 유효 keypoint
- processed angle
- FSM phase
- rep count
- video timestamp와 pose timestamp의 차이

이 화면에서 사람이 실제 동작을 확인하며 cycle-level label을 작성하고 기존 P4 quick
evaluation으로 바로 전달할 수 있다.

## 검증

- MediaRecorder MIME 선택과 chunk timeline 단위 테스트
- schema 1.2 fixture 검증 테스트
- fixture-to-trace 변환과 nearest timestamp 테스트
- OpenCV skeleton overlay 테스트
- 기존 canonical fixture의 Windows 줄바꿈 독립 SHA 검증

## 남은 수동 검증

실제 Chrome에서 다음 항목을 확인했다.

1. WebM과 JSON이 같은 test ID로 저장됨
2. 영상 길이와 JSON `capture.durationMs`가 유사함
3. Streamlit slider에서 skeleton이 실제 관절 위치와 일치함
4. 정상 속도, 빠른 동작, 부분 수축, 장시간 가림 조건을 기록함
5. 선택한 `data/recordings/raw`에 JSON, WebM, 성능 JSON/CSV를 저장함

영상 파일에는 얼굴과 촬영 환경이 포함될 수 있으므로 명시적으로 선택하기 전에는 Git에
커밋하지 않는다.

## 실제 세션 결과

| 세션 | 결과 |
| --- | --- |
| `curl-normal-pytest-01` | 정상 10/10, valid 91.0% |
| `curl-fast-01` | 어깨 화면 이탈로 1/10, 촬영 실패 사례 |
| `curl-fast-02` | 빠른 동작 10/10, valid 99.4% |
| `curl-partial-01` | GT 0, production false positive 2 |
| `curl-occlusion-01` | 가림 중 FP 0, 복구 후 count 재개, 최종 3/5 |

상세 수치와 해석은 `PROJECT_WORK_SUMMARY_2026-07-30.md`에 기록했다.
