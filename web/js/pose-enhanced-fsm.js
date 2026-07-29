(function attachEnhancedFsm(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.FitFormEnhancedFsm = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createApi() {
  const PHASE = Object.freeze({
    EXTENDED: "extended",
    CONTRACTING: "contracting",
    FULLY_CONTRACTED: "fully_contracted",
    RETURNING: "returning",
  });

  function runFullContractionFsm(traceAnalysis, config) {
    let phase = PHASE.EXTENDED;
    let candidate = null;
    let candidateStartedAt = null;
    let reps = 0;
    const events = [];

    function clearCandidate() {
      candidate = null;
      candidateStartedAt = null;
    }

    function held(type, condition, now) {
      if (!condition) {
        if (candidate === type) clearCandidate();
        return false;
      }
      if (candidate !== type) {
        candidate = type;
        candidateStartedAt = now;
        return config.holdMs <= 0;
      }
      return now - candidateStartedAt >= config.holdMs;
    }

    for (const frame of traceAnalysis.trace) {
      const now = frame.timestampMs;
      if (frame.events.includes("STATE_RESET")) {
        const from = phase;
        phase = PHASE.EXTENDED;
        clearCandidate();
        events.push({
          timestampMs: now,
          type: "STATE_RESET",
          from,
          to: phase,
        });
        continue;
      }
      if (!frame.valid || !Number.isFinite(frame.processedAngle)) continue;
      const angle = frame.processedAngle;
      const before = phase;

      if (
        phase === PHASE.EXTENDED &&
        angle <= config.contractStartAngle
      ) {
        phase = PHASE.CONTRACTING;
      }
      if (
        phase === PHASE.CONTRACTING &&
        held(
          "full_contraction",
          angle <= config.fullContractAngle,
          now
        )
      ) {
        phase = PHASE.FULLY_CONTRACTED;
        clearCandidate();
        events.push({
          timestampMs: now,
          type: "FULL_CONTRACTION_CONFIRMED",
          angle,
        });
      } else if (
        phase === PHASE.CONTRACTING &&
        angle >= config.fullExtendAngle
      ) {
        phase = PHASE.EXTENDED;
        clearCandidate();
        events.push({
          timestampMs: now,
          type: "INCOMPLETE_CONTRACTION_REJECTED",
          angle,
        });
      }
      if (
        phase === PHASE.FULLY_CONTRACTED &&
        angle >= config.fullContractAngle + config.hysteresis
      ) {
        phase = PHASE.RETURNING;
      }
      if (
        phase === PHASE.RETURNING &&
        held("extension", angle >= config.fullExtendAngle, now)
      ) {
        phase = PHASE.EXTENDED;
        reps += 1;
        clearCandidate();
        events.push({
          timestampMs: now,
          type: "REP_COUNTED",
          rep: reps,
          angle,
        });
      }
      if (phase !== before) {
        events.push({
          timestampMs: now,
          type: "STATE_CHANGED",
          from: before,
          to: phase,
          angle,
        });
      }
    }
    return {
      configuration: { ...config },
      predictedReps: reps,
      finalPhase: phase,
      events,
    };
  }

  return {
    PHASE,
    runFullContractionFsm,
  };
});
