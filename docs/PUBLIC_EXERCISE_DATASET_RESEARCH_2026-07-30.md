# 공개 운동 영상 데이터셋 조사

조사일: 2026-07-30

## 목적

현재 FitFormLive의 실제 영상 검증은 한 명의 촬영자에게 집중되어
있다. 추가 참여자를 직접 모집할 수 없는 상황에서 공개 영상
데이터셋으로 체형, 촬영 시점, 의상, 배경 변화에 대한 외부 검증을
보완할 수 있는지 조사했다.

공개 데이터셋 검증은 실제 제품 사용성 연구를 완전히 대체하지 않는다.
다만 AI 생성 영상보다 실제 사람과 실제 카메라 분포를 제공하므로
일반화 위험을 확인하는 외부 테스트에는 더 적합하다.

## 1순위: Multi-View Raw Video Dataset of Seven Fitness Exercises

- 공식 페이지:
  https://data.mendeley.com/datasets/kgbb3yn47p/1
- DOI: `10.17632/kgbb3yn47p.1`
- 공개일: 2026-07-07
- 라이선스: CC BY 4.0
- 참여자: 26명
- 촬영 환경: 실제 체육관, 스마트폰, 자연스러운 조명·배경 변화
- 시점: front, side, diagonal
- 관련 운동: alternating dumbbell bicep curl
- 라벨: subject ID, exercise, good/bad form, camera view
- 형식: raw MP4

### 장점

- 현재 가장 부족한 subject 다양성을 직접 보완한다.
- 실제 사람과 실제 체육관 영상이므로 생성형 AI 영상보다 MoveNet
  입력 분포가 현실적이다.
- front·side·diagonal 시점으로 카메라 각도 robustness를 비교할 수
  있다.
- good/bad form을 분리해 정상 동작과 자세 이상 조건을 모두 볼 수
  있다.
- CC BY 4.0이므로 출처를 표시하면 재사용 조건이 비교적 명확하다.

### 한계

- 반복 수와 cycle start/end timestamp가 제공된다고 명시되어 있지
  않다.
- alternating curl은 현재 FitFormLive의 single right curl과 운동
  정의가 완전히 같지 않다.
- side view에서는 현재 오른팔 관절이 가려지거나 좌표 임계값의 의미가
  달라질 수 있다.
- 원본 전체 용량과 bicep-curl 영상 개수는 다운로드 전 확인이
  필요하다.

### 사용 방안

전체 데이터를 바로 학습에 사용하지 않는다. 먼저 다음 소규모 외부
검증 세트를 만든다.

```text
good-form bicep curl
→ 서로 다른 subject 5명 이상
→ front 또는 diagonal view 우선
→ MoveNet pose 추출
→ cycle-level 수동 annotation
→ production과 exploratory FSM 비교
```

가능하면 각 subject에서 한 영상만 먼저 선택해 특정 사람이 결과를
과도하게 지배하지 않도록 한다.

## 2순위: RepCount / RepCount-pose

### RepCount

- 공식 페이지:
  https://svip-lab.github.io/dataset/RepCount_dataset
- 총 1,451개 영상
- 총 19,280개 annotation
- 평균 영상 길이 약 39.36초
- cycle 위치와 count를 포함하는 fine-grained annotation
- 운동뿐 아니라 스포츠와 일반 반복 행동이 함께 포함됨

### RepCount-pose

- 공식 구현:
  https://github.com/MiracleDance/PoseRAC
- RepCount에 salient-pose frame annotation을 추가
- test pose가 미리 추출된 배포 구조 제공

### 장점

- cycle 위치와 count가 있어 반복 카운팅 평가에 적합하다.
- 다양한 실제 영상 조건과 anomaly 사례를 포함한다.
- pose-level 연구와 비교할 수 있다.

### 한계

- bicep curl 영상이 충분히 포함되는지는 공식 설명만으로 확정할 수
  없다.
- 다양한 행동을 위한 범용 반복 카운팅 데이터라 현재 elbow-angle
  FSM과 직접 맞지 않는 영상이 많을 수 있다.
- 일부 RepCount Part-A 영상은 YouTube 출처이므로 영상 재배포와
  장기 접근성 검토가 필요하다.

### 사용 방안

전체 benchmark를 FitFormLive FSM에 적용하기보다 action metadata에서
curl 또는 유사 elbow-flexion 동작이 실제로 존재하는지 먼저 필터링한다.
적합한 영상이 있을 때만 보조 테스트 세트로 사용한다.

## 제외 또는 낮은 우선순위

### Fitness-AQA

- BackSquat, BarbellRow, OverheadPress 중심
- bicep curl 검증과 직접 맞지 않음
- non-commercial 사용 조건

현재 right-curl FSM의 subject 일반화 검증에는 우선순위가 낮다.

### Countix

- 대규모 in-the-wild 반복 행동 데이터
- 반복 카운팅 benchmark로는 가치가 있음
- 운동 외 행동이 많고 현재 단일 관절 FSM과 운동 정의가 맞지 않을 수
  있음

### 생성형 AI 운동 영상

- 사람·관절 형태와 시간적 일관성이 깨질 수 있음
- 정확한 관절 각도와 반복 정답을 알기 어려움
- 실제 MoveNet 분포와 다를 수 있음

공개 실제 영상이 사용 가능한 상황에서는 AI 생성 영상을 우선하지
않는다.

## 선택

1차 외부 검증에는 Mendeley의 26-subject multi-view 데이터셋을
선택한다.

### 선택 이유

1. 실제 참여자 26명의 원본 영상이다.
2. alternating dumbbell bicep curl을 명시적으로 포함한다.
3. front·side·diagonal 카메라 변화를 제공한다.
4. 실제 체육관 배경과 조명 변화를 포함한다.
5. CC BY 4.0으로 사용·출처 표시 조건이 명확하다.

RepCount는 cycle annotation이 더 좋지만, bicep curl 포함 여부와 현재
FSM에 맞는 관절 동작의 비율이 불확실하므로 2순위로 둔다.

## 다음 작업

다운로드 전에 다음을 확인한다.

- 전체 다운로드 크기
- bicep curl 영상 개수
- subject별·view별 파일 목록
- 동일 영상이 세 가지 폴더 구조에 중복 포함되는 방식

확인 후 원본 전체를 Git에 넣지 않고 별도 ignored 디렉터리에 저장한다.
첫 평가에서는 서로 다른 subject 5명 이상의 good-form front/diagonal
영상만 선별한다. 반복 cycle은 기존 annotation workflow로 사람이
검수하고, 결과에는 `external_dataset`, DOI, subject ID와 view를
provenance로 남긴다.

## 주장 범위

외부 데이터 검증 후 가능한 표현:

> 자체 촬영 영상과 26-subject 공개 운동 데이터셋의 선별된 bicep-curl
> 영상에서 subject·view 변화에 대한 외부 robustness를 평가했다.

여전히 피해야 하는 표현:

> 모든 사용자와 환경에서 일반화가 증명됐다.
