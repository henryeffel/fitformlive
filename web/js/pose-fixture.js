(function attachPoseFixture(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.FitFormPoseFixture = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createApi() {
  const SCHEMA_VERSION = "1.1";
  const SUPPORTED_SCHEMA_VERSIONS = Object.freeze([
    "1.0",
    "1.1",
    "1.1-derived",
  ]);
  const DEFAULT_JITTER_THRESHOLD_MS = 250;
  const KEYPOINT_NAMES = Object.freeze([
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip", "left_knee",
    "right_knee", "left_ankle", "right_ankle",
  ]);

  function finiteOrNull(value) {
    return Number.isFinite(value) ? value : null;
  }

  function normalizeKeypoints(keypoints, width, height) {
    return KEYPOINT_NAMES.map((name, index) => {
      const keypoint = keypoints?.[index] || {};
      return {
        name,
        x: Number.isFinite(keypoint.x) && width > 0 ? keypoint.x / width : null,
        y: Number.isFinite(keypoint.y) && height > 0 ? keypoint.y / height : null,
        score: finiteOrNull(keypoint.score),
      };
    });
  }

  function createRecorder(metadata, startedAtMs) {
    return {
      active: true,
      startedAtMs,
      metadata: JSON.parse(JSON.stringify(metadata)),
      frames: [],
      events: [],
      lastPhase: null,
    };
  }

  function recordFrame(recorder, input) {
    if (!recorder?.active) return;
    const timestampMs = input.nowMs - recorder.startedAtMs;
    recorder.frames.push({
      timestampMs,
      valid: Boolean(input.valid),
      validationReason: input.validationReason || null,
      keypoints: normalizeKeypoints(
        input.keypoints,
        input.videoWidth,
        input.videoHeight
      ),
    });
    if (input.phase && input.phase !== recorder.lastPhase) {
      recorder.events.push({
        timestampMs,
        type: "STATE_CHANGED",
        from: recorder.lastPhase,
        to: input.phase,
      });
      recorder.lastPhase = input.phase;
    }
  }

  function recordEvent(recorder, nowMs, type, details = {}) {
    if (!recorder?.active) return;
    recorder.events.push({
      timestampMs: nowMs - recorder.startedAtMs,
      type,
      ...details,
    });
  }

  function classifyTrackingEvents(events, jitterThresholdMs) {
    const interruptions = [];
    let lostEvent = null;
    for (const event of events || []) {
      if (event.type === "TRACKING_LOST" && !lostEvent) {
        lostEvent = event;
      } else if (event.type === "TRACKING_RECOVERED" && lostEvent) {
        const durationMs = event.timestampMs - lostEvent.timestampMs;
        interruptions.push({
          startedAtMs: lostEvent.timestampMs,
          endedAtMs: event.timestampMs,
          durationMs,
          classification:
            durationMs < jitterThresholdMs ? "jitter" : "interruption",
        });
        lostEvent = null;
      }
    }
    if (lostEvent) {
      interruptions.push({
        startedAtMs: lostEvent.timestampMs,
        endedAtMs: null,
        durationMs: null,
        classification: "open_interruption",
      });
    }
    return {
      jitterThresholdMs,
      thresholdBasis: "initial_empirical_value",
      interruptions,
    };
  }

  function finalizeRecorder(recorder, result) {
    recorder.active = false;
    const validFrames = recorder.frames.filter((frame) => frame.valid).length;
    const invalidFrames = recorder.frames.length - validFrames;
    return {
      schemaVersion: SCHEMA_VERSION,
      testId: recorder.metadata.testId,
      condition: recorder.metadata.condition,
      exercise: recorder.metadata.exercise,
      groundTruth: {
        attemptedReps: recorder.metadata.attemptedReps,
        completeReps: recorder.metadata.completeReps,
      },
      algorithmVersion: recorder.metadata.algorithmVersion,
      configAtCapture: recorder.metadata.configAtCapture,
      initialAlgorithmState: recorder.metadata.initialAlgorithmState,
      analysisActiveAtCapture: recorder.metadata.analysisActiveAtCapture,
      source: recorder.metadata.source,
      capture: {
        durationMs: result.endedAtMs - recorder.startedAtMs,
        frameCount: recorder.frames.length,
        validFrames,
        invalidFrames,
        validJointRate:
          recorder.frames.length > 0
            ? validFrames / recorder.frames.length
            : null,
      },
      notes: recorder.metadata.notes || null,
      frames: recorder.frames,
      events: recorder.events,
      eventViews: classifyTrackingEvents(
        recorder.events,
        DEFAULT_JITTER_THRESHOLD_MS
      ),
    };
  }

  function validateFixture(fixture) {
    const errors = [];
    if (!SUPPORTED_SCHEMA_VERSIONS.includes(fixture?.schemaVersion)) {
      errors.push(
        `schemaVersion must be one of ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}`
      );
    }
    if (!fixture?.testId) errors.push("testId is required");
    if (!fixture?.exercise) errors.push("exercise is required");
    if (!Array.isArray(fixture?.frames) || fixture.frames.length === 0) {
      errors.push("frames must contain at least one frame");
    } else {
      let previous = -Infinity;
      fixture.frames.forEach((frame, frameIndex) => {
        if (!Number.isFinite(frame.timestampMs) || frame.timestampMs < previous) {
          errors.push(`frame ${frameIndex} timestamp is not monotonic`);
        }
        previous = frame.timestampMs;
        if (!Array.isArray(frame.keypoints) || frame.keypoints.length !== 17) {
          errors.push(`frame ${frameIndex} must contain 17 keypoints`);
          return;
        }
        frame.keypoints.forEach((keypoint, keypointIndex) => {
          if (keypoint.name !== KEYPOINT_NAMES[keypointIndex]) {
            errors.push(`frame ${frameIndex} keypoint ${keypointIndex} has invalid name`);
          }
        });
      });
    }
    if (!fixture?.algorithmVersion?.commit) {
      errors.push("algorithmVersion.commit is required");
    }
    if (!fixture?.configAtCapture) errors.push("configAtCapture is required");
    if (
      (fixture?.schemaVersion === "1.1" ||
        fixture?.schemaVersion === "1.1-derived") &&
      !fixture?.initialAlgorithmState
    ) {
      errors.push("initialAlgorithmState is required for schema 1.1");
    }
    return { valid: errors.length === 0, errors };
  }

  return {
    KEYPOINT_NAMES,
    SCHEMA_VERSION,
    SUPPORTED_SCHEMA_VERSIONS,
    classifyTrackingEvents,
    createRecorder,
    finalizeRecorder,
    normalizeKeypoints,
    recordEvent,
    recordFrame,
    validateFixture,
  };
});
