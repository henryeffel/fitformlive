const { replayFixture } = require("../../web/js/pose-replay.js");
const { angleJointsForArm } = require("../../web/js/target-arm.js");

function keypointsForAngle(arm, angle) {
  const points = Array.from({ length: 17 }, (_, index) => ({
    name: `keypoint-${index}`,
    x: 0.2,
    y: 0.2,
    score: 0.95,
  }));
  const [shoulder, elbow, wrist] = angleJointsForArm(arm);
  const radians = (angle * Math.PI) / 180;
  points[elbow] = { ...points[elbow], x: 0.5, y: 0.5 };
  points[shoulder] = { ...points[shoulder], x: 0.6, y: 0.5 };
  points[wrist] = {
    ...points[wrist],
    x: 0.5 + 0.1 * Math.cos(radians),
    y: 0.5 + 0.1 * Math.sin(radians),
  };
  return points;
}

function fixtureForArm(arm) {
  const samples = [
    [0, 160],
    [200, 160],
    [400, 160],
    [600, 50],
    [800, 50],
    [1000, 50],
    [1200, 160],
    [1400, 160],
    [1600, 160],
  ];
  return {
    testId: `synthetic-${arm}-curl`,
    targetArm: arm,
    configAtCapture: {
      angleJoints: angleJointsForArm(arm),
      minJointConfidence: 0.4,
      emaAlpha: 1,
      transitionHoldMs: 180,
      thresholdHysteresis: 8,
      thresholds: { up: 155, down: 60 },
    },
    frames: samples.map(([timestampMs, angle]) => ({
      timestampMs,
      keypoints: keypointsForAngle(arm, angle),
    })),
  };
}

describe("target-arm replay symmetry", () => {
  it("applies identical FSM transitions to left and right arms", () => {
    const left = replayFixture(fixtureForArm("left"));
    const right = replayFixture(fixtureForArm("right"));

    expect(left.predictedReps).toBe(1);
    expect(right.predictedReps).toBe(1);
    expect(left.angleRange.min).toBeCloseTo(right.angleRange.min, 8);
    expect(left.angleRange.max).toBeCloseTo(right.angleRange.max, 8);
  });
});
