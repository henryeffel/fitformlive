const fs = require("node:fs");
const path = require("node:path");
const { CONFIGURATIONS, runAblation } = require("../web/js/pose-ablation.js");
const { replayCapturedProcessing } = require("../web/js/pose-replay.js");
const { runFullContractionFsm } = require("../web/js/pose-enhanced-fsm.js");

const ROLE_BY_CONDITION = Object.freeze({
  normal: "normal_regression",
  fast_motion: "speed_robustness",
  partial_range: "threshold_sensitivity",
  occlusion: "failure_safety",
});

const DEFAULT_ENHANCED_CONFIG = Object.freeze({
  contractStartAngle: 60,
  fullContractAngle: 36.35789058153856,
  fullExtendAngle: 155,
  hysteresis: 8,
  holdMs: 180,
});

function parseSession(text, filename = "session.json") {
  try {
    return { session: JSON.parse(text), repairs: [] };
  } catch (originalError) {
    // Early browser captures could contain a mojibake note with an unescaped quote.
    // Repair only the optional notes line in memory; never alter the source capture.
    const repaired = text.replace(
      /^\s*"notes"\s*:\s*.*,\r?$/m,
      '  "notes": null,'
    );
    if (repaired === text) throw originalError;
    try {
      return {
        session: JSON.parse(repaired),
        repairs: ["optional_notes_replaced_after_json_parse_failure"],
      };
    } catch {
      throw new Error(`${filename}: ${originalError.message}`);
    }
  }
}

function eventTimes(events, type) {
  return events
    .filter((event) => event.type === type)
    .map((event) => Math.round(event.timestampMs));
}

function recordedRepCount(session) {
  const events = Array.isArray(session.events) ? session.events : [];
  const countEvents = events.filter((event) => event.type === "REP_COUNTED");
  if (countEvents.length) return countEvents.length;
  return Math.max(0, ...((session.frames || []).map((frame) => frame.repCount || 0)));
}

function errorMetrics(predicted, expected) {
  if (!Number.isInteger(expected)) {
    return { absoluteRepError: null, overCount: null, underCount: null };
  }
  return {
    absoluteRepError: Math.abs(predicted - expected),
    overCount: Math.max(0, predicted - expected),
    underCount: Math.max(0, expected - predicted),
  };
}

function capturedTrace(session) {
  const resets = (session.events || [])
    .filter((event) => event.type === "STATE_RESET")
    .map((event) => event.timestampMs);
  return {
    traceVersion: "captured-processed-angle-1.0",
    trace: (session.frames || []).map((frame) => ({
      timestampMs: frame.timestampMs,
      valid: frame.valid === true,
      processedAngle: frame.processedAngle,
      events: resets.some(
        (timestamp) => Math.abs(timestamp - frame.timestampMs) < 0.01
      )
        ? ["STATE_RESET"]
        : [],
    })),
  };
}

function evaluateSession(session, sourceFile, config = DEFAULT_ENHANCED_CONFIG) {
  if (session.schemaVersion !== "1.2") {
    throw new Error(`${sourceFile}: expected schemaVersion 1.2`);
  }
  const role = ROLE_BY_CONDITION[session.condition] || "unclassified";
  const fixture = { ...session, role };
  const full = CONFIGURATIONS.find((item) => item.id === "F_FULL");
  const production = runAblation(fixture, full);
  const captureParity = replayCapturedProcessing(fixture);
  const enhanced = runFullContractionFsm(capturedTrace(session), config);
  const expected = session.groundTruth?.completeReps ?? null;
  const recorded = recordedRepCount(session);
  const recordedEvents = Array.isArray(session.events) ? session.events : [];

  return {
    testId: session.testId,
    condition: session.condition,
    role,
    sourceFile,
    groundTruth: {
      provenance: "capture_operator_entered",
      attemptedReps: session.groundTruth?.attemptedReps ?? null,
      completeReps: expected,
    },
    recordedProduction: {
      predictedReps: recorded,
      ...errorMetrics(recorded, expected),
    },
    captureParityReplay: captureParity,
    diagnosticProductionReplay: {
      status: "diagnostic_recompute_not_capture_parity_authority",
      predictedReps: production.metrics.predictedReps,
      ...errorMetrics(production.metrics.predictedReps, expected),
      validJointRate: production.metrics.validJointRate,
      invalidResets: production.metrics.invalidResets,
      countsDuringTrackingFailure:
        production.metrics.countsDuringTrackingFailure,
      repTimestampsMs: eventTimes(production.events, "REP_COUNTED"),
    },
    exploratoryFullContraction: {
      status: "exploratory_not_production",
      angleSource: "captured_frame_processedAngle",
      predictedReps: enhanced.predictedReps,
      ...errorMetrics(enhanced.predictedReps, expected),
      invalidResets: eventTimes(enhanced.events, "STATE_RESET").length,
      incompleteContractionRejections: eventTimes(
        enhanced.events,
        "INCOMPLETE_CONTRACTION_REJECTED"
      ).length,
      repTimestampsMs: eventTimes(enhanced.events, "REP_COUNTED"),
      rejectedTimestampsMs: eventTimes(
        enhanced.events,
        "INCOMPLETE_CONTRACTION_REJECTED"
      ),
    },
    replayParity: {
      matchesRecorded: captureParity.parity.matchesRecorded,
      delta: captureParity.parity.delta,
    },
    reviewCandidate: {
      labelStatus: "machine_generated_review_candidate",
      warning: "Not human-reviewed ground truth.",
      productionRepTimestampsMs: eventTimes(recordedEvents, "REP_COUNTED"),
      exploratoryRepTimestampsMs: eventTimes(enhanced.events, "REP_COUNTED"),
      exploratoryRejectedTimestampsMs: eventTimes(
        enhanced.events,
        "INCOMPLETE_CONTRACTION_REJECTED"
      ),
      trackingInterruptions: session.eventViews?.interruptions || [],
    },
  };
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(results) {
  const columns = [
    "testId", "condition", "completeReps", "recordedProduction",
    "captureParityReplay", "exploratoryFullContraction", "captureParityDelta",
    "exploratoryAbsoluteError", "diagnosticValidJointRate", "replayParity",
    "sourceRepairs",
  ];
  const rows = results.map((item) => [
    item.testId,
    item.condition,
    item.groundTruth.completeReps,
    item.recordedProduction.predictedReps,
    item.captureParityReplay.predictedReps,
    item.exploratoryFullContraction.predictedReps,
    item.captureParityReplay.parity.delta,
    item.exploratoryFullContraction.absoluteRepError,
    item.diagnosticProductionReplay.validJointRate,
    item.replayParity.matchesRecorded,
    item.sourceRepairs.join("|"),
  ]);
  return [columns, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n") + "\n";
}

function compareDirectory(inputDirectory, config = DEFAULT_ENHANCED_CONFIG) {
  return fs.readdirSync(inputDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .flatMap((name) => {
      const filename = path.join(inputDirectory, name);
      let parsed;
      try {
        parsed = parseSession(fs.readFileSync(filename, "utf8"), filename);
        if (parsed.session.schemaVersion !== "1.2") return [];
        const result = evaluateSession(parsed.session, name, config);
        result.sourceRepairs = parsed.repairs;
        return [result];
      } catch (error) {
        return [{
          testId: path.basename(name, ".json"),
          sourceFile: name,
          error: error.message,
          sourceRepairs: [],
        }];
      }
    });
}

function main() {
  const inputDirectory = process.argv[2] || "data/recordings/raw";
  const outputDirectory =
    process.argv[3] || "evaluation/python-validation/video-session-comparison";
  const results = compareDirectory(inputDirectory);
  const successful = results.filter((item) => !item.error);
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "comparison-summary.json"),
    `${JSON.stringify({
      comparisonVersion: "1.0",
      generatedAt: new Date().toISOString(),
      inputDirectory,
      groundTruthPolicy:
        "Capture-operator values are retained; generated timestamps are review candidates only.",
      exploratoryConfiguration: DEFAULT_ENHANCED_CONFIG,
      sessions: results,
    }, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, "comparison.csv"), toCsv(successful));
  for (const result of successful) {
    fs.writeFileSync(
      path.join(outputDirectory, `${result.testId}.review-candidate.json`),
      `${JSON.stringify({
        testId: result.testId,
        sourceFile: result.sourceFile,
        ...result.reviewCandidate,
      }, null, 2)}\n`
    );
  }
  console.log(`Compared ${successful.length} session(s); ${results.length - successful.length} error(s).`);
}

if (require.main === module) main();

module.exports = {
  DEFAULT_ENHANCED_CONFIG,
  evaluateSession,
  parseSession,
  recordedRepCount,
  toCsv,
};
