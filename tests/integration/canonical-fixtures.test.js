const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { replayFixture } = require("../../web/js/pose-replay.js");
const { validateFixture } = require("../../web/js/pose-fixture.js");
const {
  DEFINITIONS,
  canonicalize,
} = require("../../scripts/canonicalize-fixtures.js");

const fixtureRoot = path.join(__dirname, "..", "fixtures");
const canonicalDirectory = path.join(fixtureRoot, "canonical");
const filenames = [
  "curl-normal-01.derived.json",
  "curl-boundary-contraction-01.derived.json",
  "curl-tracking-failure-01.derived.json",
];

describe("canonical derived fixture", () => {
  test.each(filenames)(
    "%s provenance와 결정론적 replay를 검증한다",
    (filename) => {
      const fixture = JSON.parse(
        fs.readFileSync(path.join(canonicalDirectory, filename), "utf8")
      );
      const sourcePath = path.join(
        fixtureRoot,
        ...fixture.derivedFrom.path.split("/")
      );
      const sourceHash = crypto
        .createHash("sha256")
        .update(fs.readFileSync(sourcePath))
        .digest("hex");
      const definition = DEFINITIONS.find(
        (candidate) => candidate.output === filename
      );
      const regenerated = canonicalize(
        JSON.parse(fs.readFileSync(sourcePath, "utf8")),
        definition,
        {
          relativePath: fixture.derivedFrom.path,
          sha256: sourceHash,
        }
      );
      const first = replayFixture(fixture);
      const second = replayFixture(fixture);

      expect(validateFixture(fixture)).toEqual({
        valid: true,
        errors: [],
      });
      expect(sourceHash).toBe(fixture.derivedFrom.sha256);
      expect(fixture.derivedFrom.selectionUsesExpectedOrPredictedReps).toBe(
        false
      );
      expect(fixture.frames[0].timestampMs).toBeGreaterThanOrEqual(0);
      expect(first.deterministicReplay).toBe(true);
      expect(first.predictedReps).toBe(second.predictedReps);
      expect(first.events).toEqual(second.events);
      expect(regenerated).toEqual(fixture);
    }
  );
});
