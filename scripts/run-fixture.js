const fs = require("node:fs");
const path = require("node:path");
const { replayFixture } = require("../web/js/pose-replay.js");
const { validateFixture } = require("../web/js/pose-fixture.js");

function run(filePath) {
  const absolutePath = path.resolve(filePath);
  const fixture = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const schema = validateFixture(fixture);
  if (!schema.valid) {
    throw new Error(`Invalid fixture:\n${schema.errors.join("\n")}`);
  }
  const result = replayFixture(fixture);
  return {
    file: absolutePath,
    ...result,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose");
  const files = args.filter((argument) => argument !== "--verbose");
  if (files.length === 0) {
    console.error("Usage: node scripts/run-fixture.js <fixture.json> [...]");
    process.exitCode = 1;
  } else {
    for (const file of files) {
      const result = run(file);
      const output = verbose
        ? result
        : {
            file: result.file,
            testId: result.testId,
            expectedCompleteReps: result.expectedCompleteReps,
            predictedReps: result.predictedReps,
            absoluteRepError: result.absoluteRepError,
            deterministicReplay: result.deterministicReplay,
            warnings: result.warnings,
            validFrames: result.validFrames,
            invalidFrames: result.invalidFrames,
            validJointRate: result.validJointRate,
            invalidReasons: result.invalidReasons,
            angleRange: result.angleRange,
            stateResets: result.events.filter(
              (event) => event.type === "STATE_RESET"
            ).length,
          };
      console.log(JSON.stringify(output, null, 2));
    }
  }
}

module.exports = { run };
