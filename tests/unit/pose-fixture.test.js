const {
  KEYPOINT_NAMES,
  createRecorder,
  finalizeRecorder,
  recordEvent,
  recordFrame,
  validateFixture,
} = require("../../web/js/pose-fixture.js");

function keypoints() {
  return KEYPOINT_NAMES.map((name, index) => ({
    name,
    x: index * 10,
    y: index * 5,
    score: 0.9,
  }));
}

function metadata() {
  return {
    testId: "curl-normal-01",
    condition: "normal",
    exercise: "right_curl",
    targetArm: "right",
    attemptedReps: 10,
    completeReps: 10,
    algorithmVersion: { commit: "abc123", dirty: false },
    configAtCapture: { emaAlpha: 0.35 },
    initialAlgorithmState: {
      phase: "ready",
      transitionCandidate: null,
      transitionStartedAtMs: 0,
      reps: 0,
      smoothedKeypoints: null,
      invalidSinceMs: null,
    },
    analysisActiveAtCapture: true,
    source: {
      width: 200,
      height: 100,
      mirrored: true,
      coordinateSystem: "normalized",
    },
  };
}

describe("pose fixture recorder", () => {
  it("normalizes keypoints and builds a valid, parseable fixture", () => {
    const recorder = createRecorder(metadata(), 1000);
    recordEvent(recorder, 1000, "CAPTURE_STARTED");
    recordFrame(recorder, {
      nowMs: 1010,
      valid: true,
      keypoints: keypoints(),
      videoWidth: 200,
      videoHeight: 100,
      phase: "ready",
    });
    recordFrame(recorder, {
      nowMs: 1020,
      valid: false,
      validationReason: "right_wrist confidence too low",
      keypoints: keypoints(),
      videoWidth: 200,
      videoHeight: 100,
      phase: "ready",
    });

    const fixture = finalizeRecorder(recorder, {
      endedAtMs: 1030,
      video: {
        filename: "curl-normal-01.webm",
        mimeType: "video/webm",
      },
    });
    const reparsed = JSON.parse(JSON.stringify(fixture));
    const validation = validateFixture(reparsed);

    expect(validation).toEqual({ valid: true, errors: [] });
    expect(reparsed.capture).toMatchObject({
      frameCount: 2,
      validFrames: 1,
      invalidFrames: 1,
      validJointRate: 0.5,
    });
    expect(reparsed.targetArm).toBe("right");
    expect(reparsed.frames[0].keypoints[1]).toMatchObject({
      name: "left_eye",
      x: 0.05,
      y: 0.05,
      score: 0.9,
    });
  });

  it("rejects decreasing timestamps and malformed keypoints", () => {
    const recorder = createRecorder(metadata(), 1000);
    recordFrame(recorder, {
      nowMs: 1020,
      valid: true,
      keypoints: keypoints(),
      videoWidth: 200,
      videoHeight: 100,
    });
    recordFrame(recorder, {
      nowMs: 1010,
      valid: true,
      keypoints: [],
      videoWidth: 200,
      videoHeight: 100,
    });
    const fixture = finalizeRecorder(recorder, {
      endedAtMs: 1030,
      video: {
        filename: "curl-normal-01.webm",
        mimeType: "video/webm",
      },
    });

    fixture.frames[1].keypoints = [];
    const validation = validateFixture(fixture);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain(
      "frame 1 timestamp is not monotonic"
    );
    expect(validation.errors).toContain(
      "frame 1 must contain 17 keypoints"
    );
  });
});
