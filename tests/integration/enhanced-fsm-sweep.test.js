const path = require("node:path");
const {
  runSweep,
} = require("../../scripts/run-enhanced-fsm-sweep.js");

const canonicalDirectory = path.join(
  __dirname,
  "..",
  "fixtures",
  "canonical"
);

describe("enhanced FSM parameter sweep", () => {
  it("같은 configuration 목록을 결정론적으로 실행한다", () => {
    const configurations = [
      {
        configurationId: "fc-35__hold-100",
        contractStartAngle: 60,
        fullContractAngle: 35,
        fullExtendAngle: 155,
        hysteresis: 8,
        holdMs: 100,
      },
      {
        configurationId: "fc-45__hold-200",
        contractStartAngle: 60,
        fullContractAngle: 45,
        fullExtendAngle: 155,
        hysteresis: 8,
        holdMs: 200,
      },
    ];

    const first = runSweep(canonicalDirectory, configurations);
    const second = runSweep(canonicalDirectory, configurations);

    expect(second).toEqual(first);
    expect(first).toHaveLength(2);
    expect(first[0]).toHaveProperty("normalPredictedReps");
    expect(first[0]).toHaveProperty("boundaryPredictedReps");
    expect(first[0]).toHaveProperty("trackingFailurePredictedReps");
  });
});

