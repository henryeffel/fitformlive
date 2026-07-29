const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { angleBetween } = require("../web/js/pose-algorithms.js");
const {
  classifyTrackingEvents,
  validateFixture,
} = require("../web/js/pose-fixture.js");
const {
  validateRequiredKeypoints,
} = require("../web/js/pose-replay.js");

const TRANSFORM_VERSION = "1.0.0";
const RULES = Object.freeze({
  movementAngleDeltaDeg: 2,
  maxMovementGapMs: 250,
  paddingMs: 1000,
  jitterThresholdMs: 250,
});
const DEFINITIONS = Object.freeze([
  {
    input: "curl-normal-01.schema-1.0.json",
    output: "curl-normal-01.derived.json",
    testId: "curl-normal-01",
    condition: "normal",
    role: "normal_regression",
  },
  {
    input: "curl-partial-01.schema-1.0.json",
    output: "curl-boundary-contraction-01.derived.json",
    testId: "curl-boundary-contraction-01",
    condition: "boundary_contraction",
    role: "threshold_sensitivity",
  },
  {
    input: "curl-occlusion-01.schema-1.0.json",
    output: "curl-tracking-failure-01.derived.json",
    testId: "curl-tracking-failure-01",
    condition: "tracking_failure",
    role: "failure_safety",
  },
]);

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function frameAngle(frame, config) {
  const indices = config.angleJoints || [6, 8, 10];
  const validation = validateRequiredKeypoints(
    frame.keypoints,
    indices,
    config.minJointConfidence ?? 0.4
  );
  if (!validation.valid) return null;
  const [a, b, c] = indices.map((index) => frame.keypoints[index]);
  return angleBetween([a.x, a.y], [b.x, b.y], [c.x, c.y]);
}

function selectInterval(fixture, rules = RULES) {
  const samples = [];
  let previous = null;
  for (const frame of fixture.frames) {
    const angle = frameAngle(frame, fixture.configAtCapture || {});
    if (!Number.isFinite(angle)) {
      previous = null;
      continue;
    }
    if (
      previous &&
      frame.timestampMs - previous.timestampMs <= rules.maxMovementGapMs &&
      Math.abs(angle - previous.angle) >= rules.movementAngleDeltaDeg
    ) {
      samples.push(frame.timestampMs);
    }
    previous = { timestampMs: frame.timestampMs, angle };
  }
  if (samples.length === 0) {
    return {
      startTimestampMs: fixture.frames[0].timestampMs,
      endTimestampMs: fixture.frames.at(-1).timestampMs,
      movementSampleCount: 0,
      fallback: "full_capture_no_movement_sample",
    };
  }
  return {
    startTimestampMs: Math.max(
      fixture.frames[0].timestampMs,
      samples[0] - rules.paddingMs
    ),
    endTimestampMs: Math.min(
      fixture.frames.at(-1).timestampMs,
      samples.at(-1) + rules.paddingMs
    ),
    movementSampleCount: samples.length,
    fallback: null,
  };
}

function canonicalize(fixture, definition, sourceInfo, rules = RULES) {
  const interval = selectInterval(fixture, rules);
  const selectedFrames = fixture.frames.filter(
    (frame) =>
      frame.timestampMs >= interval.startTimestampMs &&
      frame.timestampMs <= interval.endTimestampMs
  );
  const rebase = (timestampMs) =>
    Math.max(0, timestampMs - interval.startTimestampMs);
  const frames = selectedFrames.map((frame) => ({
    ...frame,
    timestampMs: rebase(frame.timestampMs),
  }));
  const events = (fixture.events || [])
    .filter(
      (event) =>
        event.timestampMs >= interval.startTimestampMs &&
        event.timestampMs <= interval.endTimestampMs
    )
    .map((event) => ({ ...event, timestampMs: rebase(event.timestampMs) }));
  const validFrames = frames.filter((frame) => frame.valid).length;
  const invalidFrames = frames.length - validFrames;

  return {
    schemaVersion: "1.1-derived",
    testId: definition.testId,
    condition: definition.condition,
    exercise: fixture.exercise,
    role: definition.role,
    groundTruth: fixture.groundTruth,
    algorithmVersion: fixture.algorithmVersion,
    configAtCapture: fixture.configAtCapture,
    initialAlgorithmState: {
      phase: "ready",
      transitionCandidate: null,
      transitionStartedAtMs: 0,
      reps: 0,
      smoothedKeypoints: null,
      invalidSinceMs: null,
    },
    analysisActiveAtCapture: true,
    source: fixture.source,
    capture: {
      durationMs: frames.length ? frames.at(-1).timestampMs : 0,
      frameCount: frames.length,
      validFrames,
      invalidFrames,
      validJointRate: frames.length ? validFrames / frames.length : null,
    },
    derivedFrom: {
      path: sourceInfo.relativePath,
      sha256: sourceInfo.sha256,
      sourceSchemaVersion: fixture.schemaVersion,
      transform: "objective-movement-window",
      transformVersion: TRANSFORM_VERSION,
      interval,
      rules: { ...rules },
      selectionUsesExpectedOrPredictedReps: false,
    },
    notes:
      "Derived fixture for deterministic replay and ablation; not an end-to-end browser parity result.",
    frames,
    events,
    eventViews: classifyTrackingEvents(events, rules.jitterThresholdMs),
  };
}

function generate(rootDirectory) {
  const rawDirectory = path.join(rootDirectory, "raw");
  const canonicalDirectory = path.join(rootDirectory, "canonical");
  fs.mkdirSync(canonicalDirectory, { recursive: true });
  const manifest = {
    manifestVersion: "1.0",
    hashAlgorithm: "sha256",
    files: [],
  };

  for (const definition of DEFINITIONS) {
    const inputPath = path.join(rawDirectory, definition.input);
    const raw = fs.readFileSync(inputPath);
    const fixture = JSON.parse(raw.toString("utf8"));
    const sourceInfo = {
      relativePath: path.posix.join("raw", definition.input),
      sha256: sha256(raw),
    };
    manifest.files.push({
      path: sourceInfo.relativePath,
      sha256: sourceInfo.sha256,
      bytes: raw.length,
      schemaVersion: fixture.schemaVersion,
    });
    const derived = canonicalize(
      fixture,
      definition,
      sourceInfo,
      RULES
    );
    const validation = validateFixture(derived);
    if (!validation.valid) {
      throw new Error(
        `${definition.output} validation failed:\n${validation.errors.join("\n")}`
      );
    }
    fs.writeFileSync(
      path.join(canonicalDirectory, definition.output),
      `${JSON.stringify(derived, null, 2)}\n`
    );
  }
  fs.writeFileSync(
    path.join(rawDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  return manifest;
}

if (require.main === module) {
  const root = path.resolve(
    process.argv[2] || path.join("tests", "fixtures")
  );
  const manifest = generate(root);
  console.log(
    `Generated ${manifest.files.length} canonical fixtures from verified raw inputs.`
  );
}

module.exports = {
  DEFINITIONS,
  RULES,
  TRANSFORM_VERSION,
  canonicalize,
  generate,
  selectInterval,
  sha256,
};
