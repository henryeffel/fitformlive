const {
  CONFIGURATIONS,
  validateFrame,
} = require("../../web/js/pose-ablation.js");

describe("ablation configuration", () => {
  it("한 단계마다 기능 하나만 추가한다", () => {
    expect(CONFIGURATIONS).toHaveLength(6);
    for (let index = 1; index < CONFIGURATIONS.length; index += 1) {
      const previous = CONFIGURATIONS[index - 1].features;
      const current = CONFIGURATIONS[index].features;
      const changed = Object.keys(current).filter(
        (key) => current[key] !== previous[key]
      );
      expect(changed).toHaveLength(1);
      expect(previous[changed[0]]).toBe(false);
      expect(current[changed[0]]).toBe(true);
    }
  });

  it("baseline은 유한 좌표를 사용하되 confidence를 무시한다", () => {
    const keypoints = Array.from({ length: 17 }, (_, index) => ({
      name: `keypoint-${index}`,
      x: 0.5,
      y: 0.5,
      score: 0.1,
    }));
    expect(validateFrame(keypoints, [6, 8, 10], 0.4, false).valid).toBe(
      true
    );
    expect(validateFrame(keypoints, [6, 8, 10], 0.4, true)).toMatchObject({
      valid: false,
      reason: "low_confidence",
    });
  });
});
