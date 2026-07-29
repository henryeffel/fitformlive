(function attachPoseTrace(root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("./pose-algorithms.js")
      : root.FitFormAlgorithms,
    typeof module === "object" && module.exports
      ? require("./pose-replay.js")
      : root.FitFormPoseReplay,
    typeof module === "object" && module.exports
      ? require("./pose-ablation.js")
      : root.FitFormPoseAblation
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.FitFormPoseTrace = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createApi(
  algorithms,
  replay,
  ablation
) {
  const {
    REP_PHASE,
    advanceRepState,
    angleBetween,
    calculateAngularVelocity,
    createRepState,
  } = algorithms;
  const { smoothKeypoints } = replay;
  const { validateFrame } = ablation;

  const DIAGNOSTIC_THRESHOLDS = Object.freeze({
    shortCycleMs: 1000,
    postResetWindowMs: 1000,
    postRecoveryWindowMs: 1000,
    nearbyBrowserRepToleranceMs: 500,
  });

  function requiredJointMinConfidence(keypoints, indices) {
    const scores = indices
      .map((index) => keypoints?.[index]?.score)
      .filter(Number.isFinite);
    return scores.length ? Math.min(...scores) : null;
  }

  function calculateAngle(keypoints, indices) {
    if (!Array.isArray(keypoints)) return null;
    const [a, b, c] = indices.map((index) => keypoints[index]);
    if (
      !a ||
      !b ||
      !c ||
      !Number.isFinite(a.x) ||
      !Number.isFinite(a.y) ||
      !Number.isFinite(b.x) ||
      !Number.isFinite(b.y) ||
      !Number.isFinite(c.x) ||
      !Number.isFinite(c.y)
    ) {
      return null;
    }
    return angleBetween([a.x, a.y], [b.x, b.y], [c.x, c.y]);
  }

  function findTrackingInterruption(timestampMs, fixture) {
    const interruptions = fixture.eventViews?.interruptions || [];
    const index = interruptions.findIndex(
      (item) =>
        timestampMs >= item.startedAtMs &&
        (item.endedAtMs === null || timestampMs <= item.endedAtMs)
    );
    return index >= 0 ? index + 1 : null;
  }

  function nearestTimestamp(value, timestamps) {
    if (!timestamps.length) return { timestampMs: null, distanceMs: null };
    let nearest = timestamps[0];
    for (const timestamp of timestamps) {
      if (Math.abs(timestamp - value) < Math.abs(nearest - value)) {
        nearest = timestamp;
      }
    }
    return {
      timestampMs: nearest,
      distanceMs: Math.abs(nearest - value),
    };
  }

  function alignCyclesToBrowserLabels(cycles, labelTimestamps) {
    if (labelTimestamps.length === 0) {
      return cycles.map(() => ({
        matched: false,
        labelIndex: null,
        labelTimestampMs: null,
        distanceMs: null,
      }));
    }
    const cycleCount = cycles.length;
    const labelCount = labelTimestamps.length;
    const costs = Array.from({ length: cycleCount + 1 }, () =>
      Array(labelCount + 1).fill(Infinity)
    );
    const choices = Array.from({ length: cycleCount + 1 }, () =>
      Array(labelCount + 1).fill(null)
    );
    for (let cycleIndex = 0; cycleIndex <= cycleCount; cycleIndex += 1) {
      costs[cycleIndex][0] = 0;
      choices[cycleIndex][0] = "skip";
    }
    for (let cycleIndex = 1; cycleIndex <= cycleCount; cycleIndex += 1) {
      for (
        let labelIndex = 1;
        labelIndex <= Math.min(labelCount, cycleIndex);
        labelIndex += 1
      ) {
        const skip = costs[cycleIndex - 1][labelIndex];
        const match =
          costs[cycleIndex - 1][labelIndex - 1] +
          Math.abs(
            cycles[cycleIndex - 1].repCountedAtMs -
              labelTimestamps[labelIndex - 1]
          );
        if (match <= skip) {
          costs[cycleIndex][labelIndex] = match;
          choices[cycleIndex][labelIndex] = "match";
        } else {
          costs[cycleIndex][labelIndex] = skip;
          choices[cycleIndex][labelIndex] = "skip";
        }
      }
    }
    const alignment = cycles.map(() => ({
      matched: false,
      labelIndex: null,
      labelTimestampMs: null,
      distanceMs: null,
    }));
    let cycleIndex = cycleCount;
    let labelIndex = Math.min(labelCount, cycleCount);
    while (cycleIndex > 0 && labelIndex > 0) {
      if (choices[cycleIndex][labelIndex] === "match") {
        const timestamp = labelTimestamps[labelIndex - 1];
        alignment[cycleIndex - 1] = {
          matched: true,
          labelIndex,
          labelTimestampMs: timestamp,
          distanceMs: Math.abs(
            cycles[cycleIndex - 1].repCountedAtMs - timestamp
          ),
        };
        cycleIndex -= 1;
        labelIndex -= 1;
      } else {
        cycleIndex -= 1;
      }
    }
    return alignment;
  }

  function buildCycles(trace, fixture, thresholds) {
    const browserRepTimestamps = (fixture.events || [])
      .filter((event) => event.type === "REP_COUNTED")
      .map((event) => event.timestampMs);
    const cycles = [];
    let active = null;
    let previousRepAt = null;
    let lastResetAt = null;
    let lastRecoveryAt = null;

    for (const frame of trace) {
      if (frame.events.includes("STATE_RESET")) lastResetAt = frame.timestampMs;
      if (frame.events.includes("TRACKING_RECOVERED")) {
        lastRecoveryAt = frame.timestampMs;
      }
      if (frame.events.includes("CONTRACTION_CONFIRMED")) {
        active = {
          startFrameIndex: frame.frameIndex,
          contractionCandidateAtMs:
            frame.contractionCandidateStartedAtMs ?? frame.timestampMs,
          contractionConfirmedAtMs: frame.timestampMs,
          returningAtMs: null,
          extensionCandidateAtMs: null,
          extensionConfirmedAtMs: null,
          resetCount: 0,
          recoveryCount: 0,
          lastResetBeforeStartAtMs: lastResetAt,
          lastRecoveryBeforeStartAtMs: lastRecoveryAt,
        };
      }
      if (!active) continue;
      if (frame.events.includes("STATE_RESET")) active.resetCount += 1;
      if (frame.events.includes("TRACKING_RECOVERED")) {
        active.recoveryCount += 1;
      }
      if (frame.events.includes("RETURNING_STARTED")) {
        active.returningAtMs = frame.timestampMs;
      }
      if (frame.events.includes("EXTENSION_CANDIDATE")) {
        active.extensionCandidateAtMs = frame.timestampMs;
      }
      if (!frame.events.includes("REP_COUNTED")) continue;

      active.extensionConfirmedAtMs = frame.timestampMs;
      const cycleFrames = trace.slice(
        active.startFrameIndex,
        frame.frameIndex + 1
      );
      const rawAngles = cycleFrames
        .map((item) => item.rawAngle)
        .filter(Number.isFinite);
      const processedAngles = cycleFrames
        .map((item) => item.processedAngle)
        .filter(Number.isFinite);
      let invalidDurationMs = 0;
      let currentInvalidMs = 0;
      let maxConsecutiveInvalidMs = 0;
      for (let index = 1; index < cycleFrames.length; index += 1) {
        const elapsed =
          cycleFrames[index].timestampMs -
          cycleFrames[index - 1].timestampMs;
        if (!cycleFrames[index].valid) {
          invalidDurationMs += elapsed;
          currentInvalidMs += elapsed;
          maxConsecutiveInvalidMs = Math.max(
            maxConsecutiveInvalidMs,
            currentInvalidMs
          );
        } else {
          currentInvalidMs = 0;
        }
      }
      const nearestBrowserRep = nearestTimestamp(
        frame.timestampMs,
        browserRepTimestamps
      );
      const durationMs =
        frame.timestampMs - active.contractionConfirmedAtMs;
      const gapFromPreviousRepMs =
        previousRepAt === null ? null : frame.timestampMs - previousRepAt;
      const timeSinceResetAtStartMs =
        active.lastResetBeforeStartAtMs === null
          ? null
          : active.contractionConfirmedAtMs -
            active.lastResetBeforeStartAtMs;
      const timeSinceRecoveryAtStartMs =
        active.lastRecoveryBeforeStartAtMs === null
          ? null
          : active.contractionConfirmedAtMs -
            active.lastRecoveryBeforeStartAtMs;
      const processedMin = processedAngles.length
        ? Math.min(...processedAngles)
        : null;
      const processedMax = processedAngles.length
        ? Math.max(...processedAngles)
        : null;
      const flags = [];
      if (
        durationMs < thresholds.shortCycleMs ||
        (gapFromPreviousRepMs !== null &&
          gapFromPreviousRepMs < thresholds.shortCycleMs)
      ) {
        flags.push("possible_short_cycle");
      }
      if (
        active.resetCount > 0 ||
        (timeSinceResetAtStartMs !== null &&
          timeSinceResetAtStartMs <= thresholds.postResetWindowMs)
      ) {
        flags.push("possible_reset_induced_split");
      }
      if (
        timeSinceRecoveryAtStartMs !== null &&
        timeSinceRecoveryAtStartMs <= thresholds.postRecoveryWindowMs
      ) {
        flags.push("possible_recovery_induced_split");
      }
      if (
        nearestBrowserRep.distanceMs === null ||
        nearestBrowserRep.distanceMs >
          thresholds.nearbyBrowserRepToleranceMs
      ) {
        flags.push("no_nearby_browser_rep_label");
      }
      if (
        fixture.role === "threshold_sensitivity" &&
        fixture.groundTruth?.completeReps === 0 &&
        processedMin !== null &&
        processedMin <=
          (fixture.configAtCapture?.thresholds?.down ?? 60)
      ) {
        flags.push("boundary_definition_mismatch");
      }

      cycles.push({
        cycle: cycles.length + 1,
        rep: frame.repCount,
        startFrameIndex: active.startFrameIndex,
        endFrameIndex: frame.frameIndex,
        contractionCandidateAtMs: active.contractionCandidateAtMs,
        contractionConfirmedAtMs: active.contractionConfirmedAtMs,
        returningAtMs: active.returningAtMs,
        extensionCandidateAtMs: active.extensionCandidateAtMs,
        repCountedAtMs: frame.timestampMs,
        durationMs,
        rawMinAngle: rawAngles.length ? Math.min(...rawAngles) : null,
        rawMaxAngle: rawAngles.length ? Math.max(...rawAngles) : null,
        processedMinAngle: processedMin,
        processedMaxAngle: processedMax,
        observedProcessedRom:
          processedMin !== null && processedMax !== null
            ? processedMax - processedMin
            : null,
        contractionHoldMs:
          active.contractionCandidateAtMs === null
            ? null
            : active.contractionConfirmedAtMs -
              active.contractionCandidateAtMs,
        extensionHoldMs:
          active.extensionCandidateAtMs === null
            ? null
            : frame.timestampMs - active.extensionCandidateAtMs,
        invalidDurationMs,
        maxConsecutiveInvalidMs,
        resetCount: active.resetCount,
        recoveryCount: active.recoveryCount,
        gapFromPreviousRepMs,
        timeSinceResetAtStartMs,
        timeSinceRecoveryAtStartMs,
        nearestBrowserRep,
        diagnosticFlags: flags,
      });
      previousRepAt = frame.timestampMs;
      active = null;
    }
    const alignment = alignCyclesToBrowserLabels(
      cycles,
      browserRepTimestamps
    );
    cycles.forEach((cycle, index) => {
      cycle.browserLabelAlignment = alignment[index];
      if (!alignment[index].matched) {
        cycle.diagnosticFlags.push("no_aligned_browser_rep_label");
      }
    });
    return cycles;
  }

  function generateFullTrace(
    fixture,
    thresholds = DIAGNOSTIC_THRESHOLDS
  ) {
    const captureConfig = fixture.configAtCapture || {};
    const angleJoints = captureConfig.angleJoints || [6, 8, 10];
    const stateConfig = {
      up: captureConfig.thresholds?.up ?? 155,
      down: captureConfig.thresholds?.down ?? 60,
      hysteresis: captureConfig.thresholdHysteresis ?? 8,
      holdMs: captureConfig.transitionHoldMs ?? 180,
    };
    const minConfidence = captureConfig.minJointConfidence ?? 0.4;
    const invalidResetMs = captureConfig.invalidResetMs ?? 1000;
    const alpha = captureConfig.emaAlpha ?? 0.35;
    let state = createRepState();
    let smoothed = null;
    let invalidSince = null;
    let resetApplied = false;
    let lastValidAt = null;
    let previousAngle = null;
    let previousAngleAt = null;
    const trace = [];

    for (let frameIndex = 0; frameIndex < fixture.frames.length; frameIndex += 1) {
      const frame = fixture.frames[frameIndex];
      const now = frame.timestampMs;
      const rawAngle = calculateAngle(frame.keypoints, angleJoints);
      const validation = validateFrame(
        frame.keypoints,
        angleJoints,
        minConfidence,
        true
      );
      const phaseBefore = state.phase;
      const candidateBefore = state.transitionCandidate;
      const events = [];
      let processedAngle = null;
      let angularVelocityDegPerSec = null;
      let contractionCandidateStartedAtMs = null;

      if (!validation.valid) {
        if (invalidSince === null) invalidSince = now;
        if (!resetApplied && now - invalidSince >= invalidResetMs) {
          state = { ...createRepState(), reps: state.reps };
          resetApplied = true;
          events.push("STATE_RESET");
        }
      } else {
        if (invalidSince !== null) events.push("TRACKING_RECOVERED");
        invalidSince = null;
        resetApplied = false;
        smoothed = smoothKeypoints(smoothed, frame.keypoints, alpha);
        processedAngle = calculateAngle(smoothed, angleJoints);
        if (
          Number.isFinite(previousAngle) &&
          Number.isFinite(previousAngleAt) &&
          Number.isFinite(processedAngle)
        ) {
          angularVelocityDegPerSec = calculateAngularVelocity({
            previousAngle,
            currentAngle: processedAngle,
            elapsedMs: now - previousAngleAt,
            minIntervalMs:
              captureConfig.minAngularVelocityIntervalMs ?? 8,
            maxGapMs: captureConfig.maxAngularVelocityGapMs ?? 250,
            maxVelocityDegPerSec:
              captureConfig.maxAngularVelocityDegPerSec ?? 1000,
          }).velocity;
        }
        previousAngle = processedAngle;
        previousAngleAt = now;
        const result = advanceRepState(
          state,
          processedAngle,
          now,
          stateConfig
        );
        const next = result.state;
        if (
          phaseBefore === REP_PHASE.READY &&
          candidateBefore !== "bottom" &&
          next.transitionCandidate === "bottom"
        ) {
          events.push("CONTRACTION_CANDIDATE");
        }
        if (
          phaseBefore === REP_PHASE.READY &&
          next.phase === REP_PHASE.BOTTOM_HOLD
        ) {
          contractionCandidateStartedAtMs =
            state.transitionStartedAt || now;
          events.push("CONTRACTION_CONFIRMED");
        }
        if (
          phaseBefore === REP_PHASE.BOTTOM_HOLD &&
          next.phase === REP_PHASE.RETURNING
        ) {
          events.push("RETURNING_STARTED");
        }
        if (
          phaseBefore === REP_PHASE.RETURNING &&
          candidateBefore !== "top" &&
          next.transitionCandidate === "top"
        ) {
          events.push("EXTENSION_CANDIDATE");
        }
        if (result.repCounted) {
          events.push("EXTENSION_CONFIRMED", "REP_COUNTED");
        }
        state = next;
        lastValidAt = now;
      }

      trace.push({
        frameIndex,
        timestampMs: now,
        rawAngle,
        processedAngle,
        requiredJointMinConfidence: requiredJointMinConfidence(
          frame.keypoints,
          angleJoints
        ),
        valid: validation.valid,
        invalidReason: validation.valid ? null : validation.reason,
        phaseBefore,
        phaseAfter: state.phase,
        candidateBefore,
        candidateAfter: state.transitionCandidate,
        candidateStartedAtMs:
          state.transitionCandidate === null
            ? null
            : state.transitionStartedAt,
        candidateAgeMs:
          state.transitionCandidate === null
            ? null
            : now - state.transitionStartedAt,
        contractionCandidateStartedAtMs,
        angularVelocityDegPerSec,
        timeSinceLastValidMs:
          lastValidAt === null ? null : now - lastValidAt,
        trackingInterruptionId: findTrackingInterruption(now, fixture),
        repCount: state.reps,
        events,
      });
    }

    return {
      traceVersion: "1.0",
      fixture: {
        testId: fixture.testId,
        role: fixture.role,
        sourceSha256: fixture.derivedFrom?.sha256 ?? null,
      },
      configuration: "F_FULL",
      diagnosticThresholds: { ...thresholds },
      trace,
      cycles: buildCycles(trace, fixture, thresholds),
    };
  }

  return {
    DIAGNOSTIC_THRESHOLDS,
    alignCyclesToBrowserLabels,
    buildCycles,
    calculateAngle,
    generateFullTrace,
    nearestTimestamp,
    requiredJointMinConfidence,
  };
});
