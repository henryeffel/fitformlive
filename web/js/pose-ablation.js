(function attachPoseAblation(root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("./pose-algorithms.js")
      : root.FitFormAlgorithms,
    typeof module === "object" && module.exports
      ? require("./pose-replay.js")
      : root.FitFormPoseReplay
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.FitFormPoseAblation = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createApi(
  algorithms,
  replay
) {
  const { REP_PHASE, advanceRepState, angleBetween, createRepState } =
    algorithms;
  const { smoothKeypoints } = replay;

  const CONFIGURATIONS = Object.freeze([
    {
      id: "A_BASELINE",
      label: "Baseline",
      features: {
        validation: false,
        ema: false,
        hysteresis: false,
        holdTime: false,
        invalidReset: false,
      },
    },
    {
      id: "B_VALIDATION",
      label: "Validation",
      features: {
        validation: true,
        ema: false,
        hysteresis: false,
        holdTime: false,
        invalidReset: false,
      },
    },
    {
      id: "C_SMOOTHING",
      label: "Smoothing",
      features: {
        validation: true,
        ema: true,
        hysteresis: false,
        holdTime: false,
        invalidReset: false,
      },
    },
    {
      id: "D_HYSTERESIS",
      label: "Hysteresis",
      features: {
        validation: true,
        ema: true,
        hysteresis: true,
        holdTime: false,
        invalidReset: false,
      },
    },
    {
      id: "E_STABLE_FSM",
      label: "Stable FSM",
      features: {
        validation: true,
        ema: true,
        hysteresis: true,
        holdTime: true,
        invalidReset: false,
      },
    },
    {
      id: "F_FULL",
      label: "Full",
      features: {
        validation: true,
        ema: true,
        hysteresis: true,
        holdTime: true,
        invalidReset: true,
      },
    },
  ]);

  function validateFrame(keypoints, requiredIndices, confidence, enabled) {
    if (!Array.isArray(keypoints) || keypoints.length < 17) {
      return { valid: false, reason: "missing_keypoints" };
    }
    for (const index of requiredIndices) {
      const keypoint = keypoints[index];
      if (
        !keypoint ||
        !Number.isFinite(keypoint.x) ||
        !Number.isFinite(keypoint.y)
      ) {
        return { valid: false, reason: "invalid_coordinate" };
      }
      if (!enabled) continue;
      if (!Number.isFinite(keypoint.score) || keypoint.score < confidence) {
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

  function trackingFailureIntervals(fixture) {
    return (fixture.eventViews?.interruptions || [])
      .filter(
        (item) =>
          item.classification === "interruption" ||
          item.classification === "open_interruption"
      )
      .map((item) => ({
        start: item.startedAtMs,
        end: item.endedAtMs ?? Infinity,
      }));
  }

  function isInsideIntervals(timestampMs, intervals) {
    return intervals.some(
      (interval) =>
        timestampMs >= interval.start && timestampMs <= interval.end
    );
  }

  function runAblation(fixture, configuration) {
    const features = configuration.features;
    const captureConfig = fixture.configAtCapture || {};
    const thresholds = captureConfig.thresholds || {};
    const parameters = {
      minJointConfidence: captureConfig.minJointConfidence ?? 0.4,
      emaAlpha: captureConfig.emaAlpha ?? 0.35,
      invalidResetMs: captureConfig.invalidResetMs ?? 1000,
      up: thresholds.up ?? 155,
      down: thresholds.down ?? 60,
      hysteresis: features.hysteresis
        ? captureConfig.thresholdHysteresis ?? 8
        : 0,
      holdMs: features.holdTime
        ? captureConfig.transitionHoldMs ?? 180
        : 0,
      angleJoints: captureConfig.angleJoints ?? [6, 8, 10],
    };

    let state = createRepState();
    let smoothed = null;
    let invalidSince = null;
    let resetApplied = false;
    let trackingInvalid = false;
    let validFrames = 0;
    let invalidFrames = 0;
    let contractionCandidates = 0;
    let confirmedContractions = 0;
    const invalidReasons = {};
    const events = [];
    const failureIntervals = trackingFailureIntervals(fixture);

    for (const frame of fixture.frames || []) {
      const now = frame.timestampMs;
      const validation = validateFrame(
        frame.keypoints,
        parameters.angleJoints,
        parameters.minJointConfidence,
        features.validation
      );
      if (!validation.valid) {
        invalidFrames += 1;
        invalidReasons[validation.reason] =
          (invalidReasons[validation.reason] || 0) + 1;
        if (invalidSince === null) invalidSince = now;
        trackingInvalid = true;
        if (
          features.invalidReset &&
          !resetApplied &&
          now - invalidSince >= parameters.invalidResetMs
        ) {
          const previousPhase = state.phase;
          state = { ...createRepState(), reps: state.reps };
          resetApplied = true;
          events.push({
            timestampMs: now,
            type: "STATE_RESET",
            from: previousPhase,
            to: state.phase,
          });
        }
        continue;
      }

      if (trackingInvalid) {
        events.push({
          timestampMs: now,
          type: "TRACKING_RECOVERED",
          invalidDurationMs:
            invalidSince === null ? null : now - invalidSince,
        });
      }
      trackingInvalid = false;
      invalidSince = null;
      resetApplied = false;
      validFrames += 1;

      const keypoints = features.ema
        ? (smoothed = smoothKeypoints(
            smoothed,
            frame.keypoints,
            parameters.emaAlpha
          ))
        : frame.keypoints;
      const [aIndex, bIndex, cIndex] = parameters.angleJoints;
      const angle = angleBetween(
        [keypoints[aIndex].x, keypoints[aIndex].y],
        [keypoints[bIndex].x, keypoints[bIndex].y],
        [keypoints[cIndex].x, keypoints[cIndex].y]
      );
      if (!Number.isFinite(angle)) {
        validFrames -= 1;
        invalidFrames += 1;
        invalidReasons.invalid_angle =
          (invalidReasons.invalid_angle || 0) + 1;
        continue;
      }

      const previousPhase = state.phase;
      const previousCandidate = state.transitionCandidate;
      const result = advanceRepState(state, angle, now, parameters);
      state = result.state;

      if (
        previousPhase === REP_PHASE.READY &&
        previousCandidate !== "bottom" &&
        state.transitionCandidate === "bottom"
      ) {
        contractionCandidates += 1;
        events.push({
          timestampMs: now,
          type: "CONTRACTION_CANDIDATE",
          angle,
        });
      }
      if (
        previousPhase === REP_PHASE.READY &&
        state.phase === REP_PHASE.BOTTOM_HOLD
      ) {
        if (parameters.holdMs === 0 && previousCandidate !== "bottom") {
          contractionCandidates += 1;
          events.push({
            timestampMs: now,
            type: "CONTRACTION_CANDIDATE",
            angle,
          });
        }
        confirmedContractions += 1;
        events.push({
          timestampMs: now,
          type: "CONTRACTION_CONFIRMED",
          angle,
        });
      }
      if (state.phase !== previousPhase) {
        events.push({
          timestampMs: now,
          type: "STATE_CHANGED",
          from: previousPhase,
          to: state.phase,
          angle,
        });
      }
      if (result.repCounted) {
        events.push({
          timestampMs: now,
          type: "REP_COUNTED",
          rep: state.reps,
          duringTrackingFailure: isInsideIntervals(now, failureIntervals),
        });
      }
    }

    const expected = fixture.groundTruth?.completeReps ?? null;
    const totalFrames = validFrames + invalidFrames;
    const eventCount = (type) =>
      events.filter((event) => event.type === type).length;
    const countsDuringTrackingFailure = events.filter(
      (event) =>
        event.type === "REP_COUNTED" && event.duringTrackingFailure
    ).length;

    return {
      fixture: {
        testId: fixture.testId,
        role: fixture.role,
        sourceSha256: fixture.derivedFrom?.sha256 ?? null,
      },
      configuration: {
        id: configuration.id,
        label: configuration.label,
        features: { ...features },
        parameters,
      },
      metrics: {
        groundTruth: expected,
        predictedReps: state.reps,
        absoluteRepError:
          Number.isInteger(expected) ? Math.abs(state.reps - expected) : null,
        overCount:
          Number.isInteger(expected) ? Math.max(0, state.reps - expected) : null,
        underCount:
          Number.isInteger(expected) ? Math.max(0, expected - state.reps) : null,
        validFrames,
        invalidFrames,
        validJointRate: totalFrames ? validFrames / totalFrames : null,
        stateTransitions: eventCount("STATE_CHANGED"),
        contractionCandidates,
        confirmedContractions,
        repCountEvents: eventCount("REP_COUNTED"),
        invalidResets: eventCount("STATE_RESET"),
        trackingRecoveries: eventCount("TRACKING_RECOVERED"),
        countsDuringTrackingFailure,
        invalidReasons,
      },
      interpretation: {
        possibleDuplicateCounts:
          fixture.role === "normal_regression"
            ? Math.max(0, state.reps - (expected ?? 0))
            : null,
        partialMotionFalsePositives:
          fixture.role === "threshold_sensitivity" ? state.reps : null,
        trackingFailureFalseCounts:
          fixture.role === "failure_safety"
            ? countsDuringTrackingFailure
            : null,
        resetObserved:
          fixture.role === "failure_safety"
            ? eventCount("STATE_RESET") > 0
            : null,
      },
      events,
    };
  }

  return {
    CONFIGURATIONS,
    runAblation,
    validateFrame,
  };
});
