from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pandas as pd

from .models import (
    AnnotationDocument,
    CycleAnnotation,
    PredictedEvent,
    PredictionDocument,
)


def load_trace_payload(source: str | bytes | Path | dict[str, Any]) -> dict[str, Any]:
    if isinstance(source, dict):
        payload = deepcopy(source)
    elif isinstance(source, bytes):
        payload = json.loads(source.decode("utf-8"))
    elif isinstance(source, Path):
        payload = json.loads(source.read_text(encoding="utf-8"))
    else:
        payload = json.loads(source)
    if not isinstance(payload.get("trace"), list) or not payload["trace"]:
        raise ValueError("trace payload must contain a non-empty trace list")
    return payload


def trace_session_id(payload: dict[str, Any]) -> str:
    fixture = payload.get("fixture") or {}
    return str(fixture.get("testId") or "unassigned-session")


def trace_dataframe(
    payload: dict[str, Any], *, maximum_rows: int = 2000
) -> pd.DataFrame:
    trace = pd.DataFrame(payload["trace"])
    required = {"timestampMs", "rawAngle", "processedAngle", "valid", "repCount"}
    missing = required.difference(trace.columns)
    if missing:
        raise ValueError(f"trace is missing required columns: {sorted(missing)}")
    if maximum_rows > 0 and len(trace) > maximum_rows:
        stride = max(1, len(trace) // maximum_rows)
        trace = trace.iloc[::stride].copy()
    columns = [
        "timestampMs",
        "rawAngle",
        "processedAngle",
        "requiredJointMinConfidence",
        "valid",
        "repCount",
        "phaseAfter",
    ]
    return trace[[column for column in columns if column in trace.columns]].reset_index(
        drop=True
    )


def trace_rep_events(payload: dict[str, Any]) -> list[PredictedEvent]:
    events: list[PredictedEvent] = []
    previous_rep = 0
    for frame in payload["trace"]:
        frame_events = frame.get("events") or []
        rep_count = int(frame.get("repCount") or 0)
        if "REP_COUNTED" in frame_events or rep_count > previous_rep:
            events.append(
                PredictedEvent(
                    timestampMs=float(frame["timestampMs"]),
                    type="REP_COUNTED",
                    rep=rep_count or previous_rep + 1,
                )
            )
        previous_rep = max(previous_rep, rep_count)
    return events


def predictions_from_trace(
    payload: dict[str, Any],
    *,
    session_id: str | None = None,
    algorithm_version: str = "trace-export",
) -> PredictionDocument:
    return PredictionDocument(
        sessionId=session_id or trace_session_id(payload),
        algorithmVersion=algorithm_version,
        configurationId=str(payload.get("configuration") or "unknown"),
        events=trace_rep_events(payload),
    )


def empty_annotations(session_id: str) -> AnnotationDocument:
    return AnnotationDocument(
        schemaVersion="1.0",
        sessionId=session_id,
        cycles=[],
    )


def annotation_table(document: AnnotationDocument) -> pd.DataFrame:
    rows = []
    for index, cycle in enumerate(document.cycles):
        row = cycle.model_dump()
        row["index"] = index
        row["durationMs"] = cycle.endMs - cycle.startMs
        rows.append(row)
    columns = [
        "index",
        "label",
        "startMs",
        "endMs",
        "completionMs",
        "durationMs",
        "annotator",
        "note",
    ]
    return pd.DataFrame(rows, columns=columns)


def upsert_annotation(
    document: AnnotationDocument,
    annotation: CycleAnnotation,
    *,
    index: int | None = None,
) -> AnnotationDocument:
    cycles = [cycle.model_copy(deep=True) for cycle in document.cycles]
    if index is None:
        cycles.append(annotation)
    else:
        if not 0 <= index < len(cycles):
            raise IndexError(f"annotation index out of range: {index}")
        cycles[index] = annotation
    cycles.sort(key=lambda item: (item.startMs, item.endMs))
    return AnnotationDocument(
        schemaVersion=document.schemaVersion,
        sessionId=document.sessionId,
        cycles=cycles,
    )


def delete_annotation(
    document: AnnotationDocument, *, index: int
) -> AnnotationDocument:
    cycles = [cycle.model_copy(deep=True) for cycle in document.cycles]
    if not 0 <= index < len(cycles):
        raise IndexError(f"annotation index out of range: {index}")
    del cycles[index]
    return AnnotationDocument(
        schemaVersion=document.schemaVersion,
        sessionId=document.sessionId,
        cycles=cycles,
    )


def annotation_json(document: AnnotationDocument) -> str:
    return document.model_dump_json(indent=2) + "\n"


def save_annotations(document: AnnotationDocument, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(annotation_json(document), encoding="utf-8")
    temporary_path.replace(path)

