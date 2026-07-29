const fs = require("node:fs");
const path = require("node:path");
const {
  alignCyclesToBrowserLabels,
  generateFullTrace,
} = require("../../web/js/pose-trace.js");
const {
  runFullContractionFsm,
} = require("../../web/js/pose-enhanced-fsm.js");

const canonicalDirectory = path.join(
  __dirname,
  "..",
  "fixtures",
  "canonical"
);

function fixture(filename) {
  return JSON.parse(
    fs.readFileSync(path.join(canonicalDirectory, filename), "utf8")
  );
}

describe("rep-event analysis", () => {
  it("단조 정렬로 13 cycle 중 브라우저 라벨 10개를 중복 없이 연결한다", () => {
    const cycles = Array.from({ length: 13 }, (_, index) => ({
      repCountedAtMs: index * 1000,
    }));
    const labels = Array.from({ length: 10 }, (_, index) => index * 1000);
    const alignment = alignCyclesToBrowserLabels(cycles, labels);

    expect(alignment.filter((item) => item.matched)).toHaveLength(10);
    expect(
      new Set(
        alignment
          .filter((item) => item.matched)
          .map((item) => item.labelIndex)
      ).size
    ).toBe(10);
  });

  it("실제 정상과 경계 cycle을 분리하고 개선 FSM을 재실행한다", () => {
    const normal = generateFullTrace(
      fixture("curl-normal-01.derived.json")
    );
    const boundary = generateFullTrace(
      fixture("curl-boundary-contraction-01.derived.json")
    );
    const matchedNormalMin = normal.cycles
      .filter((cycle) => cycle.browserLabelAlignment.matched)
      .map((cycle) => cycle.processedMinAngle);
    const boundaryMin = boundary.cycles.map(
      (cycle) => cycle.processedMinAngle
    );
    const normalUpper = Math.max(...matchedNormalMin);
    const boundaryLower = Math.min(...boundaryMin);
    const candidate = (normalUpper + boundaryLower) / 2;
    const configuration = {
      contractStartAngle: 60,
      fullContractAngle: candidate,
      fullExtendAngle: 155,
      hysteresis: 8,
      holdMs: 180,
    };

    expect(normal.cycles).toHaveLength(13);
    expect(
      normal.cycles.filter(
        (cycle) => !cycle.browserLabelAlignment.matched
      )
    ).toHaveLength(3);
    expect(boundary.cycles).toHaveLength(3);
    expect(normalUpper).toBeLessThan(boundaryLower);
    expect(runFullContractionFsm(normal, configuration).predictedReps).toBe(
      13
    );
    expect(
      runFullContractionFsm(boundary, configuration).predictedReps
    ).toBe(0);
  });
});
