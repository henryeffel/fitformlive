from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field, model_validator

from fitform_eval.annotation import upsert_annotation
from fitform_eval.models import AnnotationDocument, CycleAnnotation, CycleLabel


class ReviewCandidate(BaseModel):
    candidateId: str = Field(min_length=1)
    source: str = Field(min_length=1)
    timestampMs: float = Field(ge=0)
    suggestedLabel: CycleLabel


class ReviewCandidateDocument(BaseModel):
    testId: str = Field(min_length=1)
    labelStatus: str
    warning: str
    candidates: list[ReviewCandidate]

    @model_validator(mode="after")
    def must_remain_unreviewed(self) -> "ReviewCandidateDocument":
        if self.labelStatus != "machine_generated_review_candidate":
            raise ValueError("review candidates must be machine-generated and unreviewed")
        return self


def load_review_candidates(payload: str | bytes | dict[str, Any]) -> ReviewCandidateDocument:
    raw = (
        json.loads(payload.decode("utf-8") if isinstance(payload, bytes) else payload)
        if isinstance(payload, (str, bytes))
        else payload
    )
    candidates: list[dict[str, Any]] = []
    mappings = (
        ("productionRepTimestampsMs", "production_rep", "valid_rep"),
        ("exploratoryRepTimestampsMs", "exploratory_rep", "valid_rep"),
        (
            "exploratoryRejectedTimestampsMs",
            "exploratory_rejection",
            "partial_rep",
        ),
    )
    for field, source, label in mappings:
        for index, timestamp in enumerate(raw.get(field, []), start=1):
            candidates.append(
                {
                    "candidateId": f"{source}-{index}",
                    "source": source,
                    "timestampMs": timestamp,
                    "suggestedLabel": label,
                }
            )
    return ReviewCandidateDocument(
        testId=raw["testId"],
        labelStatus=raw["labelStatus"],
        warning=raw.get("warning", ""),
        candidates=candidates,
    )


def candidate_rows(
    document: ReviewCandidateDocument,
    *,
    duration_ms: float,
    source: str,
) -> list[dict[str, Any]]:
    selected = sorted(
        (item for item in document.candidates if item.source == source),
        key=lambda item: item.timestampMs,
    )
    rows: list[dict[str, Any]] = []
    for index, item in enumerate(selected):
        previous = selected[index - 1].timestampMs if index else None
        following = (
            selected[index + 1].timestampMs if index + 1 < len(selected) else None
        )
        start = (
            (previous + item.timestampMs) / 2
            if previous is not None
            else max(0.0, item.timestampMs - 1500.0)
        )
        end = (
            (item.timestampMs + following) / 2
            if following is not None
            else min(duration_ms, item.timestampMs + 500.0)
        )
        rows.append(
            {
                "approve": False,
                "candidateId": item.candidateId,
                "source": item.source,
                "timestampMs": item.timestampMs,
                "label": item.suggestedLabel,
                "startMs": round(start, 1),
                "endMs": round(max(end, start + 1.0), 1),
                "completionMs": (
                    item.timestampMs if item.suggestedLabel == "valid_rep" else None
                ),
                "note": f"human-reviewed from {item.candidateId}",
            }
        )
    return rows


def approve_candidate_rows(
    document: AnnotationDocument,
    rows: list[dict[str, Any]],
    *,
    annotator: str,
) -> AnnotationDocument:
    result = document
    for row in rows:
        if not bool(row.get("approve")):
            continue
        candidate_id = str(row["candidateId"])
        provenance_note = f"human-reviewed from {candidate_id}"
        label = row["label"]
        completion = row.get("completionMs")
        if label != "valid_rep":
            completion = None
        start_ms = float(row["startMs"])
        end_ms = float(row["endMs"])
        completion_ms = float(completion) if completion is not None else None
        existing_index = next(
            (
                index
                for index, cycle in enumerate(result.cycles)
                if cycle.note == provenance_note
                or (
                    cycle.label == label
                    and cycle.startMs == start_ms
                    and cycle.endMs == end_ms
                    and cycle.completionMs == completion_ms
                )
            ),
            None,
        )
        anchor_ms = (
            completion_ms if completion_ms is not None else float(row["timestampMs"])
        )
        for index, cycle in enumerate(result.cycles):
            if index == existing_index or cycle.label == "tracking_failure":
                continue
            if cycle.startMs <= anchor_ms <= cycle.endMs:
                raise ValueError(
                    f"candidate {candidate_id} at {anchor_ms}ms is already inside "
                    f"annotation {cycle.startMs}-{cycle.endMs}; edit the existing "
                    "annotation instead of adding an overlapping candidate"
                )
            if cycle.endMs <= anchor_ms:
                start_ms = max(start_ms, cycle.endMs)
            elif cycle.startMs >= anchor_ms:
                end_ms = min(end_ms, cycle.startMs)
        annotation = CycleAnnotation(
            startMs=start_ms,
            endMs=end_ms,
            completionMs=completion_ms,
            label=label,
            annotator=annotator,
            note=str(row.get("note") or provenance_note),
        )
        result = upsert_annotation(
            result,
            annotation,
            index=existing_index,
        )
    return result
