(function attachPoseAlgorithms(root, factory) {
  const algorithms = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = algorithms;
  } else {
    root.FitFormAlgorithms = algorithms;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createAlgorithms() {
  const REP_PHASE = Object.freeze({
    READY: "ready",
    BOTTOM_HOLD: "bottom_hold",
    RETURNING: "returning",
  });

  function angleBetween(a, b, c) {
    const ab = [a[0] - b[0], a[1] - b[1]];
    const cb = [c[0] - b[0], c[1] - b[1]];
    const dot = ab[0] * cb[0] + ab[1] * cb[1];
    const magAB = Math.hypot(ab[0], ab[1]);
    const magCB = Math.hypot(cb[0], cb[1]);
    if (magAB < 1e-6 || magCB < 1e-6) return null;
    const cosine = dot / (magAB * magCB);
    const radians = Math.acos(Math.min(Math.max(cosine, -1), 1));
    const angle = (radians * 180) / Math.PI;
    return Number.isFinite(angle) ? angle : null;
  }

  function calculateAngularVelocity({
    previousAngle,
    currentAngle,
    elapsedMs,
    minIntervalMs,
    maxGapMs,
    maxVelocityDegPerSec,
  }) {
    if (
      !Number.isFinite(previousAngle) ||
      !Number.isFinite(currentAngle) ||
      !Number.isFinite(elapsedMs) ||
      elapsedMs < minIntervalMs
    ) {
      return { velocity: 0, rejected: true, reason: "interval_too_short" };
    }
    if (elapsedMs > maxGapMs) {
      return { velocity: 0, rejected: true, reason: "interval_too_long" };
    }

    const velocity = (currentAngle - previousAngle) / (elapsedMs / 1000);
    if (
      !Number.isFinite(velocity) ||
      Math.abs(velocity) > maxVelocityDegPerSec
    ) {
      return { velocity: 0, rejected: true, reason: "velocity_outlier" };
    }
    return { velocity, rejected: false, reason: null };
  }

  function createRepState() {
    return {
      phase: REP_PHASE.READY,
      transitionCandidate: null,
      transitionStartedAt: 0,
      reps: 0,
    };
  }

  function advanceRepState(repState, angle, now, config) {
    const next = { ...repState };
    const { up, down, hysteresis, holdMs } = config;
    let repCounted = false;

    function clearTransition() {
      next.transitionCandidate = null;
      next.transitionStartedAt = 0;
    }

    function transitionHeld(candidate, condition) {
      if (!condition) {
        if (next.transitionCandidate === candidate) clearTransition();
        return false;
      }
      if (next.transitionCandidate !== candidate) {
        next.transitionCandidate = candidate;
        next.transitionStartedAt = now;
        return holdMs <= 0;
      }
      return now - next.transitionStartedAt >= holdMs;
    }

    if (
      next.phase === REP_PHASE.READY &&
      transitionHeld("bottom", angle <= down)
    ) {
      next.phase = REP_PHASE.BOTTOM_HOLD;
      clearTransition();
      return { state: next, repCounted };
    }

    if (
      next.phase === REP_PHASE.BOTTOM_HOLD &&
      angle >= down + hysteresis
    ) {
      next.phase = REP_PHASE.RETURNING;
      clearTransition();
      return { state: next, repCounted };
    }

    if (
      next.phase === REP_PHASE.RETURNING &&
      transitionHeld("top", angle >= up)
    ) {
      next.phase = REP_PHASE.READY;
      next.reps += 1;
      repCounted = true;
      clearTransition();
    }

    return { state: next, repCounted };
  }

  return {
    REP_PHASE,
    advanceRepState,
    angleBetween,
    calculateAngularVelocity,
    createRepState,
  };
});
