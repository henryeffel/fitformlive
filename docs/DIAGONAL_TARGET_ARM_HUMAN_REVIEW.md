# Diagonal target-arm human review

작성일: 2026-07-30

## 목적

`curl-diagnal-sample2/3/4`의 production 후보가 실제 왼팔 반복인지 확인하고,
자동 후보가 없는 실제 반복도 추가해 TP, FP, FN을 확정한다. 자동 후보는 탐색
보조이며 그 자체로 ground truth가 아니다.

## 고정 조건

- Annotation arm: `left`
- Candidate source: `production_rep`
- Annotator: 같은 검수자 ID 유지
- threshold와 target arm은 검수 결과를 보고 변경하지 않음

## 업로드 쌍

| 순서 | Session JSON | Video |
|---|---|---|
| 1 | `data/recordings/processed/curl-diagnal-sample2.browser.external-analysis.json` | `data/recordings/processed/browser-compatible/curl-diagnal-sample2.browser.webm` |
| 2 | `data/recordings/processed/curl-diagnal-sample3.browser.external-analysis.json` | `data/recordings/processed/browser-compatible/curl-diagnal-sample3.browser.webm` |
| 3 | `data/recordings/processed/curl-diagnal-sample4.browser.external-analysis.json` | `data/recordings/processed/browser-compatible/curl-diagnal-sample4.browser.webm` |

## 검수 절차

1. Session JSON과 같은 행의 Video를 업로드한다.
2. `Annotation arm`을 `left`로 확인한다.
3. `Candidate source`에서 `production_rep`을 선택한다.
4. 각 후보 구간을 영상으로 확인하고 실제 왼팔 full curl일 때만
   `Human approved`를 체크한다.
5. 승인 후보를 annotation에 추가한다.
6. 영상을 처음부터 끝까지 확인하여 후보가 없었던 실제 왼팔 반복은 아래
   annotation form에서 수동으로 추가한다. 이 단계가 없으면 FN을 측정할 수 없다.
7. 최종 `annotations.json`과 `predictions.json`을 모두 다운로드한다.

## 예상 자동 후보

- sample2: 8,000 / 15,933.3 / 24,333.3 ms
- sample3: 8,000 / 15,200 / 22,533.3 / 29,333.3 ms
- sample4: 3,733.3 ms

후보 간 최소 간격은 6.8초 이상이므로 이전에 발생했던 동일 interval 중복과 같은
자동 후보 간 overlap은 예상되지 않는다.

## 완료 조건

- 세 영상 모두 왼팔의 전체 실제 cycle이 annotation에 포함됨
- 자동 후보 승인 여부와 수동 추가 FN cycle이 구분됨
- 세 쌍의 annotation/prediction JSON 다운로드 완료
- 다운로드 결과를 평가기에 넣어 영상별 TP/FP/FN과 precision/recall 확정
