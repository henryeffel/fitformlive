# Phase P1–P2 — Python 검증 기반과 10 vs 13 Cycle 분석

## 작업 목적

JavaScript는 실시간 운동 판정의 source of truth로 유지하고, Python은 데이터 계약과
평가 분석을 담당하도록 첫 두 단계를 구현했다.

```text
P1: Canonical fixture schema와 validator
P2: Cycle feature analyzer와 10 aligned vs 3 unmatched 비교
```

신규 촬영 없이 기존 canonical fixture와 JavaScript trace를 사용했다.

## 구현 파일

```text
python/
  pyproject.toml
  README.md
  src/fitform_eval/
    models.py
    validator.py
    cycles.py
    cli.py
  tests/
    test_validator.py
    test_cycles.py
```

## P1 — 데이터 계약과 검증기

Pydantic 기반 canonical fixture metadata schema를 구현했다.

검증 항목:

- schema version
- ground truth 횟수 관계
- algorithm version과 초기 상태
- capture frame count
- timestamp 단조 증가
- frame valid 타입
- keypoint confidence 0~1 범위
- 오른팔 필수 관절 존재
- valid/invalid frame 집계 일치
- derived source SHA-256 형식
- 변환 규칙이 정답 또는 예측 횟수를 사용했는지 여부

실제 정상 fixture 검증 결과:

```text
schemaVersion: 1.1-derived
frameCount: 4,395
validFrames: 2,702
invalidFrames: 1,693
timestamp: 16.5ms → 74,846.2ms
required right-arm keypoints: present
warnings: 0
```

## P2 — Cycle Feature Analyzer

### 입력

```text
canonical fixture
+ F_FULL cycle CSV
+ F_FULL frame trace JSON
```

Python에서 FSM을 재구현하지 않았다. JavaScript trace가 만든 cycle 구간을 사용하고,
브라우저 `REP_COUNTED` 이벤트와의 정렬은 기존 JavaScript와 동일한 순서 보존
최소 거리 동적 계획법으로 재현했다.

정렬 결과:

```text
Aligned cycles:   1, 2, 3, 4, 5, 6, 10, 11, 12, 13
Unmatched cycles: 7, 8, 9
```

### 추출 feature

- processed minimum/maximum angle
- observed ROM
- cycle duration
- contraction/extension hold
- peak/median absolute angular velocity
- required joint confidence 평균/최솟값
- invalid frame ratio
- gap from previous rep
- reset/recovery count

### 주요 비교 결과

| Feature | Aligned 10개 | Unmatched 3개 | 1차 해석 |
| --- | ---: | ---: | --- |
| Minimum angle median | 18.19° | 13.35° | 추가 cycle도 충분히 수축 |
| ROM median | 146.56° | 147.73° | 정상 cycle과 매우 유사 |
| Duration median | 1,681.65ms | 2,254.10ms | 느리지만 정상 범위와 겹침 |
| Peak angular velocity median | 435.85°/s | 610.31°/s | 추가 cycle이 더 빠른 경향 |
| Mean confidence median | 0.532 | 0.495 | 추가 cycle이 다소 낮음 |
| Invalid frame ratio median | 0.225 | 0.432 | 추가 cycle이 더 불안정한 경향 |
| Previous rep gap median | 3,628.20ms | 5,750.20ms | 편차가 크며 단순 duplicate 근거는 약함 |

범위:

```text
Aligned ROM:   133.76° ~ 148.27°
Unmatched ROM: 144.87° ~ 149.25°

Aligned duration:   1,483.4ms ~ 2,801.9ms
Unmatched duration: 1,951.0ms ~ 2,656.9ms
```

추가 3개는 ROM과 duration에서 정상 정렬 cycle의 범위와 겹친다. 단순 threshold
jitter나 매우 짧은 duplicate라고 보기 어렵다는 기존 판단을 수치적으로 보강한다.

반면 추가 3개는 각속도가 더 높고 invalid frame ratio가 큰 경향이 있다. 이는 추적
품질이나 동작 속도가 라벨 불일치와 관련될 가능성을 보여주지만, 표본이 3개이므로 원인으로
확정할 수 없다.

## 현재 결론

이번 Python 분석으로 다음을 말할 수 있다.

> Unmatched 3개 cycle은 완전 ROM과 정상 범위 안의 duration을 가져 단순 각도 흔들림이나
> 짧은 중복 카운트로 제거할 근거가 부족하다. 다만 aligned cycle보다 높은 각속도와
> invalid frame ratio 경향이 확인되어 영상 기반 확인이 필요한 진단 후보가 생겼다.

다음은 아직 말할 수 없다.

> 추가 3개는 실제 추가 운동이다.

또는:

> 추가 3개는 알고리즘 false positive다.

동기화된 영상과 cycle-level annotation이 없기 때문이다.

## 산출물

```text
evaluation/python-validation/
  normal-cycle-features.csv
  normal-cycle-comparison.json
  normal-cycle-feature-strip.svg
```

## 자동화 테스트

Python:

```text
5 passed
```

검증 내용:

- 실제 canonical fixture 계약 검증
- timestamp 역순 fixture 거부
- 순서 보존 cycle-label alignment
- 실제 정상 fixture의 10 vs 3 분리
- CSV/JSON/SVG 산출물의 결정론

## 다음 단계

Phase P3는 신규 영상 세션이 필요한 작업이다.

1. video와 keypoint timestamp 동시 기록
2. OpenCV frame-keypoint 동기화
3. skeleton, angle, FSM event overlay
4. Streamlit cycle annotation
5. unmatched 또는 오류 cycle clip 자동 추출

P3 완료 전에는 이번 결과를 원인 확정이 아닌 `kinematic comparison`으로 표현한다.

