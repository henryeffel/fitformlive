# FitForm Live 작업 기록

작성일: 2026-07-30
범위: P3-B 영상 동기화 구현, 실제 영상 세션 수집, 조건별 진단

---

## 1. 오늘의 목표

기존 trace-only annotation 환경을 실제 영상 기반 평가 환경으로 확장했다.

```text
브라우저
→ WebM + keypoint + timestamp + FSM event 동시 기록

Python
→ video frame과 pose timestamp 동기화
→ skeleton/angle/FSM overlay
→ cycle-level annotation 준비
```

기존 JavaScript 판정 로직은 source of truth로 유지한다. Python은 기록된 세션을
시각화하고 ground truth와 prediction을 비교하는 평가 계층으로 사용한다.

---

## 2. 브라우저 동시 기록

### schema 1.2

`web/js/pose-fixture.js`를 schema 1.2로 확장했다.

각 세션 JSON에는 다음 데이터가 포함된다.

- normalized MoveNet keypoint 17개
- frame timestamp
- 필수 관절 validation 결과
- processed angle
- rep count
- FSM phase와 event
- tracking lost/recovered/reset event
- 영상 filename, MIME type, 크기와 duration
- MediaRecorder chunk timestamp

### 영상 recorder

`web/js/video-session-recorder.js`를 추가했다.

- `MediaRecorder` 기반 WebM 기록
- VP9 → VP8 → WebM 순서의 MIME fallback
- pose recorder와 같은 `performance.now()` 시작 시각 사용
- 1초 단위 chunk timeline 기록
- JSON과 WebM에 동일한 test ID 사용

### 프로젝트 폴더 직접 저장

`web/js/session-file-storage.js`를 추가했다.

Chrome/Edge File System Access API로 다음 폴더를 사용자가 선택한다.

```text
data/recordings/
├─ raw/
├─ annotations/
└─ processed/
```

`data/recordings/raw`를 선택하면 기록 종료 시 다음 파일을 자동 저장한다.

```text
<testId>.json
<testId>.webm
```

성능 JSON과 CSV 저장 버튼도 선택한 폴더를 사용한다. 폴더 API를 지원하지 않거나
권한이 없으면 Downloads 방식으로 fallback한다. 실제 촬영 파일은 `.gitignore`로
제외했다.

브라우저를 새로고침하면 directory handle은 사라지므로 촬영 전에 폴더를 다시
선택해야 한다.

---

## 3. Python 영상 동기화

`python/src/fitform_eval/video_sync.py`를 추가했다.

구현 범위:

- schema 1.2 fixture를 기존 annotation trace 계약으로 변환
- event timestamp를 가장 가까운 pose frame에 연결
- REP_COUNTED event의 한 frame 지연 보정
- 선택한 timestamp와 가장 가까운 pose frame 검색
- OpenCV video frame 디코딩
- skeleton, angle, phase, rep count overlay
- video timestamp와 pose timestamp 차이 표시

Chrome VP9 WebM은 일부 OpenCV/FFmpeg 조합에서 FPS와 frame count를 잘못 반환하고
random seek가 첫 frame으로 돌아가는 문제가 있었다. seek 결과 timestamp가 목표와
500ms 이상 다르면 순차 디코딩으로 fallback하도록 수정했다.

Streamlit annotation UI는 다음 두 입력 방식을 지원한다.

1. schema 1.2 세션 JSON + WebM
2. 기존 F_FULL trace JSON

영상 세션에서는 millisecond slider로 실제 동작과 skeleton을 함께 확인한 뒤
cycle-level annotation을 작성할 수 있다.

---

## 4. 실제 촬영 결과

### 4.1 정상 속도 기준 세션

세션: `curl-normal-pytest-01`

| 지표 | 결과 |
| --- | ---: |
| 실제 완료 | 10 |
| 알고리즘 판정 | 10 |
| absolute rep error | 0 |
| 영상 길이 | 약 48.4초 |
| pose frame | 2,296 |
| 유효 관절률 | 91.0% |
| 대표 video-pose delta | 약 24ms |

skeleton이 실제 팔과 어깨에 일치하는 것을 영상 frame에서 확인했다.

### 4.2 빠른 동작 첫 촬영

세션: `curl-fast-01`

| 지표 | 결과 |
| --- | ---: |
| 실제 완료 | 10 |
| 알고리즘 판정 | 1 |
| 유효 관절률 | 33.2% |
| 화면 밖 관절 오류 | 1,107 frame |
| 낮은 confidence | 118 frame |
| 최대 tracking loss | 약 1.73초 |

실패 원인은 속도 자체가 아니었다. 오른쪽 어깨 y 좌표가 화면 상단 경계에 있었고
많은 frame에서 음수 좌표가 됐다. 필수 관절 하나가 화면 밖으로 나가 전체 pose
validation이 실패했다.

### 4.3 빠른 동작 재촬영

세션: `curl-fast-02`

카메라에서 뒤로 이동해 어깨를 화면 높이의 약 10.3~14.6%에 유지했다.

| 지표 | 결과 |
| --- | ---: |
| 실제 완료 | 10 |
| 알고리즘 판정 | 10 |
| absolute rep error | 0 |
| 유효 관절률 | 99.4% |
| 무효 frame | 9 |
| 250ms 이상 tracking loss | 0 |
| 최대 tracking loss | 약 45.5ms |
| 대표 video-pose delta | 약 3~37ms |

결론:

> 빠른 동작에서도 필수 관절이 화면에 안정적으로 포함되면 MoveNet과 production
> FSM은 이번 세션의 10회를 모두 판정했다. `curl-fast-01` 실패의 직접 원인은
> 속도가 아니라 촬영 구도였다.

### 4.4 부분 수축

세션: `curl-partial-01`

| 지표 | 결과 |
| --- | ---: |
| 시도 | 5 |
| 올바른 완료 | 0 |
| production FSM 판정 | 2 |
| false positive | 2 |
| 유효 관절률 | 78.1% |
| 250ms 이상 tracking loss | 0 |
| 대표 video-pose delta | 약 43ms |

다섯 동작의 최소 각도:

| 동작 | 최소 각도 | production 결과 |
| --- | ---: | --- |
| 1 | 64.6° | 거부 |
| 2 | 57.0° | 거부 |
| 3 | 58.7° | 거부 |
| 4 | 44.9° | count |
| 5 | 41.6° | count |

현재 production FSM은 `down=60°`와 8° hysteresis를 사용하므로 약 52°보다 깊은
마지막 두 동작을 완전 수축으로 판정했다. 영상에서는 손이 어깨까지 도달하지 않은
부분 수축으로 확인됐다.

기존 fixture에서 도출한 탐색적 full-contraction 기준 약 36.4°를 적용하면 이번
다섯 동작은 모두 거부할 가능성이 있다. 다음 단계에서 동일 입력 replay로 직접
검증한다.

### 4.5 장시간 가림

세션: `curl-occlusion-01`

| 지표 | 결과 |
| --- | ---: |
| 실제 완료 | 5 |
| 알고리즘 판정 | 3 |
| 가림 중 false positive | 0 |
| 유효 관절률 | 63.6% |
| tracking timeout reset | 3 |

주요 추적 실패:

| 구간 | 지속시간 | 영상 확인 |
| --- | ---: | --- |
| 8.26~10.53초 | 약 2.27초 | 손으로 카메라 완전 가림 |
| 13.71~15.83초 | 약 2.11초 | 손으로 카메라 대부분 가림 |
| 23.78~28.32초 | 약 4.54초 | 운동 종료 후 팔이 화면 아래로 이탈 |
| 28.36초~종료 | open | 종료 자세에서 관절 미검출 |

가림 중 수행한 두 동작은 관측할 수 없어 누락됐다. 반면 가림 중 count는 발생하지
않았고 1초 이후 FSM을 초기화했으며, 복구 후 새 동작부터 count를 재개했다.

결론:

> 입력을 볼 수 없는 동안 횟수를 추측하지 않고 진행 상태를 폐기했다. 장시간 가림
> 중 false positive를 방지하고 복구 후 판정을 재개했지만, 가림 중 실제 반복을
> 복원하지는 못한다.

이 세션으로 tracking timeout 안전성은 확인했으므로 추가 가림 촬영은 현재
우선순위가 아니다.

---

## 5. 촬영에서 발견한 운영 규칙

1. 촬영 전에 `data/recordings/raw`를 다시 선택한다.
2. 머리와 양쪽 어깨를 포함하고 어깨를 화면 상단에서 최소 10% 아래에 둔다.
3. 손목이 최저점에서도 화면 안에 남도록 한다.
4. 영상 시작과 종료에 1~2초의 안정 자세를 둔다.
5. 성능 CSV의 전체 valid rate와 세션 JSON의 capture valid rate는 측정 구간이
   다를 수 있으므로 혼용하지 않는다.
6. 얼굴이 포함된 WebM은 명시적으로 선택하지 않는 한 Git에 커밋하지 않는다.

---

## 6. 구현 중 수정한 문제

- OpenCV VP9 WebM random seek fallback
- REP_COUNTED event와 pose frame 사이 한 frame 지연
- 기록 시작 직후 processed angle `0°` 저장
- Windows CRLF에 따른 canonical source SHA 불일치
- 성능 JSON/CSV가 선택 폴더 대신 Downloads로 저장되는 문제
- schema 1.2의 video metadata 검증

---

## 7. 자동 검증

JavaScript:

```text
11 test files
34 tests passed
```

Python:

```text
19 tests passed
```

추가 검증:

- HTML inline JavaScript 문법 검사
- 웹 앱 HTTP 200
- video recorder module HTTP 200
- Streamlit health HTTP 200
- 실제 VP9 WebM의 초기·중간·후반 frame 디코딩
- 실제 영상 skeleton overlay 육안 확인

---

## 8. 현재 확보한 영상 증거

| 세션 | 역할 | 핵심 결과 |
| --- | --- | --- |
| `curl-normal-pytest-01` | 정상 기준 | 10/10 |
| `curl-fast-02` | 속도 변화 | 10/10, valid 99.4% |
| `curl-partial-01` | incomplete rejection | GT 0, production FP 2 |
| `curl-occlusion-01` | tracking failure safety | 가림 중 FP 0, 복구 후 재개 |

`curl-fast-01`은 촬영 구도 실패 사례로 보존한다. 속도 실패 사례로 사용하지 않는다.

---

## 9. 다음 작업

추가 촬영보다 현재 영상의 cycle-level annotation과 동일 입력 비교를 우선한다.

```text
영상 기반 cycle annotation
→ production FSM replay
→ exploratory full-contraction FSM replay
→ P4 actual batch evaluation
→ 조건별 TP/FP/FN과 latency
```

핵심 검증 질문:

> 약 36.4° full-contraction 기준이 `curl-partial-01`의 false positive 2회를 제거하면서
> 정상과 빠른 동작의 올바른 반복을 유지하는가?

이 결과가 확인되기 전에는 약 36.4°를 production 최적값이나 일반화된 threshold로
표현하지 않는다.
