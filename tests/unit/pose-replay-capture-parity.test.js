const {
  replayCapturedProcessing,
} = require("../../web/js/pose-replay.js");

describe("capture-parity replay", () => {
  it("uses captured processed angles and preserves rep count across reset", () => {
    const fixture = {
      testId: "capture-parity",
      configAtCapture: {
        thresholds: { up: 155, down: 60 },
        thresholdHysteresis: 8,
        transitionHoldMs: 0,
      },
      initialAlgorithmState: {
        phase: "ready",
        transitionCandidate: null,
        transitionStartedAtMs: 0,
        reps: 0,
      },
      frames: [
        { timestampMs: 0, valid: true, processedAngle: 170 },
        { timestampMs: 100, valid: true, processedAngle: 50 },
        { timestampMs: 200, valid: true, processedAngle: 80 },
        { timestampMs: 300, valid: true, processedAngle: 170 },
        { timestampMs: 400, valid: false, processedAngle: 20 },
        { timestampMs: 600, valid: true, processedAngle: 170 },
      ],
      events: [
        { timestampMs: 300, type: "REP_COUNTED", rep: 1 },
        { timestampMs: 500, type: "STATE_RESET" },
      ],
    };
    const result = replayCapturedProcessing(fixture);
    expect(result.predictedReps).toBe(1);
    expect(result.parity.matchesRecorded).toBe(true);
    expect(result.events.some((event) => event.type === "STATE_RESET")).toBe(
      true
    );
  });
});
