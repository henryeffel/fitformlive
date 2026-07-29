from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .models import (
    AnnotationDocument,
    BatchManifest,
    PredictionDocument,
)


@dataclass(frozen=True)
class EventMatch:
    ground_truth_index: int
    prediction_index: int
    ground_truth_timestamp_ms: float
    prediction_timestamp_ms: float
    latency_ms: float


@dataclass(frozen=True)
class MatchingResult:
    matches: list[EventMatch]
    unmatched_ground_truth_indices: list[int]
    unmatched_prediction_indices: list[int]


def match_ordered_events(
    ground_truth_timestamps: list[float],
    prediction_timestamps: list[float],
    *,
    tolerance_ms: float,
) -> MatchingResult:
    """Maximize matches, then minimize total absolute latency, preserving order."""
    gt_count = len(ground_truth_timestamps)
    pred_count = len(prediction_timestamps)
    # Each cell stores (match_count, negative_total_distance, previous action).
    score: list[list[tuple[int, float] | None]] = [
        [None] * (pred_count + 1) for _ in range(gt_count + 1)
    ]
    action: list[list[str | None]] = [
        [None] * (pred_count + 1) for _ in range(gt_count + 1)
    ]
    score[0][0] = (0, 0.0)

    def update(
        gt_index: int,
        pred_index: int,
        candidate: tuple[int, float],
        candidate_action: str,
    ) -> None:
        current = score[gt_index][pred_index]
        if current is None or candidate > current:
            score[gt_index][pred_index] = candidate
            action[gt_index][pred_index] = candidate_action

    for gt_index in range(gt_count + 1):
        for pred_index in range(pred_count + 1):
            current = score[gt_index][pred_index]
            if current is None:
                continue
            if gt_index < gt_count:
                update(gt_index + 1, pred_index, current, "skip_gt")
            if pred_index < pred_count:
                update(gt_index, pred_index + 1, current, "skip_prediction")
            if gt_index < gt_count and pred_index < pred_count:
                distance = abs(
                    prediction_timestamps[pred_index]
                    - ground_truth_timestamps[gt_index]
                )
                if distance <= tolerance_ms:
                    update(
                        gt_index + 1,
                        pred_index + 1,
                        (current[0] + 1, current[1] - distance),
                        "match",
                    )

    matches: list[EventMatch] = []
    gt_index, pred_index = gt_count, pred_count
    while gt_index > 0 or pred_index > 0:
        choice = action[gt_index][pred_index]
        if choice == "match":
            gt_timestamp = ground_truth_timestamps[gt_index - 1]
            pred_timestamp = prediction_timestamps[pred_index - 1]
            matches.append(
                EventMatch(
                    ground_truth_index=gt_index - 1,
                    prediction_index=pred_index - 1,
                    ground_truth_timestamp_ms=gt_timestamp,
                    prediction_timestamp_ms=pred_timestamp,
                    latency_ms=pred_timestamp - gt_timestamp,
                )
            )
            gt_index -= 1
            pred_index -= 1
        elif choice == "skip_gt":
            gt_index -= 1
        elif choice == "skip_prediction":
            pred_index -= 1
        else:
            break
    matches.reverse()
    matched_gt = {item.ground_truth_index for item in matches}
    matched_predictions = {item.prediction_index for item in matches}
    return MatchingResult(
        matches=matches,
        unmatched_ground_truth_indices=[
            index for index in range(gt_count) if index not in matched_gt
        ],
        unmatched_prediction_indices=[
            index
            for index in range(pred_count)
            if index not in matched_predictions
        ],
    )


def _safe_ratio(numerator: int, denominator: int) -> float:
    return float(numerator / denominator) if denominator else 0.0


def _percentile(values: list[float], percentile: float) -> float | None:
    return float(np.percentile(values, percentile)) if values else None


def evaluate_session(
    annotations: AnnotationDocument,
    predictions: PredictionDocument,
    *,
    tolerance_ms: float = 500,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if annotations.sessionId != predictions.sessionId:
        raise ValueError(
            "annotation and prediction sessionId must match: "
            f"{annotations.sessionId} != {predictions.sessionId}"
        )
    valid_reps = [
        item for item in annotations.cycles if item.label == "valid_rep"
    ]
    ground_truth_timestamps = [
        float(item.completionMs) for item in valid_reps if item.completionMs is not None
    ]
    predicted_events = [
        item for item in predictions.events if item.type == "REP_COUNTED"
    ]
    prediction_timestamps = [float(item.timestampMs) for item in predicted_events]
    matching = match_ordered_events(
        ground_truth_timestamps,
        prediction_timestamps,
        tolerance_ms=tolerance_ms,
    )
    tp = len(matching.matches)
    fp = len(matching.unmatched_prediction_indices)
    fn = len(matching.unmatched_ground_truth_indices)
    precision = _safe_ratio(tp, tp + fp)
    recall = _safe_ratio(tp, tp + fn)
    f1 = (
        2 * precision * recall / (precision + recall)
        if precision + recall
        else 0.0
    )
    latencies = [item.latency_ms for item in matching.matches]
    absolute_latencies = [abs(value) for value in latencies]
    failure_intervals = [
        item for item in annotations.cycles if item.label == "tracking_failure"
    ]
    predictions_during_failure = sum(
        1
        for event in predicted_events
        if any(
            interval.startMs <= event.timestampMs <= interval.endMs
            for interval in failure_intervals
        )
    )

    diagnostics: list[dict[str, Any]] = []
    for match in matching.matches:
        diagnostics.append(
            {
                "sessionId": annotations.sessionId,
                "type": "matched",
                "groundTruthIndex": match.ground_truth_index,
                "predictionIndex": match.prediction_index,
                "groundTruthTimestampMs": match.ground_truth_timestamp_ms,
                "predictionTimestampMs": match.prediction_timestamp_ms,
                "latencyMs": match.latency_ms,
            }
        )
    for index in matching.unmatched_ground_truth_indices:
        diagnostics.append(
            {
                "sessionId": annotations.sessionId,
                "type": "false_negative",
                "groundTruthIndex": index,
                "predictionIndex": None,
                "groundTruthTimestampMs": ground_truth_timestamps[index],
                "predictionTimestampMs": None,
                "latencyMs": None,
            }
        )
    for index in matching.unmatched_prediction_indices:
        timestamp = prediction_timestamps[index]
        labels_at_timestamp = [
            interval.label
            for interval in annotations.cycles
            if interval.startMs <= timestamp <= interval.endMs
        ]
        diagnostics.append(
            {
                "sessionId": annotations.sessionId,
                "type": "false_positive",
                "groundTruthIndex": None,
                "predictionIndex": index,
                "groundTruthTimestampMs": None,
                "predictionTimestampMs": timestamp,
                "latencyMs": None,
                "annotationContext": "|".join(labels_at_timestamp),
            }
        )

    metrics = {
        "sessionId": annotations.sessionId,
        "algorithmVersion": predictions.algorithmVersion,
        "configurationId": predictions.configurationId,
        "groundTruthRepCount": len(ground_truth_timestamps),
        "predictedRepCount": len(prediction_timestamps),
        "absoluteRepCountError": abs(
            len(prediction_timestamps) - len(ground_truth_timestamps)
        ),
        "truePositive": tp,
        "falsePositive": fp,
        "falseNegative": fn,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "meanSignedLatencyMs": float(np.mean(latencies)) if latencies else None,
        "medianAbsoluteLatencyMs": _percentile(absolute_latencies, 50),
        "p95AbsoluteLatencyMs": _percentile(absolute_latencies, 95),
        "trackingFailureIntervalCount": len(failure_intervals),
        "predictionsDuringTrackingFailure": predictions_during_failure,
        "ambiguousAnnotationCount": sum(
            item.label == "ambiguous" for item in annotations.cycles
        ),
        "toleranceMs": tolerance_ms,
    }
    return metrics, diagnostics


def load_annotation(path: Path) -> AnnotationDocument:
    return AnnotationDocument.model_validate_json(path.read_text(encoding="utf-8"))


def load_predictions(path: Path) -> PredictionDocument:
    return PredictionDocument.model_validate_json(path.read_text(encoding="utf-8"))


def aggregate_conditions(session_table: pd.DataFrame) -> pd.DataFrame:
    condition_columns = [
        column for column in session_table.columns if column.startswith("condition.")
    ]
    if not condition_columns:
        condition_columns = ["condition"]
        session_table = session_table.copy()
        session_table["condition"] = "all"
    grouped = session_table.groupby(condition_columns, dropna=False, sort=True)
    rows: list[dict[str, Any]] = []
    for keys, group in grouped:
        if not isinstance(keys, tuple):
            keys = (keys,)
        tp = int(group["truePositive"].sum())
        fp = int(group["falsePositive"].sum())
        fn = int(group["falseNegative"].sum())
        precision = _safe_ratio(tp, tp + fp)
        recall = _safe_ratio(tp, tp + fn)
        row = dict(zip(condition_columns, keys))
        row.update(
            {
                "sessionCount": int(len(group)),
                "groundTruthRepCount": int(group["groundTruthRepCount"].sum()),
                "predictedRepCount": int(group["predictedRepCount"].sum()),
                "absoluteRepCountError": int(
                    group["absoluteRepCountError"].sum()
                ),
                "truePositive": tp,
                "falsePositive": fp,
                "falseNegative": fn,
                "precision": precision,
                "recall": recall,
                "f1": (
                    2 * precision * recall / (precision + recall)
                    if precision + recall
                    else 0.0
                ),
                "predictionsDuringTrackingFailure": int(
                    group["predictionsDuringTrackingFailure"].sum()
                ),
            }
        )
        rows.append(row)
    return pd.DataFrame(rows)


def render_condition_report_svg(condition_table: pd.DataFrame, output: Path) -> None:
    width = 920
    row_height = 48
    height = 78 + max(1, len(condition_table)) * row_height
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" '
        f'height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="#fffef9"/>',
        '<text x="24" y="30" font-family="Arial,sans-serif" font-size="18" '
        'font-weight="700" fill="#11140f">Condition-level cycle evaluation</text>',
        '<text x="24" y="49" font-family="Arial,sans-serif" font-size="9" '
        'fill="#65685f">Event matching metrics from cycle-level ground truth</text>',
    ]
    condition_columns = [
        column
        for column in condition_table.columns
        if column.startswith("condition.")
    ]
    for index, row in condition_table.iterrows():
        y = 65 + index * row_height
        label = " · ".join(
            str(row[column]) for column in condition_columns
        ) or "all"
        precision_width = max(0, min(1, float(row["precision"]))) * 210
        recall_width = max(0, min(1, float(row["recall"]))) * 210
        parts.extend(
            [
                f'<text x="24" y="{y + 17}" font-family="Arial,sans-serif" '
                f'font-size="10" font-weight="700" fill="#11140f">{label}</text>',
                f'<rect x="250" y="{y + 5}" width="210" height="10" fill="#e3e3dc"/>',
                f'<rect x="250" y="{y + 5}" width="{precision_width:.2f}" '
                'height="10" fill="#335cff"/>',
                f'<text x="468" y="{y + 14}" font-family="Arial,sans-serif" '
                f'font-size="8" fill="#11140f">P {row["precision"]:.3f}</text>',
                f'<rect x="560" y="{y + 5}" width="210" height="10" fill="#e3e3dc"/>',
                f'<rect x="560" y="{y + 5}" width="{recall_width:.2f}" '
                'height="10" fill="#ceff2f"/>',
                f'<text x="778" y="{y + 14}" font-family="Arial,sans-serif" '
                f'font-size="8" fill="#11140f">R {row["recall"]:.3f}</text>',
                f'<text x="250" y="{y + 34}" font-family="Arial,sans-serif" '
                f'font-size="8" fill="#65685f">TP {int(row["truePositive"])} · '
                f'FP {int(row["falsePositive"])} · FN {int(row["falseNegative"])} · '
                f'failure count {int(row["predictionsDuringTrackingFailure"])}</text>',
            ]
        )
    parts.append("</svg>")
    output.write_text("\n".join(parts), encoding="utf-8")


def evaluate_batch(
    manifest_path: Path,
    output_directory: Path,
    *,
    tolerance_ms: float = 500,
) -> dict[str, Path]:
    manifest = BatchManifest.model_validate_json(
        manifest_path.read_text(encoding="utf-8")
    )
    base_directory = manifest_path.parent
    session_rows: list[dict[str, Any]] = []
    diagnostics: list[dict[str, Any]] = []

    for entry in manifest.sessions:
        annotation_path = (base_directory / entry.annotations).resolve()
        prediction_path = (base_directory / entry.predictions).resolve()
        annotations = load_annotation(annotation_path)
        predictions = load_predictions(prediction_path)
        if entry.sessionId != annotations.sessionId:
            raise ValueError(
                f"manifest sessionId {entry.sessionId} does not match annotations"
            )
        metrics, session_diagnostics = evaluate_session(
            annotations, predictions, tolerance_ms=tolerance_ms
        )
        metrics.update(
            {f"condition.{key}": value for key, value in entry.condition.items()}
        )
        session_rows.append(metrics)
        diagnostics.extend(session_diagnostics)

    session_table = pd.DataFrame(session_rows)
    condition_table = aggregate_conditions(session_table)
    diagnostics_table = pd.DataFrame(diagnostics)
    output_directory.mkdir(parents=True, exist_ok=True)
    session_path = output_directory / "session-results.csv"
    condition_path = output_directory / "condition-results.csv"
    diagnostics_path = output_directory / "event-diagnostics.csv"
    summary_path = output_directory / "batch-summary.json"
    svg_path = output_directory / "condition-report.svg"
    session_table.to_csv(session_path, index=False)
    condition_table.to_csv(condition_path, index=False)
    diagnostics_table.to_csv(diagnostics_path, index=False)
    summary = {
        "evaluationVersion": "1.0",
        "manifest": str(manifest_path),
        "sessionCount": len(session_table),
        "toleranceMs": tolerance_ms,
        "dataProvenance": manifest.dataProvenance,
        "conditionResults": condition_table.to_dict(orient="records"),
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    render_condition_report_svg(condition_table, svg_path)
    return {
        "sessions": session_path,
        "conditions": condition_path,
        "diagnostics": diagnostics_path,
        "summary": summary_path,
        "svg": svg_path,
    }
