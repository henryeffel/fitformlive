# Target-arm MVP 구현 및 검증 계획

> 진행 상태 (2026-07-30): P1~P5 완료. P5는 human candidate approval과
> AI-assisted full-video missed-cycle audit를 결합한 count-level 개발 평가다.
> candidate-derived completion 시각은 독립 latency ground truth로 사용하지 않는다.

작성일: 2026-07-30

## 목표

Diagonal view에서 사용자가 왼팔 또는 오른팔 중 하나를 지정하면, 다른 팔의
동작 여부와 관계없이 선택한 팔의 curl 반복만 독립적으로 카운트한다.

```text
targetArm = left | right
→ target shoulder/elbow/wrist 선택
→ target-arm validation 및 smoothing
→ target-arm FSM
→ target-arm rep count
```

양팔 합계나 세트 단위 횟수는 계산하지 않는다.

## 현재 상태와 차이

- 웹캠 production은 오른팔 중심으로 개발·검증됐다.
- 외부 runner는 양팔을 분석하고 moving arm을 자동 선택할 수 있다.
- annotation 변환기는 팔을 명시적으로 선택할 수 있다.
- MVP 제품 UI에는 일관된 `targetArm` 계약과 왼팔 회귀 검증이 아직 없다.

## 구현 단계

### P1. Target-arm 계약 통합

- 세션 설정에 `targetArm: "left" | "right"` 추가
- 기본값은 기존 동작을 보존하기 위해 `right`
- keypoint index를 팔별 mapping으로 중앙화
- 화면 미러링은 표시 좌우와 해부학적 좌우를 바꾸지 않는다는 규칙 명시
- fixture, recording metadata, CSV/JSON export에 targetArm 기록

완료 조건:

- 오른팔 기본 동작의 기존 fixture와 카운트 결과가 변하지 않음
- 왼팔 선택 시 5/7/9 keypoint만, 오른팔 선택 시 6/8/10만 사용

### P2. 웹캠 UI

- 운동 시작 전 `운동 팔: 오른팔 / 왼팔` 선택
- 세션 진행 중 변경 금지 또는 변경 시 FSM reset
- 선택한 팔을 화면에 명확히 표시
- 촬영 가이드에 diagonal view와 선택 팔 관절 노출 조건 표시

완료 조건:

- 사용자가 현재 분석 팔을 항상 확인할 수 있음
- 팔 변경으로 이전 rep state가 섞이지 않음

### P3. FSM 및 품질 경고

- 선택 팔의 confidence와 angle만 production FSM에 입력
- 반대 팔 움직임은 카운트 입력에서 제외
- 선택 팔 shoulder/elbow/wrist confidence 부족 시 tracking 경고
- 반대 팔이 선택 팔을 가리는 경우 기존 low-confidence reset 정책 적용

완료 조건:

- simultaneous/alternating 입력에서도 선택하지 않은 팔 이벤트가 count를
  직접 증가시키지 않음
- tracking failure 정책은 좌우에서 동일하게 동작

### P4. 자동 테스트

- 좌우 대칭 synthetic pose에서 angle 계산 동일성
- targetArm mapping 단위 테스트
- 왼팔 fixture replay count 테스트
- 오른팔 기존 canonical fixture 회귀 테스트
- 세션 중 targetArm 변경/reset 테스트
- export metadata 계약 테스트

완료 조건:

- 기존 JavaScript·Python 테스트 전부 통과
- 왼팔과 오른팔에 동일한 FSM 전이 규칙 적용 확인

### P5. 외부 diagonal 검증

대상:

- 기존 `curl-diagnal-sample`: target right
- `curl-diagnal-sample2/3/4`: 육안 및 confidence를 바탕으로 target arm을 사전 지정

절차:

1. 영상 확인 전에 target arm과 선택 이유 기록
2. frozen production threshold로 MoveNet 분석
3. 선택 팔 valid rate, confidence, min/max angle, ROM, count 저장
4. prediction-assisted human review
5. candidate precision과 전체 영상 반복 수를 구분해 보고

팔 선택은 결과 count가 잘 나오는 쪽으로 사후 변경하지 않는다. camera visibility
또는 제품 사용자가 지정한 팔을 먼저 고정해야 한다.

### P6. 문서 및 포트폴리오

- [x] README에 target-arm 제품 계약 추가
- [x] strict front/side 비지원 표시
- [x] alternating 영상에서도 “오른팔 7회”처럼 팔별 결과로 표현
- [x] 현재 MVP 설명을 `target-arm diagonal`로 통일
- [x] side 실패는 view dependency diagnostic으로 유지
- [x] P5 count-level 결과와 AI-assisted review provenance 연결

## 검증 데이터 해석

Mendeley curl은 alternating 운동이지만 target-arm MVP에서는 사용할 수 있다.
단, 다음처럼 보고한다.

```text
잘못된 표현:
  alternating curl 전체 14회를 정확히 카운트

올바른 표현:
  diagonal alternating 영상에서 지정 오른팔 반복 7개를 독립 추적
```

반대 팔 움직임이 target-arm pose confidence에 영향을 줄 수 있으므로 실제 환경
노이즈로 기록하되 입력 범위 밖으로 자동 제외하지 않는다.

## 제외 범위

- 양팔 총 반복 수 합산
- 좌우 동시 자세 품질 판정
- strict side/front 지원
- 자동으로 더 잘 나온 팔을 사후 선택해 성능 보고
- A–E view-generalization 규칙의 production 적용

## 권장 작업 순서

```text
P1 targetArm 데이터 계약
→ P2 웹캠 선택 UI
→ P3 선택 팔 FSM 연결
→ P4 좌우 회귀 테스트
→ P5 diagonal sample 1–4 평가
→ P6 README 및 포트폴리오 정리
```
