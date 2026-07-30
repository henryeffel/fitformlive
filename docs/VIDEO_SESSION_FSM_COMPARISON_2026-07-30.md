# Video Session FSM Comparison — 2026-07-30

## Scope

Five schema 1.2 capture sessions were compared with:

1. the production count recorded by the browser,
2. a capture-parity replay using the recorded processing output,
3. an offline F_FULL diagnostic keypoint recomputation, and
4. the exploratory full-contraction FSM using the captured `processedAngle`.

The exploratory configuration is:

- contraction start: 60°
- full contraction: 36.3579°
- extension: 155°
- hysteresis: 8°
- hold: 180 ms

Generated event timestamps are stored only as
`machine_generated_review_candidate`. They are not human-reviewed ground
truth.

## Results

| Session | Complete GT | Browser | Capture-parity | Diagnostic F_FULL | Exploratory |
| --- | ---: | ---: | ---: | ---: | ---: |
| `curl-normal-pytest-01` | 10 | 10 | 10 | 10 | 10 |
| `curl-fast-02` | 10 | 10 | 10 | 10 | 10 |
| `curl-partial-01` | 0 | 2 | 2 | 5 | 0 |
| `curl-occlusion-01` | 5 | 3 | 3 | 3 | 3 |
| `curl-fast-01` | 10 | 1 | 1 | 3 | 0 |

`curl-fast-01` remains a failed-framing sample, not speed evidence.

## Interpretation

- On the usable normal and fast sessions, the exploratory threshold preserved
  the observed 10/10 result.
- On `curl-partial-01`, it rejected both browser false positives and produced
  0/0.
- It did not recover repetitions lost during long occlusion. That is expected:
  a stricter contraction definition improves partial-range rejection, not
  tracking availability.
- Capture-parity replay matches the recorded browser count for all five
  sessions. It consumes captured `valid` and `processedAngle` values and
  recorded reset events, so it is now the parity authority for captured
  sessions.
- The offline F_FULL recomputation disagreed with the browser on
  `curl-partial-01` (5 vs 2) and `curl-fast-01` (3 vs 1). The recomputation does
  not currently reproduce every capture-time processing gate, including the
  captured processed-angle/velocity behavior. It is therefore labeled
  diagnostic and is not the parity authority.

This is promising evidence, not enough evidence to promote 36.3579° to a
production default. The threshold was derived from earlier fixtures and should
be tested on more people, camera positions, and curl styles.

## Artifacts and command

Run:

```text
npm run video:compare
```

Outputs:

- `evaluation/python-validation/video-session-comparison/comparison-summary.json`
- `evaluation/python-validation/video-session-comparison/comparison.csv`
- one `*.review-candidate.json` file per session

The normal and `curl-fast-02` capture pairs were copied from Downloads into
`data/recordings/raw`. The original Downloads files were retained.

## Next decision

Capture parity is closed for the five current sessions. The next highest-value
work is to review the generated rep/rejection timestamps against video and
convert only reviewed labels into annotation ground truth.

The keypoint-recompute path remains intentionally separate. If exact
end-to-end reproducibility from raw keypoints is required later, it must also
reproduce capture-time EMA and angular-velocity gating.
