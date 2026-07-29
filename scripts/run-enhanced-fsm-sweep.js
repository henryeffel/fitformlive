const fs = require("node:fs");
const path = require("node:path");
const { generateFullTrace } = require("../web/js/pose-trace.js");
const {
  runFullContractionFsm,
} = require("../web/js/pose-enhanced-fsm.js");

const FIXTURES = Object.freeze([
  {
    name: "normal",
    filename: "curl-normal-01.derived.json",
  },
  {
    name: "boundary",
    filename: "curl-boundary-contraction-01.derived.json",
  },
  {
    name: "trackingFailure",
    filename: "curl-tracking-failure-01.derived.json",
  },
]);

function eventCount(result, type) {
  return result.events.filter((event) => event.type === type).length;
}

function loadAnalyses(canonicalDirectory) {
  return Object.fromEntries(
    FIXTURES.map(({ name, filename }) => {
      const fixture = JSON.parse(
        fs.readFileSync(path.join(canonicalDirectory, filename), "utf8")
      );
      return [name, generateFullTrace(fixture)];
    })
  );
}

function evaluateConfiguration(analyses, configuration) {
  const results = Object.fromEntries(
    Object.entries(analyses).map(([name, analysis]) => [
      name,
      runFullContractionFsm(analysis, configuration),
    ])
  );
  return {
    configurationId: configuration.configurationId,
    fullContractAngle: configuration.fullContractAngle,
    holdMs: configuration.holdMs,
    hysteresis: configuration.hysteresis,
    contractStartAngle: configuration.contractStartAngle,
    fullExtendAngle: configuration.fullExtendAngle,
    normalPredictedReps: results.normal.predictedReps,
    boundaryPredictedReps: results.boundary.predictedReps,
    trackingFailurePredictedReps:
      results.trackingFailure.predictedReps,
    normalIncompleteRejections: eventCount(
      results.normal,
      "INCOMPLETE_CONTRACTION_REJECTED"
    ),
    boundaryIncompleteRejections: eventCount(
      results.boundary,
      "INCOMPLETE_CONTRACTION_REJECTED"
    ),
    trackingFailureIncompleteRejections: eventCount(
      results.trackingFailure,
      "INCOMPLETE_CONTRACTION_REJECTED"
    ),
    normalResetCount: eventCount(results.normal, "STATE_RESET"),
    boundaryResetCount: eventCount(results.boundary, "STATE_RESET"),
    trackingFailureResetCount: eventCount(
      results.trackingFailure,
      "STATE_RESET"
    ),
  };
}

function runSweep(canonicalDirectory, configurations) {
  const analyses = loadAnalyses(canonicalDirectory);
  return configurations.map((configuration) =>
    evaluateConfiguration(analyses, configuration)
  );
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    values[argv[index]] = argv[index + 1];
  }
  if (!values["--fixtures"] || !values["--configs"] || !values["--output"]) {
    throw new Error(
      "Usage: node scripts/run-enhanced-fsm-sweep.js " +
        "--fixtures <canonical-dir> --configs <configs.json> --output <results.json>"
    );
  }
  return values;
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  const configurations = JSON.parse(
    fs.readFileSync(args["--configs"], "utf8")
  );
  if (!Array.isArray(configurations) || configurations.length === 0) {
    throw new Error("configs JSON must contain a non-empty array");
  }
  const results = runSweep(args["--fixtures"], configurations);
  fs.writeFileSync(
    args["--output"],
    `${JSON.stringify(
      {
        sweepVersion: "1.0",
        sourceOfTruth: "web/js/pose-enhanced-fsm.js",
        fixtureCount: FIXTURES.length,
        configurationCount: configurations.length,
        results,
      },
      null,
      2
    )}\n`
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  evaluateConfiguration,
  loadAnalyses,
  runSweep,
};

