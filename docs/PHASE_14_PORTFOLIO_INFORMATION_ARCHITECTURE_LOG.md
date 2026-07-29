# Phase 14 — 포트폴리오 정보 구조 개편

## 작업 목적

기존 포트폴리오는 Architecture, Data Flow, Sequence, 알고리즘 설명, 초기 성능,
ablation, FSM 개선, OpenCV, Scope를 모두 같은 비중으로 보여 주어 최신 기술적 성과가
페이지 아래쪽에 묻혔다.

이번 단계의 목적은 지원자가 처음 읽는 순서에 맞춰 페이지를 압축하고, 단일 정상 테스트
결과보다 실제 fixture 기반 검증과 원인 분석을 핵심 증거로 올리는 것이다.

## 반영한 의견

### 1. 페이지 순서 변경

메인 흐름을 다음과 같이 변경했다.

```text
Hero
→ 핵심 결과
→ 문제 정의
→ 원인 분석 Evidence
→ 알고리즘
→ 시스템 구조
→ 한계와 다음 검증
```

기존 상세 Architecture와 기존 알고리즘 설명은 소스에서 삭제하지 않고 상세 자료로
보존하되 메인 페이지 흐름에서는 제외했다.

### 2. Hero 지표 교체

기존 Hero의 FPS, 추론 시간, 추론 오류보다 현재 프로젝트의 중심 근거를 먼저 표시한다.

```text
18 / 18  deterministic ablation
9 → 0    counts during tracking failure
3 → 0    boundary false positives
```

FPS와 추론 시간은 하단 Scope의 보조 성능 근거로 이동했다.

### 3. `10 = 10`의 역할 축소

정상 컬 10회 정확 일치는 최초 브라우저 baseline으로만 표시한다. 현재의 핵심 성과는
이 단일 결과를 다음 평가 시스템으로 확장한 과정이다.

- raw/canonical fixture 분리
- offline deterministic runner
- 6단계 누적 ablation
- rep-event 시계열 원인 분석
- 탐색적 FSM 개선 전후 재실행

### 4. FSM 상태 명시

두 상태 머신의 적용 상태를 명확히 분리했다.

| 구분 | 상태 | 의미 |
| --- | --- | --- |
| Current production | `READY → BOTTOM_HOLD → RETURNING` | 현재 브라우저 기본 로직 |
| Experimental | `EXTENDED → CONTRACTING → FULLY_CONTRACTED → RETURNING` | 독립 검증 대기 중인 탐색적 개선안 |

약 36° 기준은 두 fixture의 관찰에서 도출한 탐색적 값이다. 독립 fixture 검증 전에
production 기본값으로 적용하지 않는다.

### 5. Architecture 압축

세 개의 탭으로 나뉘던 Architecture, Data Flow, Sequence를 하나의 핵심 흐름으로
통합했다.

```text
Webcam
→ MoveNet
→ Confidence gate · EMA · FSM
→ UI · JSON · CSV
```

OpenCV.js는 rep 판정기가 아니라 밝기와 선명도를 설명하는 보조 입력 품질 경로로
명시했다. 프레임 단위 Sequence는 상세 작업 문서로 이동했다.

### 6. 제목 체계 통일

메인 섹션은 한국어 목적과 영문 기술 키워드를 한 형식으로 사용한다.

```text
01 핵심 결과 · KEY RESULTS
02 문제 정의 · PROBLEM
03 원인 분석 · EVIDENCE
04 알고리즘 · ALGORITHM
05 시스템 구조 · ARCHITECTURE
06 한계와 다음 검증 · SCOPE
```

## 수정 이유

이 개편은 내용을 숨기기 위한 축약이 아니다. 채용 검토자가 먼저 확인해야 할 질문의
순서를 바꾼 것이다.

1. 어떤 결과를 만들었는가?
2. 그 결과가 해결한 문제는 무엇인가?
3. 같은 입력에서 원인을 재현했는가?
4. 현재 로직과 실험 로직을 구분했는가?
5. 시스템 전체에서 알고리즘의 책임은 어디인가?
6. 아직 주장할 수 없는 범위는 무엇인가?

## 변경 파일

- `portfolio/index.html`
- `docs/PHASE_14_PORTFOLIO_INFORMATION_ARCHITECTURE_LOG.md`

## 검증 항목

- 섹션 ID와 내비게이션 링크 일치
- 최신 Evidence SVG 경로 유지
- 데스크톱·모바일 레이아웃
- 기존 자동화 테스트 회귀 없음

