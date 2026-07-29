const fs = require("node:fs");
const path = require("node:path");
const {
  advanceRepState,
  createRepState,
} = require("../../web/js/pose-algorithms.js");

test("고정된 팔 컬 각도 시퀀스를 항상 2회로 판정한다", () => {
  const fixturePath = path.join(
    __dirname,
    "..",
    "fixtures",
    "right-curl-two-reps.json"
  );
  const frames = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const config = {
    up: 155,
    down: 60,
    hysteresis: 8,
    holdMs: 180,
  };
  let state = createRepState();

  for (const frame of frames) {
    state = advanceRepState(
      state,
      frame.angle,
      frame.timeMs,
      config
    ).state;
  }

  expect(state.reps).toBe(2);
});
