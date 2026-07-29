from __future__ import annotations

import json
from pathlib import Path

import pytest

from fitform_eval.annotation import (
    annotation_json,
    annotation_table,
    delete_annotation,
    empty_annotations,
    load_trace_payload,
    predictions_from_trace,
    save_annotations,
    trace_dataframe,
    upsert_annotation,
)
from fitform_eval.models import AnnotationDocument, CycleAnnotation
from fitform_eval.evaluator import evaluate_session


def synthetic_trace() -> dict:
    return {
        "traceVersion": "1.0",
        "fixture": {"testId": "synthetic-trace-01"},
        "configuration": "F_FULL",
        "trace": [
            {
                "timestampMs": 0,
                "rawAngle": 160,
                "processedAngle": 160,
                "requiredJointMinConfidence": 0.8,
                "valid": True,
                "repCount": 0,
                "phaseAfter": "ready",
                "events": [],
            },
            {
                "timestampMs": 1000,
                "rawAngle": 20,
                "processedAngle": 25,
                "requiredJointMinConfidence": 0.7,
                "valid": True,
                "repCount": 0,
                "phaseAfter": "bottom_hold",
                "events": [],
            },
            {
                "timestampMs": 2000,
                "rawAngle": 160,
                "processedAngle": 158,
                "requiredJointMinConfidence": 0.75,
                "valid": True,
                "repCount": 1,
                "phaseAfter": "ready",
                "events": ["REP_COUNTED"],
            },
        ],
    }


def valid_cycle() -> CycleAnnotation:
    return CycleAnnotation(
        startMs=500,
        endMs=2100,
        completionMs=2000,
        label="valid_rep",
        annotator="test",
    )


def test_trace_conversion_exports_p4_prediction_document() -> None:
    payload = load_trace_payload(json.dumps(synthetic_trace()))
    frame = trace_dataframe(payload, maximum_rows=2)
    predictions = predictions_from_trace(payload)

    assert len(frame) <= 3
    assert predictions.sessionId == "synthetic-trace-01"
    assert predictions.configurationId == "F_FULL"
    assert len(predictions.events) == 1
    assert predictions.events[0].timestampMs == 2000


def test_annotation_crud_is_sorted_and_validated() -> None:
    document = empty_annotations("session-01")
    late = CycleAnnotation(
        startMs=3000,
        endMs=3500,
        label="partial_rep",
        annotator="test",
    )
    document = upsert_annotation(document, late)
    document = upsert_annotation(document, valid_cycle())

    assert [item.label for item in document.cycles] == [
        "valid_rep",
        "partial_rep",
    ]
    table = annotation_table(document)
    assert table["durationMs"].tolist() == [1600, 500]

    replacement = CycleAnnotation(
        startMs=400,
        endMs=2200,
        completionMs=2000,
        label="valid_rep",
        annotator="reviewer",
    )
    document = upsert_annotation(document, replacement, index=0)
    assert document.cycles[0].annotator == "reviewer"
    document = delete_annotation(document, index=1)
    assert len(document.cycles) == 1


def test_overlapping_annotation_is_rejected() -> None:
    document = upsert_annotation(empty_annotations("session-01"), valid_cycle())
    overlap = CycleAnnotation(
        startMs=1900,
        endMs=2400,
        label="preparation",
        annotator="test",
    )

    with pytest.raises(ValueError, match="annotation intervals overlap"):
        upsert_annotation(document, overlap)


def test_annotation_round_trip_is_deterministic(tmp_path: Path) -> None:
    document = upsert_annotation(empty_annotations("session-01"), valid_cycle())
    output = tmp_path / "annotations.json"
    save_annotations(document, output)
    restored = AnnotationDocument.model_validate_json(
        output.read_text(encoding="utf-8")
    )

    assert restored == document
    assert output.read_text(encoding="utf-8") == annotation_json(document)


def test_trace_export_and_annotation_feed_p4_evaluator() -> None:
    payload = synthetic_trace()
    predictions = predictions_from_trace(payload)
    document = upsert_annotation(
        empty_annotations(predictions.sessionId),
        valid_cycle(),
    )

    metrics, diagnostics = evaluate_session(
        document,
        predictions,
        tolerance_ms=100,
    )

    assert metrics["truePositive"] == 1
    assert metrics["falsePositive"] == 0
    assert metrics["falseNegative"] == 0
    assert diagnostics[0]["type"] == "matched"
