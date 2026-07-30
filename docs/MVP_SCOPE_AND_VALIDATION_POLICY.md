# FitForm Live MVP 범위 및 검증 정책

작성일: 2026-07-30

## 결정

FitForm Live v1 MVP는 모든 컬 동작과 카메라 시점을 지원하는 범용 자세
인식기가 아니다. 현재 구현과 자체 검증이 실제로 대상으로 삼은 입력 계약을
다음처럼 명시한다.

### 지원 범위

- 운동: 한 팔, 양팔 동시 또는 양팔 교대 dumbbell bicep curl
- 평가 단위: 사용자가 지정한 왼팔 또는 오른팔 한쪽
- 반대 팔: 움직여도 되지만 선택 팔의 pose를 가리지 않음
- 카운트 의미: 선택한 팔이 완료한 반복 수만 집계
- 카메라: 운동 팔을 정면에서 약 20–45도 벗어나 촬영한 diagonal view
- 필수 관절: 운동 팔의 shoulder, elbow, wrist가 프레임 안에서 지속적으로 보임
- 판정 방식: MoveNet 2D keypoint와 선택 팔의 독립 FSM

### 비지원 또는 비권장 범위

- strict side view
- strict front view
- bilateral curl의 양팔 합산 또는 세트 단위 횟수
- 선택하지 않은 팔의 자세 품질 판정
- 심한 관절 가림
- 어깨·팔꿈치·손목이 프레임 밖으로 나가는 구도
- 카메라 평면에 대한 큰 깊이 이동 때문에 2D 관절각이 퇴화하는 구도

비지원은 MoveNet이 반드시 pose를 찾지 못한다는 뜻이 아니다. 현재 제품 계약과
FSM threshold에 대해 정확도를 보장하지 않는다는 뜻이다.

## 이 범위를 선택한 이유

현재 production 후처리는 다음 환경에서 개발됐다.

```text
동일 사용자 중심
웹캠
오른팔 single-arm curl
front-diagonal에 가까운 구도
2D elbow angle
```

외부 side 및 bilateral front 영상은 이 분포와 다른 입력이다. 실험 결과
MoveNet 관절 추적과 반복 angle excursion은 유지됐지만, side 네 영상에서
production FSM이 모두 0회를 출력했다. 이는 전체 tracking failure가 아니라
2D 절대각의 view dependency와 제품 입력 계약의 부재를 보여준다.

MVP는 양팔 전체 동작을 하나의 FSM으로 해석하지 않는다. 사용자가 지정한 팔의
keypoint와 FSM만 사용하므로, 반대 팔이 정지한 single-arm 영상과 반대 팔도
움직이는 alternating/simultaneous 영상에 같은 카운트 계약을 적용할 수 있다.
양팔 합산 카운트와 양쪽 자세 평가는 v1 범위를 넘어선다.

따라서 현재 검증된 핵심 사용 사례를 명시하고, 범위 확장은 별도 연구 과제로
분리하는 것이 가장 작고 검증 가능한 제품 계약이다.

## 기존 외부 데이터의 역할 재분류

### MVP 성능 검증 데이터

- 자체 normal single-arm diagonal-like: 10 valid reps
- 자체 fast single-arm diagonal-like: 10 valid reps
- 자체 partial single-arm diagonal-like: partial 5 cycles
- 자체 occlusion single-arm diagonal-like: valid 5 cycles 및 tracking context
- external diagonal target-arm sample1~4: GT 22, TP 15, FP 0, FN 7
- external count-level aggregate: precision 1.000, recall 0.682, F1 0.811
- candidate approval + AI-assisted full-video missed-cycle audit

### 범위 밖 진단 데이터

- external strict side samples 1–4
- external strict front bilateral/alternating sample

범위 밖 진단 데이터는 삭제하거나 실패를 숨기지 않는다. 다음 증거로 유지한다.

- 지원 범위가 필요한 이유
- 2D absolute elbow angle의 view dependency
- 선택 팔 독립 FSM과 양팔 합산 카운트의 계약 차이
- 단순 `60도 → 70도` 변경으로 문제가 해결되지 않는다는 근거

다만 이 데이터는 MVP 정확도·recall의 분모에 포함하지 않는다.

## 향후 데이터 수집 기준

MVP 일반화 근거를 강화하기 위한 새 영상은 다음 조건을 따른다.

- 서로 다른 외부 사용자
- 한 팔 또는 양팔 curl에서 평가할 target arm이 명시됨
- diagonal view
- 운동 팔과 good-form/partial 조건이 명시됨
- 가능하면 오른팔과 왼팔 모두 포함
- 알고리즘 threshold를 다시 조정하지 않는 final-test subject 분리

최소 권장 구성:

```text
development:
  기존 자체 영상
  현재 external diagonal sample

final external test:
  새로운 사용자 2–3명
  target-arm diagonal good-form
  가능하면 partial 1–2개
```

완전 정면과 side 영상은 v1 성능 데이터 확보를 위해 추가 수집하지 않는다.
diagonal alternating 영상은 target arm을 고정하면 사용할 수 있다.

## UI 및 제품 안내에 반영할 계약

사용자에게 다음 촬영 가이드를 제공해야 한다.

1. 카메라를 운동 팔의 정면에서 약간 옆으로 둔다.
2. 어깨·팔꿈치·손목이 계속 보이도록 거리를 맞춘다.
3. 분석할 팔을 왼팔 또는 오른팔로 선택한다.
4. 반대 팔은 움직여도 되지만 선택한 팔을 가리지 않는다.
5. strict side 또는 strict front라면 위치 조정을 안내한다.

가능하다면 추후 입력 품질 검사에서 다음을 경고한다.

- target arm이 선택되지 않음
- 필수 관절 confidence 부족
- 관절이 프레임 밖에 있음
- 지원되지 않는 카메라 view 가능성

## 후속 연구 범위

절대각·상대 ROM·상완 안정성을 비교하는 A–E 실험은 폐기하지 않는다. 목적을
MVP 버그 수정이 아니라 다음으로 변경한다.

> view-generalized 및 bilateral curl 지원 가능성을 조사하는 future-work
> feasibility experiment

해당 실험 결과가 좋아도 v1 production으로 즉시 승격하지 않는다. 별도
development subject와 독립 external test가 필요하다.

## 포트폴리오 표현

> FitForm Live v1은 diagonal camera view에서 사용자가 지정한 한쪽 팔의
> dumbbell curl 반복을 독립적으로 추적한다. 반대 팔이 정지하거나 함께
> 움직여도 선택한 팔만 집계한다. 범위 밖인 strict side 및 strict front에서도
> MoveNet 추적은 유지됐지만 고정 2D 각도 FSM이 일반화되지 않는 것을 확인했다.
> 이 실패를 threshold 하나로 보정하지 않고 MVP 입력 계약을 명확히 했으며,
> view-aware calibration과 양팔 합산 평가는 후속 연구로 분리했다.
