const {
  evaluateSession,
  parseSession,
  recordedRepCount,
  toCsv,
} = require("../scripts/compare-video-sessions.js");

function frame(timestampMs, angle, repCount = 0) {
  const radians = (angle * Math.PI) / 180;
  const keypoints = Array.from({ length: 17 }, () => ({
    x: 0.5,
    y: 0.5,
    score: 1,
  }));
  keypoints[6] = { x: 1, y: 0.5, score: 1 };
  keypoints[8] = { x: 0.5, y: 0.5, score: 1 };
  keypoints[10] = {
    x: 0.5 + 0.5 * Math.cos(radians),
    y: 0.5 + 0.5 * Math.sin(radians),
    score: 1,
  };
  return { timestampMs, keypoints, valid: true, processedAngle: angle, repCount };
}

function session() {
  return {
    schemaVersion: "1.2",
    testId: "synthetic-one-rep",
    condition: "normal",
    groundTruth: { attemptedReps: 1, completeReps: 1 },
    configAtCapture: {
      minJointConfidence: 0.4,
      emaAlpha: 1,
      transitionHoldMs: 0,
      invalidResetMs: 1000,
      thresholdHysteresis: 8,
      thresholds: { up: 155, down: 60 },
      angleJoints: [6, 8, 10],
    },
    frames: [
      frame(0, 170),
      frame(100, 50),
      frame(300, 30),
      frame(500, 30),
      frame(700, 50),
      frame(900, 170, 1),
      frame(1100, 170, 1),
    ],
    events: [{ timestampMs: 900, type: "REP_COUNTED" }],
  };
}

describe("video session comparison", () => {
  it("compares recorded, replayed, and exploratory counts", () => {
    const result = evaluateSession(session(), "synthetic.json", {
      contractStartAngle: 60,
      fullContractAngle: 36,
      fullExtendAngle: 155,
      hysteresis: 8,
      holdMs: 0,
    });
    expect(result.recordedProduction.predictedReps).toBe(1);
    expect(result.captureParityReplay.predictedReps).toBe(1);
    expect(result.captureParityReplay.parity.matchesRecorded).toBe(true);
    expect(result.reviewCandidate.productionRepTimestampsMs).toEqual([900]);
    expect(result.diagnosticProductionReplay.predictedReps).toBe(1);
    expect(result.exploratoryFullContraction.predictedReps).toBe(1);
    expect(result.reviewCandidate.labelStatus).toBe(
      "machine_generated_review_candidate"
    );
  });

  it("repairs only a malformed optional notes line in memory", () => {
    const text = JSON.stringify(session(), null, 2).replace(
      '  "frames":',
      '  "notes": "broken"quote,\n  "frames":'
    );
    const parsed = parseSession(text);
    expect(parsed.session.notes).toBeNull();
    expect(parsed.repairs).toHaveLength(1);
  });

  it("falls back to frame rep count and writes stable CSV columns", () => {
    const fixture = session();
    fixture.events = [];
    expect(recordedRepCount(fixture)).toBe(1);
    const result = evaluateSession(fixture, "synthetic.json");
    result.sourceRepairs = [];
    expect(toCsv([result])).toContain("exploratoryFullContraction");
  });
});
