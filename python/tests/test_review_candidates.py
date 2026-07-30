from __future__ import annotations

import pytest

from fitform_eval.annotation import empty_annotations, upsert_annotation
from fitform_eval.models import CycleAnnotation
from fitform_eval.review_candidates import (
    approve_candidate_rows,
    candidate_rows,
    load_review_candidates,
)


def payload() -> dict:
    return {
        "testId": "session-01",
        "labelStatus": "machine_generated_review_candidate",
        "warning": "Not human-reviewed ground truth.",
        "productionRepTimestampsMs": [2000, 5000],
        "exploratoryRepTimestampsMs": [2100, 5100],
        "exploratoryRejectedTimestampsMs": [8000],
    }


def test_candidate_sources_are_kept_separate() -> None:
    document = load_review_candidates(payload())
    rows = candidate_rows(
        document, duration_ms=9000, source="production_rep"
    )
    assert len(rows) == 2
    assert rows[0]["startMs"] == 500
    assert rows[0]["endMs"] == 3500
    assert rows[0]["approve"] is False


def test_only_explicitly_approved_rows_become_human_annotations() -> None:
    candidates = load_review_candidates(payload())
    rows = candidate_rows(
        candidates, duration_ms=9000, source="production_rep"
    )
    rows[0]["approve"] = True
    annotations = approve_candidate_rows(
        empty_annotations("session-01"),
        rows,
        annotator="henry",
    )
    assert len(annotations.cycles) == 1
    assert annotations.cycles[0].annotator == "henry"
    assert annotations.cycles[0].completionMs == 2000


def test_rejection_candidate_becomes_partial_only_after_approval() -> None:
    candidates = load_review_candidates(payload())
    rows = candidate_rows(
        candidates,
        duration_ms=9000,
        source="exploratory_rejection",
    )
    rows[0]["approve"] = True
    annotations = approve_candidate_rows(
        empty_annotations("session-01"),
        rows,
        annotator="reviewer",
    )
    assert annotations.cycles[0].label == "partial_rep"
    assert annotations.cycles[0].completionMs is None


def test_approving_same_candidate_twice_updates_instead_of_overlapping() -> None:
    candidates = load_review_candidates(payload())
    rows = candidate_rows(
        candidates,
        duration_ms=9000,
        source="production_rep",
    )
    rows[0]["approve"] = True
    annotations = approve_candidate_rows(
        empty_annotations("session-01"),
        rows,
        annotator="reviewer-01",
    )

    rows[0]["startMs"] = float(rows[0]["startMs"]) + 10
    annotations = approve_candidate_rows(
        annotations,
        rows,
        annotator="reviewer-02",
    )

    assert len(annotations.cycles) == 1
    assert annotations.cycles[0].startMs == rows[0]["startMs"]
    assert annotations.cycles[0].annotator == "reviewer-02"


def test_candidate_interval_is_clipped_to_existing_cycle_boundary() -> None:
    annotations = upsert_annotation(
        empty_annotations("session-01"),
        CycleAnnotation(
            startMs=1050,
            endMs=2590,
            completionMs=2000,
            label="valid_rep",
            annotator="reviewer",
        ),
    )
    rows = [
        {
            "approve": True,
            "candidateId": "production_rep-1",
            "source": "production_rep",
            "timestampMs": 3733.3,
            "label": "valid_rep",
            "startMs": 2233.3,
            "endMs": 4233.3,
            "completionMs": 3733.3,
            "note": "human-reviewed from production_rep-1",
        }
    ]

    result = approve_candidate_rows(annotations, rows, annotator="reviewer")

    assert len(result.cycles) == 2
    assert result.cycles[1].startMs == 2590
    assert result.cycles[1].endMs == 4233.3


def test_candidate_inside_existing_cycle_requires_edit_instead_of_duplicate() -> None:
    annotations = upsert_annotation(
        empty_annotations("session-01"),
        CycleAnnotation(
            startMs=3000,
            endMs=4000,
            completionMs=3500,
            label="valid_rep",
            annotator="reviewer",
        ),
    )
    rows = [
        {
            "approve": True,
            "candidateId": "production_rep-1",
            "source": "production_rep",
            "timestampMs": 3733.3,
            "label": "valid_rep",
            "startMs": 2233.3,
            "endMs": 4233.3,
            "completionMs": 3733.3,
            "note": "human-reviewed from production_rep-1",
        }
    ]

    with pytest.raises(ValueError, match="edit the existing annotation"):
        approve_candidate_rows(annotations, rows, annotator="reviewer")
