(function attachExternalVideoAnalysis(root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("./pose-replay.js")
      : root.FitFormPoseReplay,
    typeof module === "object" && module.exports
      ? require("./pose-trace.js")
      : root.FitFormPoseTrace,
    typeof module === "object" && module.exports
      ? require("./pose-enhanced-fsm.js")
      : root.FitFormEnhancedFsm
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.FitFormExternalVideoAnalysis = api;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function createApi(replay, poseTrace, enhancedFsm) {
    const ARM_JOINTS = Object.freeze({
      left: Object.freeze([5, 7, 9]),
      right: Object.freeze([6, 8, 10]),
    });

    const DEFAULT_CONFIG = Object.freeze({
      minJointConfidence: 0.4,
      emaAlpha: 0.35,
      invalidResetMs: 1000,
      thresholdHysteresis: 8,
      transitionHoldMs: 180,
      thresholds: Object.freeze({ up: 155, down: 60 }),
    });

    const DEFAULT_ENHANCED_CONFIG = Object.freeze({
      contractStartAngle: 60,
      fullContractAngle: 36.35789058153856,
      fullExtendAngle: 155,
      hysteresis: 8,
      holdMs: 180,
    });

    function armFixture(fixture, arm) {
      return {
        ...fixture,
        configAtCapture: {
          ...DEFAULT_CONFIG,
          ...(fixture.configAtCapture || {}),
          thresholds: {
            ...DEFAULT_CONFIG.thresholds,
            ...(fixture.configAtCapture?.thresholds || {}),
          },
          angleJoints: [...ARM_JOINTS[arm]],
        },
      };
    }

    function angleStatistics(trace) {
      const values = trace.trace
        .filter((frame) => frame.valid && Number.isFinite(frame.processedAngle))
        .map((frame) => frame.processedAngle);
      if (!values.length) {
        return { minimum: null, maximum: null, rom: null };
      }
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      return { minimum, maximum, rom: maximum - minimum };
    }

    function analyzeArm(fixture, arm, enhancedConfig) {
      const scoped = armFixture(fixture, arm);
      const production = replay.replayFixture(scoped);
      const trace = poseTrace.generateFullTrace(scoped);
      const exploratory = enhancedFsm.runFullContractionFsm(
        trace,
        enhancedConfig
      );
      const scores = (scoped.frames || []).flatMap((frame) =>
        ARM_JOINTS[arm]
          .map((index) => frame.keypoints?.[index]?.score)
          .filter(Number.isFinite)
      );
      return {
        arm,
        angleJoints: [...ARM_JOINTS[arm]],
        validJointRate: production.validJointRate,
        minimumRequiredJointConfidence: scores.length
          ? Math.min(...scores)
          : null,
        meanRequiredJointConfidence: scores.length
          ? scores.reduce((sum, value) => sum + value, 0) / scores.length
          : null,
        angle: angleStatistics(trace),
        production: {
          predictedReps: production.predictedReps,
          events: production.events,
        },
        exploratory: {
          predictedReps: exploratory.predictedReps,
          events: exploratory.events,
        },
        trace,
      };
    }

    function selectMovingArm(arms) {
      const eligible = arms.filter(
        (item) =>
          item.validJointRate >= 0.6 &&
          Number.isFinite(item.angle.rom) &&
          item.angle.rom >= 60
      );
      if (!eligible.length) {
        return {
          selectedArm: null,
          classification: "insufficient_pose_quality",
          reason: "No arm has both validJointRate >= 0.6 and ROM >= 60deg.",
        };
      }
      if (
        eligible.length === 2 &&
        eligible.every(
          (item) =>
            item.production.predictedReps > 0 ||
            item.exploratory.predictedReps > 0
        )
      ) {
        return {
          selectedArm: null,
          classification: "alternating_requires_dual_fsm",
          reason: "Both arms contain countable repetitive motion.",
        };
      }
      const ranked = [...eligible].sort((a, b) => {
        const aReps = Math.max(
          a.production.predictedReps,
          a.exploratory.predictedReps
        );
        const bReps = Math.max(
          b.production.predictedReps,
          b.exploratory.predictedReps
        );
        return bReps - aReps || b.angle.rom - a.angle.rom;
      });
      return {
        selectedArm: ranked[0].arm,
        classification: "single_moving_arm",
        reason:
          "Selected by pose quality, countable motion, then elbow-angle ROM.",
      };
    }

    function analyzeExternalFixture(
      fixture,
      enhancedConfig = DEFAULT_ENHANCED_CONFIG
    ) {
      const arms = ["left", "right"].map((arm) =>
        analyzeArm(fixture, arm, enhancedConfig)
      );
      return {
        analysisVersion: "1.0",
        provenance: "external_video_diagnostic",
        model: fixture.model,
        source: fixture.source,
        sampling: fixture.sampling,
        enhancedConfiguration: { ...enhancedConfig },
        selection: selectMovingArm(arms),
        arms,
      };
    }

    return {
      ARM_JOINTS,
      DEFAULT_CONFIG,
      DEFAULT_ENHANCED_CONFIG,
      analyzeArm,
      analyzeExternalFixture,
      armFixture,
      selectMovingArm,
    };
  }
);
