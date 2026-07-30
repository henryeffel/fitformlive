(function attachTargetArm(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.FitFormTargetArm = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createApi() {
  const TARGET_ARMS = Object.freeze(["left", "right"]);
  const ARM_JOINTS = Object.freeze({
    left: Object.freeze([5, 7, 9]),
    right: Object.freeze([6, 8, 10]),
  });

  function normalizeTargetArm(value, fallback = "right") {
    if (TARGET_ARMS.includes(value)) return value;
    if (TARGET_ARMS.includes(fallback)) return fallback;
    throw new Error(`unsupported target arm: ${value}`);
  }

  function angleJointsForArm(value) {
    const arm = normalizeTargetArm(value);
    return [...ARM_JOINTS[arm]];
  }

  function exerciseKeyForArm(value) {
    return `${normalizeTargetArm(value)}_curl`;
  }

  function targetArmFromExercise(exerciseKey, fallback = null) {
    const match = /^(left|right)_curl$/.exec(String(exerciseKey || ""));
    return match ? match[1] : fallback;
  }

  return {
    TARGET_ARMS,
    ARM_JOINTS,
    normalizeTargetArm,
    angleJointsForArm,
    exerciseKeyForArm,
    targetArmFromExercise,
  };
});
