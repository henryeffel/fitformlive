from __future__ import annotations

import json
from pathlib import Path

import pytest

from fitform_eval.evaluator import (
    evaluate_batch,
    evaluate_session,
    match_ordered_events,
)
from fitform_eval.models import AnnotationDocument, PredictionDocument


def annotation_payload(session_id: str = "synthetic-normal-01") -> dict:
    return {
        "schemaVersion": "1.0",
        "sessionId": session_id,
        "cycles": [
            {
                "startMs": 500,
                "endMs": 1000,
                "completionMs": 950,
                "label": "valid_rep",
                "annotator": "synthetic-test",
            },
            {
                "startMs": 1500,
                "endMs": 2000,
                "completionMs": 1950,
                "label": "valid_rep",
                "annotator": "synthetic-test",
            },
            {
                "startMs": 2500,
                "endMs": 3000,
                "label": "tracking_failure",
                "annotator": "synthetic-test",
            },
        ],
    }


def prediction_payload(session_id: str = "synthetic-normal-01") -> dict:
    return {
        "sessionId": session_id,
        "algorithmVersion": "synthetic-v1",
        "configurationId": "test-config",
        "events": [
            {"timestampMs": 1000, "type": "REP_COUNTED", "rep": 1},
            {"timestampMs": 2600, "type": "REP_COUNTED", "rep": 2},
        ],
    }


def test_ordered_matching_maximizes_matches_before_latency() -> None:
    result = match_ordered_events(
        [1000, 1600],
        [1300, 1700],
        tolerance_ms=400,
    )

    assert len(result.matches) == 2
    assert [item.latency_ms for item in result.matches] == [300, 100]
    assert result.unmatched_ground_truth_indices == []
    assert result.unmatched_prediction_indices == []


def test_session_metrics_include_failure_interval_false_positive() -> None:
    metrics, diagnostics = evaluate_session(
        AnnotationDocument.model_validate(annotation_payload()),
        PredictionDocument.model_validate(prediction_payload()),
        tolerance_ms=200,
    )

    assert metrics["truePositive"] == 1
    assert metrics["falsePositive"] == 1
    assert metrics["falseNegative"] == 1
    assert metrics["precision"] == pytest.approx(0.5)
    assert metrics["recall"] == pytest.approx(0.5)
    assert metrics["f1"] == pytest.approx(0.5)
    assert metrics["predictionsDuringTrackingFailure"] == 1
    false_positive = next(
        item for item in diagnostics if item["type"] == "false_positive"
    )
    assert false_positive["annotationContext"] == "tracking_failure"


def test_batch_outputs_session_condition_and_diagnostics(tmp_path: Path) -> None:
    first_annotations = tmp_path / "normal.annotations.json"
    first_predictions = tmp_path / "normal.predictions.json"
    second_annotations = tmp_path / "fast.annotations.json"
    second_predictions = tmp_path / "fast.predictions.json"
    first_annotations.write_text(
        json.dumps(annotation_payload("normal-01")), encoding="utf-8"
    )
    first_predictions.write_text(
        json.dumps(prediction_payload("normal-01")), encoding="utf-8"
    )
    fast_annotation = annotation_payload("fast-01")
    fast_annotation["cycles"] = fast_annotation["cycles"][:2]
    fast_prediction = prediction_payload("fast-01")
    fast_prediction["events"] = [
        {"timestampMs": 1000, "type": "REP_COUNTED", "rep": 1},
        {"timestampMs": 1980, "type": "REP_COUNTED", "rep": 2},
    ]
    second_annotations.write_text(
        json.dumps(fast_annotation), encoding="utf-8"
    )
    second_predictions.write_text(
        json.dumps(fast_prediction), encoding="utf-8"
    )
    manifest = {
        "schemaVersion": "1.0",
        "sessions": [
            {
                "sessionId": "normal-01",
                "condition": {"movementSpeed": "normal"},
                "annotations": first_annotations.name,
                "predictions": first_predictions.name,
            },
            {
                "sessionId": "fast-01",
                "condition": {"movementSpeed": "fast"},
                "annotations": second_annotations.name,
                "predictions": second_predictions.name,
            },
        ],
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    first = evaluate_batch(manifest_path, tmp_path / "output-a", tolerance_ms=200)
    second = evaluate_batch(
        manifest_path, tmp_path / "output-b", tolerance_ms=200
    )

    for artifact in ("sessions", "conditions", "diagnostics", "summary", "svg"):
        assert first[artifact].read_bytes() == second[artifact].read_bytes()
    summary = json.loads(first["summary"].read_text(encoding="utf-8"))
    assert summary["sessionCount"] == 2
    assert len(summary["conditionResults"]) == 2


def test_valid_rep_without_completion_is_rejected() -> None:
    payload = annotation_payload()
    payload["cycles"][0]["completionMs"] = None

    with pytest.raises(ValueError, match="valid_rep requires completionMs"):
        AnnotationDocument.model_validate(payload)

