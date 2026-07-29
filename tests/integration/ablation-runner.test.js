const fs = require("node:fs");
const path = require("node:path");
const {
  CONFIGURATIONS,
  runAblation,
} = require("../../web/js/pose-ablation.js");
const { replayFixture } = require("../../web/js/pose-replay.js");
const {
  resultHash,
  runExperiment,
} = require("../../scripts/run-ablation.js");

const canonicalDirectory = path.join(
  __dirname,
  "..",
  "fixtures",
  "canonical"
);
const filenames = [
  "curl-normal-01.derived.json",
  "curl-boundary-contraction-01.derived.json",
  "curl-tracking-failure-01.derived.json",
];

describe("ablation runner", () => {
  test.each(filenames)(
    "%s의 모든 구성이 결정론적으로 실행된다",
    (filename) => {
      const fixture = JSON.parse(
        fs.readFileSync(path.join(canonicalDirectory, filename), "utf8")
      );
      for (const configuration of CONFIGURATIONS) {
        const experiment = runExperiment(
          fixture,
          filename,
          configuration
        );
        expect(experiment.determinism.equal).toBe(true);
        expect(experiment.metrics.repCountEvents).toBe(
          experiment.metrics.predictedReps
        );
      }
    }
  );

  test.each(filenames)(
    "%s의 F_FULL은 기존 replay 결과와 일치한다",
    (filename) => {
      const fixture = JSON.parse(
        fs.readFileSync(path.join(canonicalDirectory, filename), "utf8")
      );
      const full = runAblation(
        fixture,
        CONFIGURATIONS.find(
          (configuration) => configuration.id === "F_FULL"
        )
      );
      const existing = replayFixture(fixture);

      expect(full.metrics.predictedReps).toBe(existing.predictedReps);
      expect(full.metrics.validFrames).toBe(existing.validFrames);
      expect(full.metrics.invalidFrames).toBe(existing.invalidFrames);
      expect(resultHash(full)).toBe(resultHash(runAblation(
        fixture,
        CONFIGURATIONS.at(-1)
      )));
    }
  );
});
