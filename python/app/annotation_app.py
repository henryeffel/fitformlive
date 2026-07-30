from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
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
from fitform_eval.review_candidates import (  # noqa: E402
    approve_candidate_rows,
    candidate_rows,
    load_review_candidates,
)
from fitform_eval import video_sync as video_sync_module  # noqa: E402

decode_video_frame = video_sync_module.decode_video_frame
external_analysis_arms = video_sync_module.external_analysis_arms
external_analysis_to_trace_payload = (
    video_sync_module.external_analysis_to_trace_payload
)
fixture_to_trace_payload = video_sync_module.fixture_to_trace_payload
is_external_video_analysis = video_sync_module.is_external_video_analysis
is_video_fixture = video_sync_module.is_video_fixture
nearest_trace_frame = video_sync_module.nearest_trace_frame
render_pose_overlay = video_sync_module.render_pose_overlay
release_video_frame_cache = video_sync_module.release_video_frame_cache


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
    "영상과 관절 timestamp를 같은 세션 시간축에서 탐색하고 cycle-level ground truth를 "
    "작성합니다."
)

with st.sidebar:
    st.header("입력")
    trace_upload = st.file_uploader(
        "세션 JSON 또는 JS trace JSON",
        type=["json"],
        help="브라우저에서 저장한 schema 1.2 세션 JSON 또는 기존 trace JSON",
    )
    video_upload = st.file_uploader(
        "세션 영상 · schema 1.2에서 권장",
        type=["webm", "mp4", "mov"],
        key="video-upload",
    )
    annotation_upload = st.file_uploader(
        "기존 annotation JSON · 선택",
        type=["json"],
        key="annotation-upload",
    )
    candidate_upload = st.file_uploader(
        "Review candidate JSON · optional",
        type=["json"],
        key="candidate-upload",
        help="video:compare가 생성한 *.review-candidate.json",
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
        "세션 JSON을 올리면 timeline과 annotation 편집기가 표시됩니다. 함께 저장한 "
        "WebM을 추가하면 영상 프레임과 skeleton overlay를 탐색할 수 있습니다."
    )
    st.stop()

try:
    uploaded_payload = json.loads(trace_upload.getvalue().decode("utf-8"))
    video_fixture = uploaded_payload if is_video_fixture(uploaded_payload) else None
    external_fixture = (
        uploaded_payload if is_external_video_analysis(uploaded_payload) else None
    )
    if video_fixture:
        trace_payload = fixture_to_trace_payload(uploaded_payload)
    elif external_fixture:
        available_arms = external_analysis_arms(external_fixture)
        suggested_arm = (
            external_fixture["externalAnalysis"]
            .get("selection", {})
            .get("selectedArm")
        )
        default_arm_index = (
            available_arms.index(suggested_arm)
            if suggested_arm in available_arms
            else 0
        )
        annotation_arm = st.selectbox(
            "Annotation arm",
            available_arms,
            index=default_arm_index,
            help=(
                "외부 영상은 팔별 production trace를 독립적으로 검토합니다. "
                "양팔 교대 영상에서는 왼팔과 오른팔 annotation을 각각 저장하세요."
            ),
        )
        trace_payload = external_analysis_to_trace_payload(
            external_fixture,
            arm=annotation_arm,
        )
    else:
        trace_payload = load_trace_payload(uploaded_payload)
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
automatic_candidate_document = None
if external_fixture and rep_events:
    automatic_candidate_document = load_review_candidates(
        {
            "testId": session_id,
            "labelStatus": "machine_generated_review_candidate",
            "warning": (
                "Production events are navigation aids only. Approve each row "
                "only after checking the synchronized video."
            ),
            "productionRepTimestampsMs": [
                event.timestampMs for event in rep_events
            ],
        }
    )

summary_columns = st.columns(4)
summary_columns[0].metric("Session", session_id)
summary_columns[1].metric("Trace frames", f"{len(trace_payload['trace']):,}")
summary_columns[2].metric("Predicted reps", len(rep_events))
summary_columns[3].metric("Annotations", len(document.cycles))

if candidate_upload is not None or automatic_candidate_document is not None:
    st.subheader("Machine candidates → human review")
    st.warning(
        "후보는 자동 생성값입니다. 영상을 확인하고 approve를 직접 선택한 행만 "
        "human annotation으로 저장됩니다."
    )
    try:
        candidate_document = (
            load_review_candidates(candidate_upload.getvalue())
            if candidate_upload is not None
            else automatic_candidate_document
        )
        if candidate_document.testId != session_id:
            raise ValueError(
                f"candidate testId {candidate_document.testId} "
                f"!= sessionId {session_id}"
            )
        available_sources = sorted(
            {item.source for item in candidate_document.candidates}
        )
        if not available_sources:
            st.info("이 파일에는 검토할 후보 timestamp가 없습니다.")
        else:
            candidate_source = st.selectbox(
                "Candidate source",
                available_sources,
                help=(
                    "production과 exploratory 후보는 중복될 수 있으므로 "
                    "한 source씩 검수하세요."
                ),
            )
            review_rows = candidate_rows(
                candidate_document,
                duration_ms=duration_ms,
                source=candidate_source,
            )
            reviewed = st.data_editor(
                pd.DataFrame(review_rows),
                hide_index=True,
                use_container_width=True,
                disabled=["candidateId", "source", "timestampMs"],
                column_config={
                    "approve": st.column_config.CheckboxColumn(
                        "Human approved",
                        help="영상 확인 후에만 선택",
                    ),
                    "label": st.column_config.SelectboxColumn(
                        "Label",
                        options=LABELS,
                        required=True,
                    ),
                },
                key=f"candidate-review::{session_id}::{candidate_source}",
            )
            approved_count = int(reviewed["approve"].fillna(False).sum())
            st.caption(
                f"현재 사람이 승인한 후보: {approved_count}개 · "
                "체크만으로 상단 Annotations 숫자는 바뀌지 않습니다."
            )
            approved_preview = None
            if approved_count:
                approved_preview = approve_candidate_rows(
                    document,
                    reviewed.to_dict("records"),
                    annotator=annotator,
                )
                st.download_button(
                    f"Download {approved_count} reviewed annotations",
                    data=annotation_json(approved_preview),
                    file_name=f"{session_id}.annotations.json",
                    mime="application/json",
                    use_container_width=True,
                    key=(
                        f"candidate-download::{session_id}::"
                        f"{candidate_source}"
                    ),
                    help=(
                        "체크한 후보를 즉시 human annotation JSON으로 "
                        "다운로드합니다."
                    ),
                )
            if st.button(
                "Add approved rows to annotations",
                type="primary",
                key=f"candidate-approve::{session_id}::{candidate_source}",
            ):
                if approved_count == 0:
                    st.warning("승인한 후보가 없습니다.")
                else:
                    document = approved_preview
                    store_document(document)
                    st.success(
                        f"사람이 승인한 {approved_count}개 annotation을 저장했습니다."
                    )
                    st.rerun()
    except (ValueError, ValidationError, json.JSONDecodeError) as error:
        st.error(f"Candidate review 실패: {error}")

if video_upload is not None:
    st.subheader("Synchronized video")
    target_ms = st.slider(
        "영상·관절 탐색 위치 · ms",
        min_value=0.0,
        max_value=max(duration_ms, 1.0),
        value=0.0,
        step=10.0,
    )
    try:
        suffix = Path(video_upload.name).suffix or ".webm"
        video_bytes = video_upload.getvalue()
        upload_key = hashlib.sha256(video_bytes).hexdigest()
        cached_upload = st.session_state.get("annotation_video_upload")
        if not cached_upload or cached_upload["key"] != upload_key:
            if cached_upload:
                old_path = Path(cached_upload["path"])
                release_video_frame_cache(str(old_path))
                old_path.unlink(missing_ok=True)
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temporary:
                temporary.write(video_bytes)
                temporary_path = Path(temporary.name)
            st.session_state["annotation_video_upload"] = {
                "key": upload_key,
                "path": str(temporary_path),
            }
        else:
            temporary_path = Path(cached_upload["path"])
        video_frame, decoded_at_ms = decode_video_frame(
            str(temporary_path),
            target_ms,
        )
        trace_frame = nearest_trace_frame(trace_payload, target_ms)
        overlay = render_pose_overlay(video_frame, trace_frame)
        st.image(overlay, channels="BGR", use_container_width=True)
        sync_delta_ms = float(trace_frame["timestampMs"]) - decoded_at_ms
        st.caption(
            f"video {decoded_at_ms:.1f}ms · pose {float(trace_frame['timestampMs']):.1f}ms "
            f"· sync delta {sync_delta_ms:+.1f}ms"
        )
    except (ValueError, ImportError) as error:
        st.error(f"영상 동기화 실패: {error}")
elif video_fixture:
    expected_video = video_fixture["capture"]["video"]["filename"]
    st.info(f"이 세션과 함께 저장한 `{expected_video}` 파일을 업로드해 주세요.")
elif external_fixture:
    expected_video = external_fixture["externalAnalysis"]["source"]["filename"]
    st.info(
        f"외부 분석과 같은 원본 영상 `{expected_video}` 파일을 업로드해 주세요."
    )

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
    (
        "annotations.json 다운로드"
        if document.cycles
        else "annotation을 먼저 추가하세요"
    ),
    data=annotation_json(document),
    file_name=f"{session_id}.annotations.json",
    mime="application/json",
    use_container_width=True,
    disabled=not document.cycles,
    help=(
        None
        if document.cycles
        else "빈 annotation 파일의 다운로드를 막았습니다."
    ),
)
download_columns[1].download_button(
    "predictions.json 다운로드",
    data=predictions.model_dump_json(indent=2) + "\n",
    file_name=f"{session_id}.predictions.json",
    mime="application/json",
    use_container_width=True,
)

