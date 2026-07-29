const fs = require("node:fs");
const path = require("node:path");
const {
  generateFullTrace,
} = require("../web/js/pose-trace.js");
const {
  runFullContractionFsm,
} = require("../web/js/pose-enhanced-fsm.js");

const TARGETS = Object.freeze([
  "curl-normal-01.derived.json",
  "curl-boundary-contraction-01.derived.json",
]);

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join("|") : String(value);
  return /[",\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function cyclesCsv(cycles) {
  const rows = cycles.map((cycle) => ({
    cycle: cycle.cycle,
    rep: cycle.rep,
    contraction_confirmed_at_ms: cycle.contractionConfirmedAtMs,
    rep_counted_at_ms: cycle.repCountedAtMs,
    duration_ms: cycle.durationMs,
    raw_min_angle: cycle.rawMinAngle,
    raw_max_angle: cycle.rawMaxAngle,
    processed_min_angle: cycle.processedMinAngle,
    processed_max_angle: cycle.processedMaxAngle,
    observed_processed_rom: cycle.observedProcessedRom,
    contraction_hold_ms: cycle.contractionHoldMs,
    extension_hold_ms: cycle.extensionHoldMs,
    invalid_duration_ms: cycle.invalidDurationMs,
    max_consecutive_invalid_ms: cycle.maxConsecutiveInvalidMs,
    reset_count: cycle.resetCount,
    recovery_count: cycle.recoveryCount,
    gap_from_previous_rep_ms: cycle.gapFromPreviousRepMs,
    time_since_reset_at_start_ms: cycle.timeSinceResetAtStartMs,
    time_since_recovery_at_start_ms:
      cycle.timeSinceRecoveryAtStartMs,
    nearest_browser_rep_at_ms: cycle.nearestBrowserRep.timestampMs,
    nearest_browser_rep_distance_ms: cycle.nearestBrowserRep.distanceMs,
    diagnostic_flags: cycle.diagnosticFlags,
  }));
  const headers = Object.keys(rows[0]);
  return [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((header) => csvEscape(row[header])).join(",")
    ),
  ].join("\n");
}

function summarizeAnalysis(analyses) {
  const normal = analyses.find(
    (analysis) => analysis.fixture.role === "normal_regression"
  );
  const boundary = analyses.find(
    (analysis) => analysis.fixture.role === "threshold_sensitivity"
  );
  const matchedNormalMinAngles = normal.cycles
    .filter((cycle) => cycle.browserLabelAlignment.matched)
    .map((cycle) => cycle.processedMinAngle);
  const boundaryMinAngles = boundary.cycles.map(
    (cycle) => cycle.processedMinAngle
  );
  const normalUpperBound = Math.max(...matchedNormalMinAngles);
  const boundaryLowerBound = Math.min(...boundaryMinAngles);
  const separationExists = normalUpperBound < boundaryLowerBound;
  const fullContractAngleCandidate = separationExists
    ? (normalUpperBound + boundaryLowerBound) / 2
    : null;
  const enhancedConfiguration = {
    contractStartAngle: 60,
    fullContractAngle: fullContractAngleCandidate,
    fullExtendAngle: 155,
    hysteresis: 8,
    holdMs: 180,
  };
  const enhancedResults = separationExists
    ? analyses.map((analysis) => ({
        fixture: analysis.fixture,
        result: runFullContractionFsm(
          analysis,
          enhancedConfiguration
        ),
      }))
    : [];
  return {
    analysisVersion: "1.0",
    fullContractionThresholdAnalysis: {
      selectionBasis:
        "midpoint between maximum minimum-angle of browser-label-aligned normal cycles and minimum minimum-angle of boundary cycles",
      exploratoryOnly: true,
      normalAlignedCycleCount: matchedNormalMinAngles.length,
      normalMinimumAngles: matchedNormalMinAngles,
      boundaryMinimumAngles: boundaryMinAngles,
      normalUpperBound,
      boundaryLowerBound,
      separationExists,
      candidate: fullContractAngleCandidate,
    },
    enhancedConfiguration:
      separationExists ? enhancedConfiguration : null,
    enhancedResults,
    analyses: analyses.map((analysis) => ({
      fixture: analysis.fixture,
      configuration: analysis.configuration,
      repCount: analysis.cycles.length,
      cyclesWithNoNearbyBrowserLabel: analysis.cycles.filter((cycle) =>
        cycle.diagnosticFlags.includes("no_nearby_browser_rep_label")
      ).length,
      cyclesWithoutAlignedBrowserLabel: analysis.cycles.filter(
        (cycle) => !cycle.browserLabelAlignment.matched
      ).length,
      cyclesWithResetFlag: analysis.cycles.filter((cycle) =>
        cycle.diagnosticFlags.includes("possible_reset_induced_split")
      ).length,
      cyclesWithRecoveryFlag: analysis.cycles.filter((cycle) =>
        cycle.diagnosticFlags.includes("possible_recovery_induced_split")
      ).length,
      shortCycleFlags: analysis.cycles.filter((cycle) =>
        cycle.diagnosticFlags.includes("possible_short_cycle")
      ).length,
      processedMinAngles: analysis.cycles.map(
        (cycle) => cycle.processedMinAngle
      ),
      processedRom: analysis.cycles.map(
        (cycle) => cycle.observedProcessedRom
      ),
    })),
  };
}

function generate(canonicalDirectory, outputDirectory) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const analyses = TARGETS.map((filename) => {
    const fixture = JSON.parse(
      fs.readFileSync(path.join(canonicalDirectory, filename), "utf8")
    );
    const analysis = generateFullTrace(fixture);
    fs.writeFileSync(
      path.join(outputDirectory, `${fixture.testId}--F_FULL.trace.json`),
      `${JSON.stringify(analysis, null, 2)}\n`
    );
    fs.writeFileSync(
      path.join(outputDirectory, `${fixture.testId}--F_FULL.cycles.csv`),
      `\uFEFF${cyclesCsv(analysis.cycles)}\n`
    );
    return analysis;
  });
  const summary = summarizeAnalysis(analyses);
  fs.writeFileSync(
    path.join(outputDirectory, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`
  );
  return { analyses, summary };
}

if (require.main === module) {
  const canonicalDirectory = path.resolve(
    process.argv[2] || path.join("tests", "fixtures", "canonical")
  );
  const outputDirectory = path.resolve(
    process.argv[3] || path.join("evaluation", "rep-analysis")
  );
  const result = generate(canonicalDirectory, outputDirectory);
  console.log(
    `Generated ${result.analyses.length} traces and ${result.analyses.reduce(
      (sum, analysis) => sum + analysis.cycles.length,
      0
    )} rep cycles.`
  );
}

module.exports = {
  TARGETS,
  cyclesCsv,
  generate,
  summarizeAnalysis,
};
