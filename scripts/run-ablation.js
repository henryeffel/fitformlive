const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  CONFIGURATIONS,
  runAblation,
} = require("../web/js/pose-ablation.js");
const { validateFixture } = require("../web/js/pose-fixture.js");

const EXPERIMENT_VERSION = "1.0";
const FIXTURES = Object.freeze([
  "curl-normal-01.derived.json",
  "curl-boundary-contraction-01.derived.json",
  "curl-tracking-failure-01.derived.json",
]);

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function resultHash(result) {
  return crypto
    .createHash("sha256")
    .update(stableJson(result))
    .digest("hex");
}

function runExperiment(fixture, fixturePath, configuration) {
  const first = runAblation(fixture, configuration);
  const second = runAblation(fixture, configuration);
  const run1Hash = resultHash(first);
  const run2Hash = resultHash(second);
  return {
    experimentVersion: EXPERIMENT_VERSION,
    fixturePath,
    ...first,
    determinism: {
      run1Hash,
      run2Hash,
      equal: run1Hash === run2Hash,
    },
  };
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function generate(rootDirectory, outputDirectory) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const results = [];
  for (const filename of FIXTURES) {
    const fixturePath = path.join(rootDirectory, filename);
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    const validation = validateFixture(fixture);
    if (!validation.valid) {
      throw new Error(`${filename}: ${validation.errors.join(", ")}`);
    }
    for (const configuration of CONFIGURATIONS) {
      const result = runExperiment(
        fixture,
        path.posix.join("tests/fixtures/canonical", filename),
        configuration
      );
      if (!result.determinism.equal) {
        throw new Error(
          `${fixture.testId} × ${configuration.id} is not deterministic`
        );
      }
      const outputName = `${fixture.testId}--${configuration.id}.json`;
      fs.writeFileSync(
        path.join(outputDirectory, outputName),
        `${JSON.stringify(result, null, 2)}\n`
      );
      results.push(result);
    }
  }

  const summary = {
    experimentVersion: EXPERIMENT_VERSION,
    design: "cumulative_single-feature-addition",
    interpretationLimit:
      "Results are marginal effects within a cumulative pipeline, not independent factorial effects.",
    fixtureCount: FIXTURES.length,
    configurationCount: CONFIGURATIONS.length,
    resultCount: results.length,
    allDeterministic: results.every(
      (result) => result.determinism.equal
    ),
    configurations: CONFIGURATIONS,
    results: results.map((result) => ({
      fixture: result.fixture,
      configuration: result.configuration,
      metrics: result.metrics,
      interpretation: result.interpretation,
      determinism: result.determinism,
    })),
  };
  fs.writeFileSync(
    path.join(outputDirectory, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`
  );

  const rows = summary.results.map((result) => ({
    fixture: result.fixture.testId,
    role: result.fixture.role,
    configuration: result.configuration.id,
    ground_truth: result.metrics.groundTruth,
    predicted_reps: result.metrics.predictedReps,
    absolute_rep_error: result.metrics.absoluteRepError,
    over_count: result.metrics.overCount,
    under_count: result.metrics.underCount,
    valid_frames: result.metrics.validFrames,
    invalid_frames: result.metrics.invalidFrames,
    valid_joint_rate: result.metrics.validJointRate,
    state_transitions: result.metrics.stateTransitions,
    contraction_candidates: result.metrics.contractionCandidates,
    confirmed_contractions: result.metrics.confirmedContractions,
    rep_count_events: result.metrics.repCountEvents,
    invalid_resets: result.metrics.invalidResets,
    tracking_recoveries: result.metrics.trackingRecoveries,
    counts_during_tracking_failure:
      result.metrics.countsDuringTrackingFailure,
    possible_duplicate_counts:
      result.interpretation.possibleDuplicateCounts,
    partial_motion_false_positives:
      result.interpretation.partialMotionFalsePositives,
    tracking_failure_false_counts:
      result.interpretation.trackingFailureFalseCounts,
    reset_observed: result.interpretation.resetObserved,
    deterministic: result.determinism.equal,
    result_hash: result.determinism.run1Hash,
  }));
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((header) => csvEscape(row[header])).join(",")
    ),
  ].join("\n");
  fs.writeFileSync(
    path.join(outputDirectory, "summary.csv"),
    `\uFEFF${csv}\n`
  );
  return summary;
}

if (require.main === module) {
  const canonicalDirectory = path.resolve(
    process.argv[2] || path.join("tests", "fixtures", "canonical")
  );
  const outputDirectory = path.resolve(
    process.argv[3] || path.join("evaluation", "ablation")
  );
  const summary = generate(canonicalDirectory, outputDirectory);
  console.log(
    `Generated ${summary.resultCount} deterministic ablation results in ${outputDirectory}.`
  );
}

module.exports = {
  EXPERIMENT_VERSION,
  FIXTURES,
  generate,
  resultHash,
  runExperiment,
  stableJson,
};
