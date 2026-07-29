# Phase 13: 포트폴리오 Evidence 반영 로그

## 작업 목적

Phase 11 ablation과 Phase 12 rep-event 분석 결과를 면접관이 짧은 시간 안에
이해할 수 있는 Evidence 섹션으로 재구성한다.

표와 그래프를 많이 나열하는 것이 아니라 다음 문제 해결 흐름을 전달한다.

```text
Ablation에서 잔여 오인식 발견
→ Rep cycle 원인 분석
→ 라벨 구간 문제와 상태 정의 문제 분리
→ Full-contraction-aware FSM 설계
→ 동일 입력 개선 전·후 비교
→ 일반화 한계 공개
```

## 그래프 개선

`scripts/render-rep-charts.js`를 확장해 경계 수축 확대 그래프에 다음 정보를
동시에 표시했다.

- 60도 contraction start
- 약 36.4도 exploratory full contraction
- 155도 full extension
- 기존 FSM `Legacy: REP_COUNTED`
- 개선 FSM `Improved: REJECTED`

같은 각도 입력에서 상태 정의만 바뀌었다는 점을 한 그래프에서 보여준다.

그래프 생성:

```powershell
npm.cmd run rep:charts
```

포트폴리오에 복사한 자산:

```text
portfolio/assets/boundary-rep-analysis.svg
portfolio/assets/normal-overview.svg
portfolio/assets/normal-unmatched-rep.svg
```

## Evidence 섹션 정보 구조

### 1. 축약 Ablation

상세 6개 구성과 24개 CSV 열을 모두 노출하지 않고 핵심 지표만 표시한다.

| 구성 | 정상 오차 | 경계 FP | 실패 구간 count |
|---|---:|---:|---:|
| Baseline | 8 | 4 | 9 |
| Validation | 6 | 4 | 2 |
| EMA | 6 | 3 | 0 |
| Stable FSM | 5 | 3 | 0 |
| Full | 3 | 3 | 0 |

Hysteresis는 현재 fixture에서 최종 횟수를 바꾸지 않아 축약 표에서는
제외했다. 전체 구성과 원본 결과는 Phase 11과 `evaluation/ablation/`에
보존한다.

### 2. 경계 수축 원인

경계 확대 그래프와 함께 다음 사실을 표시한다.

- 기존 60도 기준은 통과
- 탐색적 약 36도 완전 수축 기준에는 도달하지 않음
- 기존 FSM은 rep count
- 개선 FSM은 incomplete contraction reject

### 3. FSM 비교

기술 문서에서는 내부 구현을 4-phase FSM으로 표현한다.

```text
EXTENDED
CONTRACTING
FULLY_CONTRACTED
RETURNING
```

포트폴리오에서는 운동 milestone 중심으로 단순화하되 phase를 숨기지 않는다.

### 4. 동일 입력 재실행

```text
Normal canonical cycles: 13 → 13
Boundary false positives: 3 → 0
```

정상 13회는 정확도 개선이 아니라 기존 canonical cycle을 추가로 누락시키지
않았다는 의미로 설명한다.

### 5. 정상 unmatched cycle

정상 전체 그래프는 작게, unmatched R7 확대 그래프는 크게 배치했다.

R7 관찰값:

```text
minimum angle: 13.3°
ROM: 147.7°
cycle reset: 0
```

완전 관절 왕복이므로 duplicate count로 단정하지 않고 label-window
mismatch로 분류한 분석 엄밀성을 강조한다.

## Scope 갱신

기존 “다음에 검증할 것” 목록을 현재 진행 상태에 맞게 수정했다.

현재 증거:

- 실제 관절 fixture 기반 18개 결정론적 ablation
- 추적 실패 구간 count 9회에서 0회로 억제
- rep cycle 분석으로 라벨과 알고리즘 문제 분리
- 탐색 FSM에서 경계 FP 3회에서 0회
- raw/canonical/end-to-end 데이터 역할 분리

남은 검증:

- schema 1.1 정상 fixture 독립 검증
- 가림 후 복구 browser/runner parity
- 다른 사용자와 촬영 각도의 full contraction 분포
- 촬영 품질 조건별 비교
- 스쿼트 확장

## 표현 제한

사용하는 표현:

> 약 36도를 탐색적 완전 수축 기준으로 설정했다.

> 개선 FSM은 기존 canonical 정상 cycle 13개를 유지하면서 경계 오인식을
> 3회에서 0회로 줄였다.

사용하지 않는 표현:

```text
36.36°가 최적 threshold다.
정상 정확도가 13회로 개선됐다.
정상 추가 세 cycle은 알고리즘 duplicate다.
전체 환경에서 경계 오인식을 해결했다.
```

## 검증

- 포트폴리오 inline JavaScript 문법 검사
- 세 SVG 자산 존재 확인
- HTML parser 통과
- 로컬 HTTP 응답:
  - `/portfolio/`: 200
  - 경계 그래프: 200
  - 정상 overview: 200
  - 정상 확대 그래프: 200
- Chrome headless에서 페이지 렌더링 확인
- 8개 테스트 파일, 28개 테스트 통과
- Git diff 공백 오류 검사 통과

## Sites 상태

기존 Sites 프로젝트를 재사용한다.

```text
project_id: appgprj_6a681dfe951481919eeefaf9d6d393db
latest saved version: 없음
current live URL: 없음
```

현재 작업 트리에 포트폴리오 외 알고리즘·fixture·문서 변경이 함께
커밋되지 않은 상태로 존재한다. Sites 버전 저장은 정확한 source commit을
push한 뒤 수행해야 하므로, 커밋 범위를 확정하기 전에는 production 버전을
생성하지 않는다.
