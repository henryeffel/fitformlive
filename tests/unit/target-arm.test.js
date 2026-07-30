const {
  angleJointsForArm,
  exerciseKeyForArm,
  normalizeTargetArm,
  targetArmFromExercise,
} = require("../../web/js/target-arm.js");

describe("target arm contract", () => {
  it("maps anatomical arms to MoveNet shoulder/elbow/wrist indices", () => {
    expect(angleJointsForArm("left")).toEqual([5, 7, 9]);
    expect(angleJointsForArm("right")).toEqual([6, 8, 10]);
  });

  it("keeps right as the backwards-compatible default", () => {
    expect(normalizeTargetArm(undefined)).toBe("right");
    expect(exerciseKeyForArm(undefined)).toBe("right_curl");
  });

  it("maps curl exercise keys back to their target arm", () => {
    expect(targetArmFromExercise("left_curl")).toBe("left");
    expect(targetArmFromExercise("right_curl")).toBe("right");
    expect(targetArmFromExercise("squat")).toBeNull();
  });
});
