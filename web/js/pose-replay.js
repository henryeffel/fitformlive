(function attachPoseReplay(root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("./pose-algorithms.js")
      : root.FitFormAlgorithms
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.FitFormPoseReplay = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createApi(algorithms) {
  const {
    REP_PHASE,
    advanceRepState,
    angleBetween,
    createRepState,
  } = algorithms;

  function validateRequiredKeypoints(keypoints, requiredIndices, confidence) {
    if (!Array.isArray(keypoints) || keypoints.length < 17) {
      return { valid: false, reason: "missing_keypoints" };
    }
    for (const index of requiredIndices) {
      const keypoint = keypoints[index];
      if (
        !keypoint ||
        !Number.isFinite(keypoint.x) ||
        !Number.isFinite(keypoint.y) ||
        !Number.isFinite(keypoint.score)
      ) {
        return { valid: false, reason: "invalid_coordinate" };
      }
      if (keypoint.score < confidence) {
        return { valid: false, reason: "low_confidence" };
      }
      if (
        keypoint.x < 0 ||
        keypoint.x > 1 ||
        keypoint.y < 0 ||
        keypoint.y > 1
      ) {
        return { valid: false, reason: "outside_frame" };
      }
    }
    return { valid: true, reason: "valid" };
  }

  function smoothKeypoints(previous, current, alpha) {
    if (!previous) return current.map((keypoint) => ({ ...keypoint }));
    return current.map((keypoint, index) => {
      const prior = previous[index];
      if (
        !prior ||
        !Number.isFinite(keypoint?.x) ||
        !Number.isFinite(keypoint?.y)
      ) {
        return { ...keypoint };
      }
      return {
        ...keypoint,
        x: alpha * keypoint.x + (1 - alpha) * prior.x,
        y: alpha * keypoint.y + (1 - alpha) * prior.y,
      };
    });
  }

  function replayFixture(fixture, overrides = {}) {
    const captureConfig = fixture.configAtCapture || {};
    const thresholds = captureConfig.thresholds || {};
    const config = {
      minJointConfidence:
        overrides.minJointConfidence ??
        captureConfig.minJointConfidence ??
        0.4,
      emaAlpha: overrides.emaAlpha ?? captureConfig.emaAlpha ?? 0.35,
      invalidResetMs:
        overrides.invalidResetMs ?? captureConfig.invalidResetMs ?? 1000,
      up: overrides.up ?? thresholds.up ?? 155,
      down: overrides.down ?? thresholds.down ?? 60,
      hysteresis:
        overrides.hysteresis ??
        captureConfig.thresholdHysteresis ??
        8,
      holdMs:
        overrides.holdMs ?? captureConfig.transitionHoldMs ?? 180,
      angleJoints:
        overrides.angleJoints ?? captureConfig.angleJoints ?? [6, 8, 10],
    };

    const initialState = fixture.initialAlgorithmState;
    let repState = initialState
      ? {
          phase: initialState.phase || REP_PHASE.READY,
          transitionCandidate: initialState.transitionCandidate || null,
          transitionStartedAt: initialState.transitionStartedAtMs || 0,
          reps: initialState.reps || 0,
        }
      : createRepState();
    let smoothedKeypoints = null;
    let invalidSince = null;
    let resetApplied = false;
    let validFrames = 0;
    let invalidFrames = 0;
    let angleMin = Infinity;
    let angleMax = -Infinity;
    const invalidReasons = {};
    const events = [];

    for (const frame of fixture.frames || []) {
      const now = frame.timestampMs;
      const validation = validateRequiredKeypoints(
        frame.keypoints,
        config.angleJoints,
        config.minJointConfidence
      );
      if (!validation.valid) {
        invalidFrames += 1;
        invalidReasons[validation.reason] =
          (invalidReasons[validation.reason] || 0) + 1;
        if (invalidSince === null) invalidSince = now;
        if (
          !resetApplied &&
          now - invalidSince >= config.invalidResetMs
        ) {
          repState = {
            ...createRepState(),
            reps: repState.reps,
          };
          resetApplied = true;
          events.push({
            timestampMs: now,
            type: "STATE_RESET",
            reason: validation.reason,
          });
        }
        continue;
      }

      if (invalidSince !== null) {
        events.push({
          timestampMs: now,
          type: "TRACKING_RECOVERED",
          invalidDurationMs: now - invalidSince,
        });
      }
      invalidSince = null;
      resetApplied = false;
      validFrames += 1;
      smoothedKeypoints = smoothKeypoints(
        smoothedKeypoints,
        frame.keypoints,
        config.emaAlpha
      );
      const [aIndex, bIndex, cIndex] = config.angleJoints;
      const angle = angleBetween(
        [smoothedKeypoints[aIndex].x, smoothedKeypoints[aIndex].y],
        [smoothedKeypoints[bIndex].x, smoothedKeypoints[bIndex].y],
        [smoothedKeypoints[cIndex].x, smoothedKeypoints[cIndex].y]
      );
      if (!Number.isFinite(angle)) {
        invalidFrames += 1;
        validFrames -= 1;
        invalidReasons.invalid_angle =
          (invalidReasons.invalid_angle || 0) + 1;
        continue;
      }
      angleMin = Math.min(angleMin, angle);
      angleMax = Math.max(angleMax, angle);
      const previousPhase = repState.phase;
      const result = advanceRepState(repState, angle, now, config);
      repState = result.state;
      if (repState.phase !== previousPhase) {
        events.push({
          timestampMs: now,
          type: "STATE_CHANGED",
          from: previousPhase,
          to: repState.phase,
          angle,
        });
      }
      if (result.repCounted) {
        events.push({
          timestampMs: now,
          type: "REP_COUNTED",
          rep: repState.reps,
        });
      }
    }

    const totalFrames = validFrames + invalidFrames;
    return {
      testId: fixture.testId,
      expectedCompleteReps: fixture.groundTruth?.completeReps ?? null,
      predictedReps: repState.reps,
      absoluteRepError:
        Number.isInteger(fixture.groundTruth?.completeReps)
          ? Math.abs(repState.reps - fixture.groundTruth.completeReps)
          : null,
      finalPhase: repState.phase || REP_PHASE.READY,
      validFrames,
      invalidFrames,
      validJointRate: totalFrames > 0 ? validFrames / totalFrames : null,
      invalidReasons,
      angleRange:
        Number.isFinite(angleMin) && Number.isFinite(angleMax)
          ? { min: angleMin, max: angleMax }
          : null,
      configuration: config,
      deterministicReplay:
        (fixture.schemaVersion === "1.1" ||
          fixture.schemaVersion === "1.1-derived") &&
        Boolean(initialState) &&
        fixture.analysisActiveAtCapture === true,
      warnings:
        fixture.schemaVersion === "1.1" ||
        fixture.schemaVersion === "1.1-derived"
          ? []
          : [
              "schema 1.0 does not contain initial algorithm state; replay is diagnostic only",
            ],
      events,
    };
  }

  return {
    replayFixture,
    smoothKeypoints,
    validateRequiredKeypoints,
  };
});
