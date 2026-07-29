const fs = require("node:fs");
const path = require("node:path");
const { validateFixture } = require("../../web/js/pose-fixture.js");
const { replayFixture } = require("../../web/js/pose-replay.js");

const fixtures = [
  ["curl-normal-01.schema-1.0.json", 10],
  ["curl-partial-01.schema-1.0.json", 0],
  ["curl-occlusion-01.schema-1.0.json", 0],
];

describe("실제 카메라 pose fixture", () => {
  test.each(fixtures)(
    "%s 구조와 브라우저 카운트 이벤트를 검증한다",
    (filename, browserPredictedReps) => {
      const fixture = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, "..", "fixtures", "raw", filename),
          "utf8"
        )
      );
      const validation = validateFixture(fixture);
      const countedEvents = fixture.events.filter(
        (event) => event.type === "REP_COUNTED"
      );
      const replay = replayFixture(fixture);

      expect(validation).toEqual({ valid: true, errors: [] });
      expect(fixture.frames.length).toBeGreaterThan(0);
      expect(countedEvents).toHaveLength(browserPredictedReps);
      expect(replay.deterministicReplay).toBe(false);
      expect(replay.warnings).toHaveLength(1);
    }
  );
});
