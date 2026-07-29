# Phase 10: Fixture 계층화와 Canonicalization 계획

## 1. 문서 목적

이 문서는 실제 카메라 관절 데이터 수집부터 offline runner 구현까지 진행한
내용, 최초 계획에서 수정된 부분, 수정 이유와 이후 데이터 검증 전략을
기록한다.

핵심 결론은 다음과 같다.

> 관절 좌표와 timestamp만 저장해서는 촬영 당시 알고리즘 결과를 완전히
> 재현할 수 없다. 회귀 테스트용 파생 데이터와 브라우저 end-to-end 검증
> 데이터를 구분하고, 원본·파생·신규 결정론 fixture의 역할을 분리한다.

## 2. 지금까지 완료한 작업

### 2.1 실시간 자세 분석 파이프라인

- MoveNet SinglePose Lightning 기반 관절 추정
- 필수 관절 confidence 및 화면 범위 검사
- EMA 좌표 평활화
- 팔꿈치 각도 계산
- 유지시간과 히스테리시스 기반 반복 상태 머신
- 장시간 관절 인식 실패 시 진행 상태 초기화
- 각속도 이상치 필터
- OpenCV.js 기반 밝기와 선명도 분석
- FPS, 평균/P50/P95 추론시간과 유효 관절 검출률 측정

### 2.2 자동 테스트와 알고리즘 분리

- 브라우저 UI에서 공통 알고리즘을 `pose-algorithms.js`로 분리
- 각도, 각속도 이상치와 상태 머신 단위 테스트
- 합성 각도 시퀀스 회귀 테스트
- 실제 브라우저와 테스트가 같은 상태 머신 함수를 사용하도록 구성

### 2.3 관절 fixture recorder

`pose-fixture.js`를 추가해 영상 대신 다음 데이터를 저장했다.

- 17개 MoveNet 관절의 normalized `x`, `y`
- 관절 confidence
- `performance.now()` 기반 상대 timestamp
- 운동과 테스트 조건
- 시도 횟수와 완전 동작 횟수
- 캡처 당시 알고리즘 설정
- 알고리즘 기준 커밋과 dirty 상태
- 상태 전환, 추적 손실, 복구와 반복 카운트 이벤트

### 2.4 실제 카메라 fixture 1차 수집

| 조건 | 완전 동작 정답 | 브라우저 판정 | 유효 관절률 |
|---|---:|---:|---:|
| 정상 | 10 | 10 | 52.4% |
| 불완전 의도 | 0 | 0 | 60.9% |
| 관절 가림 | 3 | 0 | 9.4% |

정상 조건은 실제 10회와 브라우저 판정 10회가 일치했다. 불완전 조건은
완전 동작으로 카운트되지 않았다. 가림 조건은 전체 2,950프레임 중
2,669프레임이 필수 관절 confidence 미달이어서 복구 후 동작도 판정하지
못했다.

### 2.5 Offline runner

저장한 관절 입력에 다음 처리를 다시 적용하는 runner를 구현했다.

```text
fixture
→ 필수 관절 confidence 및 화면 범위 검사
→ EMA
→ 관절 각도
→ 유지시간·히스테리시스 상태 머신
→ predicted reps와 진단 이벤트
```

이 과정에서 schema 1.0 fixture의 브라우저 결과와 runner 결과가 일치하지
않는 문제를 발견했다.

## 3. 발견한 문제

### 3.1 입력 프레임만으로는 재현성이 완성되지 않음

schema 1.0에는 다음 캡처 시작 상태가 없다.

- 기록 시작 당시 EMA 좌표
- 상태 머신 phase와 전이 후보
- 이전 무효 프레임 시작 시점
- 반복 횟수
- 실제 운동 분석 활성 여부

동일 관절 프레임을 runner에 입력해도 초기 상태가 다르면 다른 결과가
발생한다. 데이터 수집 성공과 알고리즘 실행 상태 재현은 별도 문제다.

### 3.2 불완전 fixture의 의미가 계획과 다름

불완전 컬은 70~100도까지만 굽히는 명확한 부분 동작을 목표로 했지만,
실제 저장 데이터의 최소 각도는 약 44도였다. 따라서 이 데이터로
“명확한 부분 동작 5회를 모두 차단했다”고 주장하지 않는다.

이 fixture는 수축 임계값 부근에서 설정 변경에 얼마나 민감한지 확인하는
`boundary-contraction` 조건으로 재분류한다.

### 3.3 가림 fixture는 일반 가림보다 강한 추적 실패

가림 fixture의 유효 관절률은 9.4%다. 필수 관절이 대부분의 시간 동안
보이지 않았으므로 3회를 맞히는 성공 조건보다 다음 실패 안전성을
검증하는 데이터로 사용한다.

- 추적 붕괴 중 잘못된 반복을 증가시키지 않는가
- 장시간 무효 입력에서 진행 상태를 초기화하는가
- 복구 가능한 입력이 돌아왔을 때 READY 상태로 복귀하는가

조건 이름은 `tracking-failure`로 재분류한다.

### 3.4 Tracking debounce가 원본 이벤트를 제거함

250ms 미만 추적 흔들림을 이벤트에서 제외하도록 recorder를 수정했지만,
이 방식은 원시 증거를 잃는다. 올바른 구조는 다음과 같다.

```text
raw event log
→ interruption duration 계산
→ 250ms 미만을 jitter로 분류
→ filtered view 생성
```

250ms는 초기 경험적 기준값이며 최적값으로 주장하지 않는다. 원본 이벤트는
항상 보존하고 파생 분석에서만 기준을 적용한다.

## 4. 계획 변경

### 기존 계획

```text
fixture 저장
→ 동일 파일 offline replay
→ 브라우저 결과와 runner 결과 일치
→ ablation
```

### 수정 계획

```text
Raw fixture
→ 원본 증거와 당시 브라우저 이벤트 보존

Canonical derived fixture
→ 객관적인 공통 규칙으로 구간과 초기 상태 표준화
→ 동일 입력 회귀와 ablation

Fresh schema 1.1 fixture
→ 초기 알고리즘 상태까지 저장
→ 브라우저와 runner의 end-to-end parity 검증
```

디렉터리는 다음과 같이 분리한다.

```text
tests/fixtures/raw/
tests/fixtures/canonical/
tests/fixtures/schema-1.1/
```

## 5. Canonicalization 원칙

Canonicalization은 정답 횟수나 runner 출력 횟수를 보고 구간을 선택하지
않는다. 모든 fixture에 같은 객관적 규칙을 적용한다.

### 구간 선택 신호

1. 필수 관절이 confidence와 화면 범위 검사를 통과
2. 연속 유효 표본 사이의 관절 각도 변화량 계산
3. 동일한 시간 간격 안에서 최소 각도 변화량을 넘으면 movement sample
4. 첫 movement sample 이전과 마지막 movement sample 이후에 고정 padding
5. 선택된 구간의 timestamp를 0부터 다시 시작

### 초기 경험적 설정

```text
movementAngleDeltaDeg: 2
maxMovementGapMs: 250
paddingMs: 1000
jitterThresholdMs: 250
```

이 값들은 출력 반복 횟수와 무관하게 모든 fixture에 동일하게 적용한다.
후속 ablation에서 민감도를 비교하기 전까지 최적값으로 표현하지 않는다.

### Provenance

모든 derived fixture에 다음 정보를 저장한다.

- 원본 상대 경로
- 원본 SHA-256
- 변환 도구 버전
- 구간 시작·종료 timestamp
- 적용한 규칙과 설정값
- 파생 데이터 생성 시각
- 고정 초기 알고리즘 상태

원본 파일은 수정하지 않는다.

## 6. 데이터별 역할

| 데이터 | 이름 | 용도 |
|---|---|---|
| Raw 정상 | `curl-normal-01.schema-1.0.json` | 당시 브라우저 10회 결과와 원본 증거 |
| Canonical 정상 | `curl-normal-01.derived.json` | 회귀 및 ablation |
| Raw 경계 수축 | `curl-partial-01.schema-1.0.json` | 최초 수집 의도와 실제 각도 차이 기록 |
| Canonical 경계 수축 | `curl-boundary-contraction-01.derived.json` | 임계값 민감도 분석 |
| Raw 강한 가림 | `curl-occlusion-01.schema-1.0.json` | confidence 붕괴 원본 증거 |
| Canonical 추적 실패 | `curl-tracking-failure-01.derived.json` | 실패 안전성과 상태 초기화 회귀 |
| Fresh schema 1.1 | 추후 최소 1~2개 | 브라우저와 runner parity |

## 7. 완료 기준

1. raw fixture 원본 SHA manifest 생성
2. 원본 파일을 수정하지 않고 derived fixture 생성
3. 모든 derived fixture에 동일 변환 규칙 적용
4. derived fixture의 source SHA 검증
5. timestamp 단조 증가 및 0 기준 재설정
6. 초기 상태가 READY, rep 0, EMA null로 명시
7. raw 이벤트 보존
8. 250ms 기준 jitter와 interruption을 파생 뷰로 분리
9. 같은 derived fixture를 두 번 실행했을 때 동일 결과 생성
10. 테스트와 문서에서 raw 결과, derived 결과와 end-to-end 결과를 구분

## 8. 이후 작업

Canonicalization 완료 후 동일 canonical 입력에 다음 구성을 적용한다.

1. raw coordinate + 단순 임계값 baseline
2. confidence 검사
3. confidence + EMA
4. confidence + EMA + 유지시간·히스테리시스
5. 전체 구성 + 무효 구간 상태 초기화

각 구성에서 predicted reps, 절대 횟수 오차, 무효 프레임률, 상태 초기화
횟수와 전이 시계열을 비교한다.

최종 포트폴리오 전에는 schema 1.1 정상 fixture 1개와 가림 후 복구 fixture
1개를 추가로 수집해 브라우저와 runner parity를 별도로 증명한다.

## 9. 구현 결과

### 디렉터리와 원본 보존

실제 schema 1.0 파일 세 개를 `tests/fixtures/raw/`로 이동하고 파일명을
원본 스키마가 드러나도록 변경했다. `raw/manifest.json`에는 각 파일의
SHA-256, byte 크기와 schema version을 기록했다.

Canonicalization 도구는 다음 명령으로 다시 실행할 수 있다.

```powershell
npm.cmd run fixture:canonicalize
```

도구는 원본 파일을 수정하지 않고 `tests/fixtures/canonical/`에 파생 파일을
생성한다. 생성 시 정답 횟수와 predicted reps를 참조하지 않는다.

### 객관적 구간 선택 결과

| Derived fixture | 원본 구간 | Movement samples | Frames |
|---|---:|---:|---:|
| 정상 | 6.73~81.59초 | 570 | 4,395 |
| 경계 수축 | 4.15~44.36초 | 203 | 2,419 |
| 추적 실패 | 4.46~42.57초 | 24 | 2,240 |

모든 구간은 필수 관절의 연속 유효 각도 변화와 동일한 1초 padding으로
선택했다.

### Canonical replay 결과

| 조건 | Ground truth | Canonical prediction | 오차 | 유효 관절률 |
|---|---:|---:|---:|---:|
| 정상 | 10 | 13 | 3 | 61.5% |
| 경계 수축 | 0 | 3 | 3 | 76.2% |
| 추적 실패 | 3 | 1 | 2 | 12.4% |

이 결과는 canonicalization 실패가 아니라, 초기 상태를 통일한 동일 입력에서
현재 알고리즘이 생성하는 결정론적 baseline이다. 정답에 맞게 구간을 자르지
않았기 때문에 정상과 경계 조건의 추가 전이 후보도 그대로 드러났다.

따라서 raw 브라우저 결과와 canonical 결과를 혼용하지 않는다.

- Raw 정상 결과: 촬영 당시 브라우저에서 10회
- Canonical 정상 baseline: 고정 READY/EMA null 상태에서 13회
- Raw 경계 수축 결과: 촬영 당시 브라우저에서 0회
- Canonical 경계 baseline: 고정 초기 상태에서 3회
- Tracking failure: 성공 정확도보다 추적 붕괴 중 실패 안전성 분석

### 이벤트 보존 방식 수정

Recorder는 `TRACKING_LOST`와 `TRACKING_RECOVERED` 원시 이벤트를 다시 모두
저장한다. 250ms 기준은 `eventViews.interruptions`에서만 다음 두 유형을
분류한다.

```text
duration < 250ms  → jitter
duration >= 250ms → interruption
```

기준값은 `thresholdBasis: initial_empirical_value`로 명시한다.

Canonical 데이터의 분류 결과:

| 조건 | Jitter | Interruption | 종료되지 않은 interruption |
|---|---:|---:|---:|
| 정상 | 172 | 21 | 1 |
| 경계 수축 | 46 | 5 | 1 |
| 추적 실패 | 22 | 21 | 1 |

### 검증 결과

```text
Test Files  5 passed (5)
Tests       18 passed (18)
```

자동 테스트는 다음을 검증한다.

- raw fixture 구조와 당시 브라우저 카운트 이벤트
- manifest/source SHA 일치
- 모든 파생 파일이 동일 규칙을 사용
- 정답이나 predicted reps를 구간 선택에 사용하지 않음
- canonicalization 재실행 결과의 완전한 동일성
- 동일 canonical 입력을 두 번 replay했을 때 결과와 이벤트 동일
- raw 이벤트와 파생 jitter 분류 분리

## 10. 바로 다음 작업

Canonical fixture를 고정 입력으로 사용해 ablation runner를 구현한다.

첫 비교는 다음 다섯 구성으로 제한한다.

```text
A. 단순 각도 임계값
B. confidence + 각도 임계값
C. confidence + EMA
D. confidence + EMA + 유지시간·히스테리시스
E. 전체 구성 + 무효 구간 상태 초기화
```

각 조건에서 predicted reps, ground-truth 대비 절대 오차, 유효 프레임률,
상태 전이 수와 초기화 횟수를 동일 표로 출력한다. Canonical 결과는
알고리즘 구성 비교용이며 end-to-end 정확도 결과로 표현하지 않는다.

이 작업은 Phase 11에서 6개 누적 구성으로 완료했다. 결과와 해석은
`docs/PHASE_11_ABLATION_RESULTS.md`를 기준으로 한다.
