const {
  REP_PHASE,
  advanceRepState,
  angleBetween,
  calculateAngularVelocity,
  createRepState,
} = require("../../web/js/pose-algorithms.js");

const REP_CONFIG = {
  up: 155,
  down: 60,
  hysteresis: 8,
  holdMs: 180,
};

describe("angleBetween", () => {
  test("직각 관절을 90도로 계산한다", () => {
    expect(angleBetween([1, 0], [0, 0], [0, 1])).toBeCloseTo(90);
  });

  test("길이가 0인 벡터는 계산하지 않는다", () => {
    expect(angleBetween([0, 0], [0, 0], [0, 1])).toBeNull();
  });
});

describe("calculateAngularVelocity", () => {
  const config = {
    minIntervalMs: 8,
    maxGapMs: 250,
    maxVelocityDegPerSec: 1000,
  };

  test("정상 범위의 각속도를 계산한다", () => {
    expect(
      calculateAngularVelocity({
        previousAngle: 150,
        currentAngle: 100,
        elapsedMs: 100,
        ...config,
      })
    ).toEqual({ velocity: -500, rejected: false, reason: null });
  });

  test.each([
    [4, "interval_too_short"],
    [300, "interval_too_long"],
  ])("비정상 시간 간격 %dms를 제외한다", (elapsedMs, reason) => {
    const result = calculateAngularVelocity({
      previousAngle: 150,
      currentAngle: 140,
      elapsedMs,
      ...config,
    });
    expect(result).toMatchObject({ velocity: 0, rejected: true, reason });
  });

  test("최대 각속도를 넘는 좌표 점프를 제외한다", () => {
    const result = calculateAngularVelocity({
      previousAngle: 150,
      currentAngle: 50,
      elapsedMs: 50,
      ...config,
    });
    expect(result).toEqual({
      velocity: 0,
      rejected: true,
      reason: "velocity_outlier",
    });
  });
});

describe("advanceRepState", () => {
  test("하단과 상단 유지시간을 충족한 완전 동작만 1회로 센다", () => {
    let state = createRepState();
    const frames = [
      [50, 0],
      [50, 200],
      [80, 216],
      [160, 232],
      [160, 432],
    ];

    let counted = 0;
    for (const [angle, time] of frames) {
      const result = advanceRepState(state, angle, time, REP_CONFIG);
      state = result.state;
      if (result.repCounted) counted += 1;
    }

    expect(counted).toBe(1);
    expect(state.reps).toBe(1);
    expect(state.phase).toBe(REP_PHASE.READY);
  });

  test("하단에 도달하지 않은 불완전 동작은 세지 않는다", () => {
    let state = createRepState();
    for (const [angle, time] of [
      [160, 0],
      [90, 200],
      [75, 400],
      [160, 600],
    ]) {
      state = advanceRepState(state, angle, time, REP_CONFIG).state;
    }
    expect(state.reps).toBe(0);
  });

  test("임계값을 순간 통과한 노이즈는 유지시간 검사에서 제거한다", () => {
    let state = createRepState();
    for (const [angle, time] of [
      [55, 0],
      [70, 80],
      [55, 120],
      [70, 220],
      [160, 500],
    ]) {
      state = advanceRepState(state, angle, time, REP_CONFIG).state;
    }
    expect(state.reps).toBe(0);
    expect(state.phase).toBe(REP_PHASE.READY);
  });
});
