# Phase 9 작업 로그

## 작업 목표

실제 카메라 영상을 저장하지 않고 MoveNet 관절 좌표를 재현 가능한 JSON
fixture로 저장한다. 동일 입력을 오프라인에서 반복 실행할 수 있는 평가 기반을
만드는 것이 목적이다.

## 구현 내용

- `web/js/pose-fixture.js`에 브라우저와 Node 테스트가 공유하는 recorder 구현
- 17개 MoveNet 관절의 `x`, `y`, `score` 저장
- 좌표를 영상 너비와 높이로 나눈 normalized 좌표계 사용
- `performance.now()` 기준 상대 timestamp 저장
- 캡처 당시 알고리즘 버전, dirty 상태, 설정값과 영상 메타데이터 저장
- 시도 횟수와 완전 동작 횟수 분리
- 추적 손실, 상태 초기화, 추적 복구, 반복 카운트 이벤트 저장
- 개발자 도구에 기록 시작·중지와 fixture 다운로드 버튼 추가

## 자동 검증

저장 전에 다음 조건을 검사한다.

1. 지원하는 `schemaVersion`인지 확인
2. frame이 한 개 이상 존재하는지 확인
3. timestamp가 단조 증가하는지 확인
4. 모든 frame에 스키마 순서대로 17개 관절이 존재하는지 확인
5. 알고리즘 버전과 캡처 설정이 존재하는지 확인
6. JSON 직렬화 후 다시 파싱해도 검증을 통과하는지 확인

자동 테스트 결과:

```text
Test Files  4 passed (4)
Tests       15 passed (15)
```

## 실제 fixture 1차 수집 결과

Downloads에서 다음 실제 카메라 fixture를 프로젝트의 `tests/fixtures/`로
편입했다.

| 조건 | 브라우저 완전 동작 판정 | 정답 | 유효 관절률 |
|---|---:|---:|---:|
| 정상 | 10 | 10 | 52.4% |
| 불완전 | 0 | 0 | 60.9% |
| 관절 가림 | 0 | 3 | 9.4% |

가림 조건은 전체 2,950프레임 중 2,669프레임이 필수 관절 confidence
미달이었다. 따라서 복구 후 완전 동작도 안정적으로 판정하지 못했다.

## Offline runner

다음 명령으로 실제 fixture를 재실행하고 진단 결과를 출력한다.

```powershell
npm.cmd run fixture:run -- tests/fixtures/curl-normal-01.json
```

기존 1차 fixture는 schema 1.0으로 기록 시작 당시 EMA, 상태 머신과
`workoutStarted` 상태가 없다. 브라우저 결과와 offline runner 결과가 달라질
수 있으므로 결정론적 회귀 입력이 아니라 진단 데이터로 표시한다.

이 문제를 해결하기 위해 새 fixture schema를 1.1로 변경했다.

- 운동 카운트 분석이 활성화된 이후에만 기록 시작 허용
- 기록 시작 시 rep, EMA, invalid 상태 초기화
- `initialAlgorithmState`와 `analysisActiveAtCapture` 저장
- 250ms 미만의 짧은 tracking 흔들림은 이벤트에서 제외

## 재수집 순서

schema 1.1로 다음 fixture를 다시 수집한다.

1. `curl-normal-01.json`
2. `curl-partial-01.json`
3. `curl-occlusion-01.json`

불완전 컬은 `attemptedReps: 5`, `completeReps: 0`으로 기록한다.
가림 테스트에서는 `TRACKING_LOST → STATE_RESET → TRACKING_RECOVERED` 이벤트
순서를 확인한다.

## 다음 작업

1. 실제 브라우저에서 schema 1.1 fixture 세 개 재수집
2. runner의 `deterministicReplay: true` 확인
3. 브라우저와 runner의 predicted reps 및 상태 이벤트 일치 확인
4. 정상·불완전·가림 조건별 결과 비교표 작성
