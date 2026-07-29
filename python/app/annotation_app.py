from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pandas as pd
import streamlit as st
from pydantic import ValidationError

PROJECT_DIRECTORY = Path(__file__).resolve().parents[1]
SOURCE_DIRECTORY = PROJECT_DIRECTORY / "src"
if str(SOURCE_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(SOURCE_DIRECTORY))

from fitform_eval.annotation import (  # noqa: E402
    annotation_json,
    annotation_table,
    delete_annotation,
    empty_annotations,
    load_trace_payload,
    predictions_from_trace,
    trace_dataframe,
    trace_rep_events,
    trace_session_id,
    upsert_annotation,
)
from fitform_eval.evaluator import evaluate_session  # noqa: E402
from fitform_eval.models import (  # noqa: E402
    AnnotationDocument,
    CycleAnnotation,
)


LABELS = [
    "valid_rep",
    "partial_rep",
    "preparation",
    "repositioning",
    "tracking_failure",
    "ambiguous",
]


def document_key(session_id: str) -> str:
    return f"annotation_document::{session_id}"


def store_document(document: AnnotationDocument) -> None:
    st.session_state[document_key(document.sessionId)] = document.model_dump()


def restore_document(session_id: str) -> AnnotationDocument:
    payload = st.session_state.get(document_key(session_id))
    return (
        AnnotationDocument.model_validate(payload)
        if payload
        else empty_annotations(session_id)
    )


def initialize_uploaded_annotations(
    session_id: str, uploaded_file: object | None
) -> AnnotationDocument:
    if uploaded_file is None:
        return restore_document(session_id)
    upload_identity = f"{uploaded_file.name}:{uploaded_file.size}"
    identity_key = f"annotation_upload::{session_id}"
    if st.session_state.get(identity_key) != upload_identity:
        document = AnnotationDocument.model_validate_json(uploaded_file.getvalue())
        if document.sessionId != session_id:
            raise ValueError(
                f"annotation sessionId {document.sessionId} != trace sessionId {session_id}"
            )
        store_document(document)
        st.session_state[identity_key] = upload_identity
    return restore_document(session_id)


st.set_page_config(
    page_title="FitForm Cycle Annotation",
    page_icon="🦾",
    layout="wide",
)

st.title("FitForm Cycle Annotation")
st.caption(
    "Trace 기반 annotation workflow · 영상 없는 현재 단계에서는 동작의 물리적 의미를 "
    "확정하지 않습니다."
)

with st.sidebar:
    st.header("입력")
    trace_upload = st.file_uploader(
        "JS trace JSON",
        type=["json"],
        help="evaluation/rep-analysis/*--F_FULL.trace.json",
    )
    annotation_upload = st.file_uploader(
        "기존 annotation JSON · 선택",
        type=["json"],
        key="annotation-upload",
    )
    annotator = st.text_input(
        "Annotator",
        value=os.environ.get("FITFORM_ANNOTATOR", "human-01"),
    )
    tolerance_ms = st.number_input(
        "P4 matching tolerance · ms",
        min_value=0.0,
        max_value=5000.0,
        value=500.0,
        step=50.0,
    )

if trace_upload is None:
    st.info(
        "JS trace JSON을 올리면 angle timeline, REP_COUNTED 이벤트와 annotation 편집기가 "
        "표시됩니다."
    )
    st.stop()

try:
    trace_payload = load_trace_payload(trace_upload.getvalue())
    session_id = trace_session_id(trace_payload)
    document = initialize_uploaded_annotations(session_id, annotation_upload)
except (ValueError, ValidationError, json.JSONDecodeError) as error:
    st.error(f"입력 검증 실패: {error}")
    st.stop()

trace = trace_dataframe(trace_payload)
predictions = predictions_from_trace(
    trace_payload,
    session_id=session_id,
    algorithm_version="trace-export",
)
rep_events = trace_rep_events(trace_payload)
duration_ms = float(trace["timestampMs"].max())

summary_columns = st.columns(4)
summary_columns[0].metric("Session", session_id)
summary_columns[1].metric("Trace frames", f"{len(trace_payload['trace']):,}")
summary_columns[2].metric("Predicted reps", len(rep_events))
summary_columns[3].metric("Annotations", len(document.cycles))

st.subheader("Angle timeline")
chart = trace[["timestampMs", "rawAngle", "processedAngle"]].copy()
chart = chart.set_index("timestampMs")
st.line_chart(chart, height=300)
st.caption(
    "차트는 표시 성능을 위해 최대 2,000행으로 downsample됩니다. annotation timestamp와 "
    "P4 평가는 원본 millisecond 시간축을 사용합니다."
)

left, right = st.columns([0.65, 0.35])
with left:
    st.subheader("Annotations")
    table = annotation_table(document)
    st.dataframe(table, use_container_width=True, hide_index=True)
with right:
    st.subheader("Predicted REP_COUNTED")
    st.dataframe(
        pd.DataFrame(
            [
                {
                    "rep": event.rep,
                    "timestampMs": event.timestampMs,
                }
                for event in rep_events
            ]
        ),
        use_container_width=True,
        hide_index=True,
    )

st.subheader("Annotation editor")
edit_options = ["새 annotation"] + [
    f"{index}: {cycle.label} · {cycle.startMs:.1f}–{cycle.endMs:.1f}ms"
    for index, cycle in enumerate(document.cycles)
]
selection = st.selectbox("편집 대상", edit_options)
editing_index = None if selection == "새 annotation" else int(selection.split(":")[0])
editing_cycle = (
    document.cycles[editing_index] if editing_index is not None else None
)

with st.form("annotation-form", clear_on_submit=False):
    editor_columns = st.columns(4)
    label = editor_columns[0].selectbox(
        "Label",
        LABELS,
        index=LABELS.index(editing_cycle.label) if editing_cycle else 0,
    )
    start_ms = editor_columns[1].number_input(
        "Start · ms",
        min_value=0.0,
        max_value=max(duration_ms, 1.0),
        value=float(editing_cycle.startMs) if editing_cycle else 0.0,
        step=10.0,
    )
    end_ms = editor_columns[2].number_input(
        "End · ms",
        min_value=0.0,
        max_value=max(duration_ms, 1.0),
        value=float(editing_cycle.endMs) if editing_cycle else min(1000.0, duration_ms),
        step=10.0,
    )
    default_completion = (
        float(editing_cycle.completionMs)
        if editing_cycle and editing_cycle.completionMs is not None
        else float(end_ms)
    )
    completion_ms = editor_columns[3].number_input(
        "Completion · ms",
        min_value=0.0,
        max_value=max(duration_ms, 1.0),
        value=default_completion,
        step=10.0,
        disabled=label != "valid_rep",
    )
    note = st.text_input("Note", value=editing_cycle.note if editing_cycle else "")
    submitted = st.form_submit_button(
        "Annotation 추가" if editing_index is None else "Annotation 수정",
        type="primary",
    )

if submitted:
    try:
        annotation = CycleAnnotation(
            startMs=start_ms,
            endMs=end_ms,
            completionMs=completion_ms if label == "valid_rep" else None,
            label=label,
            annotator=annotator,
            note=note,
        )
        document = upsert_annotation(
            document,
            annotation,
            index=editing_index,
        )
        store_document(document)
        st.success("Annotation을 검증하고 저장했습니다.")
        st.rerun()
    except (ValueError, ValidationError, IndexError) as error:
        st.error(f"Annotation 저장 실패: {error}")

if editing_index is not None and st.button("선택 annotation 삭제"):
    document = delete_annotation(document, index=editing_index)
    store_document(document)
    st.rerun()

st.subheader("P4 quick evaluation")
if any(cycle.label == "valid_rep" for cycle in document.cycles):
    metrics, diagnostics = evaluate_session(
        document,
        predictions,
        tolerance_ms=tolerance_ms,
    )
    metric_columns = st.columns(5)
    metric_columns[0].metric("TP", metrics["truePositive"])
    metric_columns[1].metric("FP", metrics["falsePositive"])
    metric_columns[2].metric("FN", metrics["falseNegative"])
    metric_columns[3].metric("Precision", f"{metrics['precision']:.3f}")
    metric_columns[4].metric("Recall", f"{metrics['recall']:.3f}")
    with st.expander("Event diagnostics"):
        st.dataframe(pd.DataFrame(diagnostics), use_container_width=True)
else:
    st.info("valid_rep annotation을 하나 이상 추가하면 P4 quick evaluation이 실행됩니다.")

download_columns = st.columns(2)
download_columns[0].download_button(
    "annotations.json 다운로드",
    data=annotation_json(document),
    file_name=f"{session_id}.annotations.json",
    mime="application/json",
    use_container_width=True,
)
download_columns[1].download_button(
    "predictions.json 다운로드",
    data=predictions.model_dump_json(indent=2) + "\n",
    file_name=f"{session_id}.predictions.json",
    mime="application/json",
    use_container_width=True,
)

