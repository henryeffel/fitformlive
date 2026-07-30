# 외부 운동 영상 검증 실행 계획

작성일: 2026-07-30

## 현재 판단

FitFormLive의 기능 구현과 자체 촬영 검증은 거의 완료됐다. 현재 가장
큰 약점은 정상, 빠른 동작, 부분 동작, 가림 조건의 영상이 대부분 같은
사용자와 제한된 구도에서 수집됐다는 점이다.

따라서 다음 단계에서는 새로운 기능을 넓히기보다 기존 알고리즘을
동결하고 공개 실제 사용자 영상에서 결론이 유지되는지 확인한다.

2026-07-30 현재 target-arm 구현과 external diagonal 개발 평가는 완료됐다.

- P1~P6 target-arm MVP 구현·문서화 완료
- external diagonal sample1~4: GT 22, TP 15, FP 0, FN 7
- count-level precision 1.000, recall 0.682, F1 0.811
- strict side/front는 범위 밖 diagnostic으로 유지
- 동일 개발 영상에 맞춘 threshold 재조정은 하지 않음

새로운 subject의 diagonal 영상 3개를 사용한 frozen holdout 평가도 완료했다.
이는 개발 결과와 분리해 보고한다.

- 추론 전 target arm: 세 영상 모두 해부학적 left로 사전 등록
- 설정 변경 및 sample 제외: 없음
- GT 25, prediction 17, TP 17, FP 0, FN 8
- count-level precision 1.000, recall 0.680, F1 0.810

이 결과는 오검출 억제는 유지됐지만 사용자·동작별 수축 유지와 복귀각 차이,
tracking 유효률 저하 때문에 recall 한계도 재현됐음을 보여준다.

## 2026-07-30 MVP 범위 결정

외부 side 및 bilateral front 진단 이후 v1 성능 검증 범위를 다음으로
좁혔다.

```text
사용자가 지정한 한쪽 팔의 dumbbell curl
diagonal camera view
한쪽 팔의 shoulder/elbow/wrist가 지속적으로 보이는 입력
```

strict side와 strict front는 범위 밖 diagnostic set으로 유지한다.
simultaneous/alternating curl은 target arm을 사전에 지정하고 그 팔의 반복만
집계하면 사용할 수 있다. 양팔 합산 카운트는 v1 범위가 아니다.

상세 정책은 `docs/MVP_SCOPE_AND_VALIDATION_POLICY.md`, 구현 순서는
`docs/TARGET_ARM_MVP_IMPLEMENTATION_PLAN.md`를 기준으로 한다.

## 현재 확보한 근거

- 정상 세션: 10/10
- 빠른 동작 세션: 10/10
- 부분 동작: production FP 2, exploratory FSM FP 0
- 가림 세션: 5회 중 3회, 가림 중 FP 0
- 영상과 pose timestamp 동기화
- cycle-level annotation
- capture-parity replay 일치
- JavaScript 45개 및 Python 28개 자동 테스트
- external target-arm count-level 전체 영상 audit

자체 촬영 데이터에서는 36.3579° full-contraction FSM이 정상과 빠른
반복을 유지하면서 부분 동작 false positive를 제거했다.

## 외부 검증이 필요한 이유

현재 결과만으로는 다음을 확정할 수 없다.

- 다른 체형에서도 36.3579°가 너무 엄격하지 않은가
- 다른 의상과 배경에서 MoveNet confidence가 유지되는가
- front, diagonal, side view에서 같은 관절을 안정적으로 추적하는가
- 15fps 영상에서 180ms hold가 충분한가
- alternating curl에서 고정 오른팔 정책이 유효한가

공개 실제 영상은 AI 생성 영상보다 실제 MoveNet 입력 분포에 가깝고,
다른 subject와 view를 제공하므로 이 약점을 직접 보완한다.

## 데이터 역할 분리

### 자체 촬영 데이터

- 문제 발견
- FSM 구조 설계
- 36.3579° threshold 선택
- capture/replay/annotation pipeline 개발

### Side-view sample

- 외부 MP4 처리 smoke test
- TF.js MoveNet 호환성 확인
- 좌우 팔 confidence와 angle trace 확인
- moving-arm 선택 정책 점검
- threshold 조정에는 사용하지 않음

### 공개 development subjects

- 3–5명 권장
- 파일·metadata·annotation 절차 점검
- 입력 품질 및 지원 가능한 view 정책 결정
- 가능하면 FSM threshold는 유지

### 공개 external test subjects

- development와 겹치지 않는 별도 5명 이상
- subject 단위 분리
- production 및 exploratory 설정 완전 동결
- 결과가 좋거나 나쁜 것과 무관하게 그대로 보고

## 알고리즘 동결 원칙

첫 external test 전에 다음 값을 고정한다.

```text
production:
  up = 155°
  down = 60°
  hysteresis = 8°
  hold = 180ms

exploratory:
  contractStart = 60°
  fullContract = 36.3579°
  fullExtend = 155°
  hysteresis = 8°
  hold = 180ms
```

External test 영상을 확인한 뒤 이 값을 조정하면 해당 영상은 더 이상
최종 test가 아니라 development 데이터가 된다.

## 외부 MP4 inference 계약

동일한 모델 경로를 유지하기 위해 pose inference는 브라우저 production과
같은 TensorFlow.js MoveNet을 사용한다. OpenCV는 영상 decode와 사람이
검수할 프레임 추출에 사용한다.

```text
외부 MP4
→ browser video decode
→ TensorFlow.js MoveNet inference
→ normalized raw keypoints 저장
→ 좌우 팔별 validation
→ 좌우 팔별 EMA 및 elbow angle
→ moving-arm 분석
→ production/exploratory FSM
→ schema JSON 및 prediction export
→ cycle-level human annotation
→ P4 evaluation
```

Python의 다른 pose 모델로 대체하지 않는다. 다른 모델을 사용하면
MoveNet generalization 검증이 아니게 되기 때문이다.

## Moving-arm 최소 정책

첫 구현은 좌우 팔 각각에 대해 다음 값을 저장한다.

- required joint valid rate
- shoulder, elbow, wrist minimum confidence
- elbow-angle minimum, maximum, ROM
- frame-to-frame angle 변화량
- production predicted reps
- exploratory predicted reps

진단 모드에서는 한쪽 팔의 valid rate가 충분하고 angle ROM이 명확히 더 크면
그 팔을 `selectedArm`으로 기록할 수 있다. 양팔이 번갈아 움직이면
`alternating_requires_dual_fsm` 분류와 좌우 독립 결과를 유지한다.

MVP 성능 평가에서는 결과가 좋은 팔을 자동 선택하지 않는다. 분석 전에
`targetArm`을 왼팔 또는 오른팔로 지정하고 해당 팔 결과만 평가한다.
target arm과 선택 이유를 세션 metadata에 남긴다.

## 첫 smoke test

입력:

```text
Downloads/curl-side-sample.mp4
```

확인 항목:

- 영상 decode 성공
- 전체 duration과 처리 frame 수
- 좌우 필수 관절 valid rate
- 좌우 elbow angle trace
- 움직이는 팔 또는 alternating 상태
- 15fps에서 hold transition 유지
- production/exploratory prediction
- 결과 JSON 다운로드

이 smoke test에서는 threshold를 변경하지 않는다.

## 외부 평가 지표

- ground-truth valid reps
- predicted reps
- TP, FP, FN
- precision, recall, F1
- mean/p50/p95 latency
- required-joint valid rate
- 평균 및 최소 joint confidence
- tracking-loss interval 수와 길이
- subject ID
- camera view
- form quality
- selected arm과 선택 이유

## 결과에 따른 의사결정

### 외부 정상 반복이 유지되는 경우

다음처럼 제한적으로 표현할 수 있다.

> 자체 촬영 데이터에서 선택한 full-contraction FSM을 동결한 뒤,
> 별도 공개 subject 영상에서도 정상 반복 유지 여부를 평가했다.

### 외부 정상 반복이 누락되는 경우

실패를 숨기지 않고 다음 개선 근거로 사용한다.

- 고정 절대 threshold의 일반화 한계
- 사용자별 calibration
- 세션별 상대 ROM
- view-specific support policy
- 좌우 독립 FSM

두 결과 모두 프로젝트의 타당성 검증 성과다.

## 이번 단계에서 추가하지 않는 기능

- YOLO
- DeepSORT
- Optical Flow
- C++ 재작성
- 다수 신규 운동
- 별도 ML 운동 분류기
- 생성형 AI 운동 영상

이 기능들은 현재 외부 검증보다 우선순위가 낮고 프로젝트의 핵심
질문을 흐릴 수 있다.

## 완료 기준

1. 동일 TF.js MoveNet 기반 외부 MP4 runner
2. side-view sample end-to-end smoke test
3. 공개 subject 3–5명 development set
4. 별도 subject 5명 이상 external test
5. 동결된 production/exploratory FSM 비교
6. 실패 조건을 포함한 최종 문서 및 포트폴리오 갱신

최종적으로 다음 설명을 실제 증거로 뒷받침하는 것이 목표다.

> 자체 촬영 영상으로 문제를 발견하고 알고리즘을 설계한 뒤, 공개
> 다중 사용자·다중 시점 bicep-curl 영상에서 동결된 FSM의 TP·FP·FN,
> 관절 유효률, 추적 실패와 판정 지연을 외부 검증했다.
