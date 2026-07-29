const fs = require("node:fs");
const path = require("node:path");

const WIDTH = 1200;
const HEIGHT = 420;
const MARGIN = Object.freeze({ left: 64, right: 24, top: 28, bottom: 48 });

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function invalidRanges(trace, startMs, endMs) {
  const ranges = [];
  let start = null;
  for (const frame of trace) {
    if (frame.timestampMs < startMs || frame.timestampMs > endMs) continue;
    if (!frame.valid && start === null) start = frame.timestampMs;
    if (frame.valid && start !== null) {
      ranges.push([start, frame.timestampMs]);
      start = null;
    }
  }
  if (start !== null) ranges.push([start, endMs]);
  return ranges;
}

function renderChart(analysis, options) {
  const startMs = options.startMs;
  const endMs = options.endMs;
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (timestamp) =>
    MARGIN.left +
    ((timestamp - startMs) / Math.max(1, endMs - startMs)) * plotWidth;
  const y = (angle) =>
    MARGIN.top + ((180 - angle) / 180) * plotHeight;
  const visible = analysis.trace.filter(
    (frame) =>
      frame.timestampMs >= startMs && frame.timestampMs <= endMs
  );
  const step = Math.max(1, Math.floor(visible.length / 1800));

  function pathFor(key) {
    let pathData = "";
    let penDown = false;
    for (let index = 0; index < visible.length; index += step) {
      const frame = visible[index];
      const value = frame[key];
      if (!Number.isFinite(value)) {
        penDown = false;
        continue;
      }
      pathData += `${penDown ? "L" : "M"}${x(frame.timestampMs).toFixed(
        2
      )},${y(value).toFixed(2)}`;
      penDown = true;
    }
    return pathData;
  }

  const invalid = invalidRanges(analysis.trace, startMs, endMs)
    .map(
      ([from, to]) =>
        `<rect x="${x(from).toFixed(2)}" y="${MARGIN.top}" width="${Math.max(
          1,
          x(to) - x(from)
        ).toFixed(2)}" height="${plotHeight}" fill="#ef4444" opacity="0.08"/>`
    )
    .join("");
  const repMarkers = analysis.cycles
    .filter(
      (cycle) =>
        cycle.repCountedAtMs >= startMs &&
        cycle.repCountedAtMs <= endMs
    )
    .map(
      (cycle) =>
        `<g><line x1="${x(cycle.repCountedAtMs)}" x2="${x(
          cycle.repCountedAtMs
        )}" y1="${MARGIN.top}" y2="${MARGIN.top + plotHeight}" stroke="#84cc16" stroke-width="1.5"/><text x="${x(
          cycle.repCountedAtMs
        ) + 4}" y="${MARGIN.top + 16}" fill="#365314" font-size="12">${
          options.showLegacyDecision
            ? `Legacy: REP_COUNTED (R${cycle.rep})`
            : `R${cycle.rep}`
        }</text></g>`
    )
    .join("");
  const resetMarkers = visible
    .filter((frame) => frame.events.includes("STATE_RESET"))
    .map(
      (frame) =>
        `<line x1="${x(frame.timestampMs)}" x2="${x(
          frame.timestampMs
        )}" y1="${MARGIN.top}" y2="${
          MARGIN.top + plotHeight
        }" stroke="#7c3aed" stroke-width="2" stroke-dasharray="5 4"/>`
    )
    .join("");
  const exploratoryThreshold = Number.isFinite(options.fullContractAngle)
    ? `<line x1="${MARGIN.left}" x2="${
        MARGIN.left + plotWidth
      }" y1="${y(options.fullContractAngle)}" y2="${y(
        options.fullContractAngle
      )}" stroke="#a855f7" stroke-width="1.8" stroke-dasharray="3 4"/>
<text x="${MARGIN.left + 8}" y="${
        y(options.fullContractAngle) - 6
      }" fill="#7e22ce" font-family="Arial, sans-serif" font-size="11">Exploratory full contraction ≈ ${options.fullContractAngle.toFixed(
        1
      )}°</text>`
    : "";
  const enhancedMarkers = (options.enhancedEvents || [])
    .filter(
      (event) =>
        event.type === "INCOMPLETE_CONTRACTION_REJECTED" &&
        event.timestampMs >= startMs &&
        event.timestampMs <= endMs
    )
    .map(
      (event) =>
        `<g><circle cx="${x(event.timestampMs)}" cy="${y(
          event.angle
        )}" r="6" fill="#a855f7"/><text x="${
          x(event.timestampMs) - 6
        }" y="${y(event.angle) - 12}" text-anchor="end" fill="#7e22ce" font-family="Arial, sans-serif" font-size="11" font-weight="700">Improved: REJECTED</text></g>`
    )
    .join("");
  const ticks = [0, 30, 60, 90, 120, 155, 180]
    .map(
      (angle) =>
        `<g><line x1="${MARGIN.left}" x2="${
          MARGIN.left + plotWidth
        }" y1="${y(angle)}" y2="${y(
          angle
        )}" stroke="#d1d5db" stroke-width="1"/><text x="${
          MARGIN.left - 10
        }" y="${y(angle) + 4}" text-anchor="end" fill="#4b5563" font-size="11">${angle}°</text></g>`
    )
    .join("");
  const timeTicks = Array.from({ length: 7 }, (_, index) => {
    const timestamp = startMs + ((endMs - startMs) * index) / 6;
    return `<text x="${x(timestamp)}" y="${
      MARGIN.top + plotHeight + 24
    }" text-anchor="middle" fill="#4b5563" font-size="11">${(
      timestamp / 1000
    ).toFixed(1)}s</text>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeXml(
    options.title
  )}">
<rect width="100%" height="100%" fill="#fafaf9"/>
<text x="${MARGIN.left}" y="20" fill="#111827" font-family="Arial, sans-serif" font-size="16" font-weight="700">${escapeXml(
    options.title
  )}</text>
${ticks}${invalid}
<line x1="${MARGIN.left}" x2="${
    MARGIN.left + plotWidth
  }" y1="${y(60)}" y2="${y(
    60
  )}" stroke="#f97316" stroke-width="1.5" stroke-dasharray="7 4"/>
<line x1="${MARGIN.left}" x2="${
    MARGIN.left + plotWidth
  }" y1="${y(155)}" y2="${y(
    155
  )}" stroke="#2563eb" stroke-width="1.5" stroke-dasharray="7 4"/>
${exploratoryThreshold}
<path d="${pathFor(
    "rawAngle"
  )}" fill="none" stroke="#94a3b8" stroke-width="1" opacity="0.75"/>
<path d="${pathFor(
    "processedAngle"
  )}" fill="none" stroke="#111827" stroke-width="1.8"/>
${resetMarkers}${repMarkers}${enhancedMarkers}${timeTicks}
<g transform="translate(${MARGIN.left},${HEIGHT - 10})" font-family="Arial, sans-serif" font-size="11">
<text x="0" fill="#111827">processed angle</text><text x="120" fill="#64748b">raw angle</text><text x="205" fill="#f97316">60° contract start</text><text x="335" fill="#a855f7">≈36° exploratory full</text><text x="485" fill="#2563eb">155° extension</text><text x="595" fill="#7c3aed">reset</text><text x="645" fill="#84cc16">legacy rep</text>
</g>
</svg>`;
}

function renderAll(analyses, outputDirectory, summary = null) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const analysis of analyses) {
    const first = analysis.trace[0].timestampMs;
    const last = analysis.trace.at(-1).timestampMs;
    fs.writeFileSync(
      path.join(outputDirectory, `${analysis.fixture.testId}--overview.svg`),
      renderChart(analysis, {
        startMs: first,
        endMs: last,
        title: `${analysis.fixture.testId} · F_FULL overview`,
      })
    );
  }
  const normal = analyses.find(
    (analysis) => analysis.fixture.role === "normal_regression"
  );
  const normalCandidate = normal.cycles.find(
    (cycle) => !cycle.browserLabelAlignment.matched
  );
  fs.writeFileSync(
    path.join(outputDirectory, "normal-unmatched-rep--zoom.svg"),
    renderChart(normal, {
      startMs: Math.max(0, normalCandidate.repCountedAtMs - 2000),
      endMs: normalCandidate.repCountedAtMs + 2000,
      title: `Normal unmatched R${normalCandidate.rep} · ±2s`,
    })
  );
  const boundary = analyses.find(
    (analysis) => analysis.fixture.role === "threshold_sensitivity"
  );
  const boundaryCandidate = boundary.cycles[0];
  const fullContractAngle =
    summary?.fullContractionThresholdAnalysis?.candidate ?? null;
  const enhancedBoundary = summary?.enhancedResults?.find(
    (item) => item.fixture.testId === boundary.fixture.testId
  );
  fs.writeFileSync(
    path.join(outputDirectory, "boundary-rep--zoom.svg"),
    renderChart(boundary, {
      startMs: Math.max(0, boundaryCandidate.repCountedAtMs - 2000),
      endMs: boundaryCandidate.repCountedAtMs + 2000,
      title: `Boundary contraction R${boundaryCandidate.rep} · ±2s`,
      fullContractAngle,
      enhancedEvents: enhancedBoundary?.result?.events || [],
      showLegacyDecision: true,
    })
  );
}

if (require.main === module) {
  const analysisDirectory = path.resolve(
    process.argv[2] || path.join("evaluation", "rep-analysis")
  );
  const analyses = [
    "curl-normal-01--F_FULL.trace.json",
    "curl-boundary-contraction-01--F_FULL.trace.json",
  ].map((filename) =>
    JSON.parse(fs.readFileSync(path.join(analysisDirectory, filename), "utf8"))
  );
  const summary = JSON.parse(
    fs.readFileSync(path.join(analysisDirectory, "summary.json"), "utf8")
  );
  const outputDirectory = path.join(analysisDirectory, "charts");
  renderAll(analyses, outputDirectory, summary);
  console.log(`Generated charts in ${outputDirectory}.`);
}

module.exports = {
  invalidRanges,
  renderAll,
  renderChart,
};
