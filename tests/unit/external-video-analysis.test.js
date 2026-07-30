const {
  selectMovingArm,
} = require("../../web/js/external-video-analysis.js");

function arm(name, validJointRate, rom, production, exploratory = production) {
  return {
    arm: name,
    validJointRate,
    angle: { rom },
    production: { predictedReps: production },
    exploratory: { predictedReps: exploratory },
  };
}

describe("external video moving-arm selection", () => {
  it("selects the only arm with countable motion", () => {
    const result = selectMovingArm([
      arm("left", 0.95, 140, 6),
      arm("right", 0.9, 25, 0),
    ]);
    expect(result.selectedArm).toBe("left");
    expect(result.classification).toBe("single_moving_arm");
  });

  it("flags alternating motion instead of hiding a second moving arm", () => {
    const result = selectMovingArm([
      arm("left", 0.95, 130, 4),
      arm("right", 0.92, 125, 4),
    ]);
    expect(result.selectedArm).toBeNull();
    expect(result.classification).toBe(
      "alternating_requires_dual_fsm"
    );
  });

  it("rejects insufficient pose quality", () => {
    const result = selectMovingArm([
      arm("left", 0.4, 150, 5),
      arm("right", 0.9, 30, 0),
    ]);
    expect(result.classification).toBe("insufficient_pose_quality");
  });
});
