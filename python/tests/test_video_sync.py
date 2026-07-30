from __future__ import annotations

import numpy as np

from fitform_eval.video_sync import (
    external_analysis_arms,
    external_analysis_to_trace_payload,
    fixture_to_trace_payload,
    is_external_video_analysis,
    nearest_timestamp_index,
    nearest_trace_frame,
    render_pose_overlay,
)


def fixture() -> dict:
    frames = [
        {
            "timestampMs": 0,
            "valid": True,
            "processedAngle": 150,
            "repCount": 0,
            "phase": "ready",
            "keypoints": [],
        },
        {
            "timestampMs": 100,
            "valid": True,
            "processedAngle": 40,
            "repCount": 1,
            "phase": "contracted",
            "keypoints": [],
        },
    ]
    return {
        "schemaVersion": "1.2",
        "testId": "video-session-01",
        "capture": {
            "video": {
                "filename": "video-session-01.webm",
                "mimeType": "video/webm",
            }
        },
        "frames": frames,
        "events": [{"timestampMs": 90, "type": "REP_COUNTED"}],
    }


def test_nearest_timestamp_index_uses_closest_frame() -> None:
    timestamps = [0, 100, 200]
    assert nearest_timestamp_index(timestamps, -10) == 0
    assert nearest_timestamp_index(timestamps, 51) == 1
    assert nearest_timestamp_index(timestamps, 250) == 2


def test_fixture_is_converted_to_annotation_trace() -> None:
    payload = fixture_to_trace_payload(fixture())
    assert payload["fixture"]["testId"] == "video-session-01"
    assert payload["trace"][1]["events"] == ["REP_COUNTED"]
    assert payload["trace"][1]["repCount"] == 1
    assert nearest_trace_frame(payload, 80)["timestampMs"] == 100


def test_pose_overlay_draws_on_video_frame() -> None:
    frame = np.zeros((120, 160, 3), dtype=np.uint8)
    trace_frame = {
        "timestampMs": 100,
        "processedAngle": 42,
        "repCount": 1,
        "phaseAfter": "contracted",
        "keypoints": [
            {"name": "right_shoulder", "x": 0.25, "y": 0.25, "score": 0.9},
            {"name": "right_elbow", "x": 0.5, "y": 0.5, "score": 0.9},
            {"name": "right_wrist", "x": 0.75, "y": 0.25, "score": 0.9},
        ],
    }
    overlay = render_pose_overlay(frame, trace_frame)
    assert overlay.shape == frame.shape
    assert int(overlay.sum()) > 0


def external_fixture(*, selected_arm: str | None = "right") -> dict:
    return {
        "schemaVersion": "external-video-1.0",
        "testId": "external-front-01",
        "condition": "front",
        "frames": [
            {
                "frameIndex": 0,
                "timestampMs": 0,
                "keypoints": [
                    {
                        "name": "right_elbow",
                        "x": 0.5,
                        "y": 0.5,
                        "score": 0.9,
                    }
                ],
            }
        ],
        "externalAnalysis": {
            "provenance": "external_video_diagnostic",
            "source": {
                "filename": "external-front-01.mp4",
                "durationMs": 1000,
                "width": 540,
                "height": 960,
            },
            "selection": {"selectedArm": selected_arm},
            "arms": [
                {
                    "arm": arm,
                    "production": {
                        "trace": {
                            "trace": [
                                {
                                    "frameIndex": 0,
                                    "timestampMs": 0,
                                    "rawAngle": 160,
                                    "processedAngle": 160,
                                    "valid": True,
                                    "repCount": 1 if arm == "right" else 0,
                                    "phaseAfter": "ready",
                                    "events": (
                                        [{"type": "REP_COUNTED"}]
                                        if arm == "right"
                                        else []
                                    ),
                                }
                            ]
                        }
                    },
                }
                for arm in ("left", "right")
            ],
        },
    }


def test_external_analysis_converts_selected_arm_to_annotation_trace() -> None:
    source = external_fixture()
    assert is_external_video_analysis(source)
    assert external_analysis_arms(source) == ["left", "right"]

    payload = external_analysis_to_trace_payload(source)

    assert payload["fixture"]["testId"] == "external-front-01-right"
    assert payload["fixture"]["arm"] == "right"
    assert payload["fixture"]["video"]["filename"] == "external-front-01.mp4"
    assert payload["trace"][0]["events"] == ["REP_COUNTED"]
    assert payload["trace"][0]["keypoints"][0]["name"] == "right_elbow"


def test_alternating_external_analysis_requires_explicit_arm() -> None:
    source = external_fixture(selected_arm=None)

    try:
        external_analysis_to_trace_payload(source)
    except ValueError as error:
        assert "explicit annotation arm" in str(error)
    else:
        raise AssertionError("expected an explicit-arm validation error")

    payload = external_analysis_to_trace_payload(source, arm="left")
    assert payload["fixture"]["arm"] == "left"
