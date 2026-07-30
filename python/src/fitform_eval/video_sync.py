from __future__ import annotations

from bisect import bisect_left
from copy import deepcopy
from typing import Any

KEYPOINT_EDGES = (
    ("left_shoulder", "right_shoulder"),
    ("left_shoulder", "left_elbow"),
    ("left_elbow", "left_wrist"),
    ("right_shoulder", "right_elbow"),
    ("right_elbow", "right_wrist"),
    ("left_shoulder", "left_hip"),
    ("right_shoulder", "right_hip"),
    ("left_hip", "right_hip"),
    ("left_hip", "left_knee"),
    ("left_knee", "left_ankle"),
    ("right_hip", "right_knee"),
    ("right_knee", "right_ankle"),
)


def is_video_fixture(payload: dict[str, Any]) -> bool:
    return (
        payload.get("schemaVersion") == "1.2"
        and isinstance(payload.get("frames"), list)
        and bool(payload.get("capture", {}).get("video"))
    )


def is_external_video_analysis(payload: dict[str, Any]) -> bool:
    analysis = payload.get("externalAnalysis")
    return (
        payload.get("schemaVersion") == "external-video-1.0"
        and isinstance(payload.get("frames"), list)
        and bool(payload["frames"])
        and isinstance(analysis, dict)
        and isinstance(analysis.get("arms"), list)
        and bool(analysis["arms"])
    )


def external_analysis_arms(payload: dict[str, Any]) -> list[str]:
    if not is_external_video_analysis(payload):
        raise ValueError("external-video-1.0 analysis is required")
    return [str(item["arm"]) for item in payload["externalAnalysis"]["arms"]]


def external_analysis_to_trace_payload(
    payload: dict[str, Any],
    *,
    arm: str | None = None,
) -> dict[str, Any]:
    if not is_external_video_analysis(payload):
        raise ValueError("external-video-1.0 analysis is required")

    analysis = payload["externalAnalysis"]
    selected_arm = arm or analysis.get("selection", {}).get("selectedArm")
    available_arms = external_analysis_arms(payload)
    if selected_arm not in available_arms:
        if selected_arm is None:
            raise ValueError(
                "alternating external video requires an explicit annotation arm"
            )
        raise ValueError(
            f"annotation arm {selected_arm!r} is not one of {available_arms}"
        )

    arm_analysis = next(
        item for item in analysis["arms"] if item["arm"] == selected_arm
    )
    production_trace = arm_analysis.get("production", {}).get("trace")
    if not isinstance(production_trace, dict):
        production_trace = arm_analysis.get("trace")
    source_trace = (
        production_trace.get("trace")
        if isinstance(production_trace, dict)
        else None
    )
    if not isinstance(source_trace, list) or not source_trace:
        raise ValueError(f"{selected_arm} production trace is missing")

    keypoints_by_index = {
        int(frame.get("frameIndex", index)): deepcopy(frame.get("keypoints") or [])
        for index, frame in enumerate(payload["frames"])
    }
    trace = []
    for index, frame in enumerate(source_trace):
        frame_index = int(frame.get("frameIndex", index))
        events = frame.get("events") or []
        trace.append(
            {
                **deepcopy(frame),
                "events": [
                    str(event.get("type"))
                    if isinstance(event, dict)
                    else str(event)
                    for event in events
                ],
                "keypoints": keypoints_by_index.get(frame_index, []),
            }
        )

    source = analysis.get("source") or payload.get("source") or {}
    test_id = str(payload.get("testId") or "external-video")
    return {
        "fixture": {
            "testId": f"{test_id}-{selected_arm}",
            "schemaVersion": payload["schemaVersion"],
            "video": {
                "filename": source.get("filename"),
                "width": source.get("width"),
                "height": source.get("height"),
                "durationMs": source.get("durationMs"),
            },
            "view": payload.get("condition"),
            "arm": selected_arm,
            "provenance": analysis.get("provenance"),
        },
        "configuration": f"external-production-{selected_arm}",
        "trace": trace,
    }


def fixture_to_trace_payload(fixture: dict[str, Any]) -> dict[str, Any]:
    if not is_video_fixture(fixture):
        raise ValueError("schema 1.2 video fixture가 필요합니다.")

    events_by_frame: dict[int, list[dict[str, Any]]] = {}
    frame_timestamps = [float(frame["timestampMs"]) for frame in fixture["frames"]]
    for event in fixture.get("events") or []:
        index = nearest_timestamp_index(frame_timestamps, float(event["timestampMs"]))
        events_by_frame.setdefault(index, []).append(event)

    trace = []
    carried_rep_count = 0
    for index, frame in enumerate(fixture["frames"]):
        processed_angle = frame.get("processedAngle")
        frame_events = events_by_frame.get(index, [])
        event_rep_count = max(
            (
                int(event.get("rep") or 0)
                for event in frame_events
                if event.get("type") == "REP_COUNTED"
            ),
            default=0,
        )
        carried_rep_count = max(
            carried_rep_count,
            int(frame.get("repCount") or 0),
            event_rep_count,
        )
        trace.append(
            {
                "timestampMs": float(frame["timestampMs"]),
                "rawAngle": frame.get("rawAngle"),
                "processedAngle": processed_angle,
                "valid": bool(frame.get("valid")),
                "repCount": carried_rep_count,
                "phaseAfter": frame.get("phase"),
                "events": [str(event["type"]) for event in frame_events],
                "keypoints": deepcopy(frame.get("keypoints") or []),
            }
        )
    return {
        "fixture": {
            "testId": fixture["testId"],
            "schemaVersion": fixture["schemaVersion"],
            "video": deepcopy(fixture["capture"]["video"]),
        },
        "configuration": "capture-production",
        "trace": trace,
    }


def nearest_timestamp_index(timestamps_ms: list[float], target_ms: float) -> int:
    if not timestamps_ms:
        raise ValueError("timestamps must not be empty")
    position = bisect_left(timestamps_ms, target_ms)
    if position <= 0:
        return 0
    if position >= len(timestamps_ms):
        return len(timestamps_ms) - 1
    before = timestamps_ms[position - 1]
    after = timestamps_ms[position]
    return position - 1 if target_ms - before <= after - target_ms else position


def nearest_trace_frame(payload: dict[str, Any], target_ms: float) -> dict[str, Any]:
    trace = payload["trace"]
    index = nearest_timestamp_index(
        [float(frame["timestampMs"]) for frame in trace],
        target_ms,
    )
    return trace[index]


def render_pose_overlay(
    frame_bgr: Any,
    trace_frame: dict[str, Any],
    *,
    confidence_threshold: float = 0.25,
) -> Any:
    import cv2

    output = frame_bgr.copy()
    height, width = output.shape[:2]
    points: dict[str, tuple[int, int]] = {}
    for keypoint in trace_frame.get("keypoints") or []:
        x = keypoint.get("x")
        y = keypoint.get("y")
        score = keypoint.get("score")
        if x is None or y is None or score is None or score < confidence_threshold:
            continue
        point = (round(float(x) * width), round(float(y) * height))
        points[str(keypoint["name"])] = point
        cv2.circle(output, point, 4, (45, 212, 191), -1, cv2.LINE_AA)

    for start_name, end_name in KEYPOINT_EDGES:
        if start_name in points and end_name in points:
            cv2.line(
                output,
                points[start_name],
                points[end_name],
                (34, 197, 94),
                2,
                cv2.LINE_AA,
            )

    angle = trace_frame.get("processedAngle")
    phase = trace_frame.get("phaseAfter") or "-"
    reps = trace_frame.get("repCount") or 0
    timestamp = float(trace_frame["timestampMs"])
    angle_text = f"{float(angle):.1f} deg" if angle is not None else "- deg"
    label = f"{timestamp:.0f} ms | {angle_text} | {phase} | reps {reps}"
    cv2.rectangle(output, (8, 8), (min(width - 8, 620), 44), (2, 6, 23), -1)
    cv2.putText(
        output,
        label,
        (16, 34),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.62,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    return output


def decode_video_frame(video_path: str, timestamp_ms: float) -> tuple[Any, float]:
    import cv2

    target_ms = max(0.0, timestamp_ms)

    def open_capture() -> Any:
        opened_capture = cv2.VideoCapture(video_path)
        if not opened_capture.isOpened():
            raise ValueError("업로드한 영상을 OpenCV로 열 수 없습니다.")
        return opened_capture

    capture = open_capture()
    try:
        capture.set(cv2.CAP_PROP_POS_MSEC, target_ms)
        ok, frame = capture.read()
        actual_timestamp_ms = float(capture.get(cv2.CAP_PROP_POS_MSEC))
        if ok and (
            target_ms == 0.0
            or abs(actual_timestamp_ms - target_ms) <= 500.0
        ):
            return frame, actual_timestamp_ms
    finally:
        capture.release()

    # Chrome VP9 WebM은 일부 OpenCV/FFmpeg 빌드에서 FPS와 random seek
    # metadata를 잘못 제공한다. 이 경우 timestamp를 읽으며 순차 디코딩한다.
    capture = open_capture()
    try:
        last_frame = None
        last_timestamp_ms = 0.0
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            last_frame = frame
            last_timestamp_ms = float(capture.get(cv2.CAP_PROP_POS_MSEC))
            if last_timestamp_ms >= target_ms:
                return frame, last_timestamp_ms
        if last_frame is not None and target_ms - last_timestamp_ms <= 500.0:
            return last_frame, last_timestamp_ms
        raise ValueError(f"{timestamp_ms:.1f}ms 영상 프레임을 읽을 수 없습니다.")
    finally:
        capture.release()
