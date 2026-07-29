from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import (
    CanonicalFixtureMetadata,
    FixtureValidationReport,
    FrameValidationResult,
)

REQUIRED_ANGLE_KEYPOINTS = {"right_shoulder", "right_elbow", "right_wrist"}


class FixtureValidationError(ValueError):
    """Raised when a canonical fixture violates its data contract."""


def load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise FixtureValidationError(f"cannot parse fixture {path}: {error}") from error


def validate_fixture(path: str | Path) -> FixtureValidationReport:
    fixture_path = Path(path)
    payload = load_json(fixture_path)
    metadata = CanonicalFixtureMetadata.model_validate(
        {key: value for key, value in payload.items() if key != "frames"}
    )
    frames = payload.get("frames")
    if not isinstance(frames, list) or not frames:
        raise FixtureValidationError("frames must be a non-empty list")

    previous_timestamp: float | None = None
    valid_count = 0
    invalid_count = 0
    all_required_names_present = True

    for index, frame in enumerate(frames):
        if not isinstance(frame, dict):
            raise FixtureValidationError(f"frame {index} must be an object")
        timestamp = frame.get("timestampMs")
        if not isinstance(timestamp, (int, float)) or timestamp < 0:
            raise FixtureValidationError(f"frame {index} has invalid timestampMs")
        if previous_timestamp is not None and timestamp < previous_timestamp:
            raise FixtureValidationError(
                f"timestamp must be monotonic: frame {index} ({timestamp}) "
                f"< previous ({previous_timestamp})"
            )
        previous_timestamp = float(timestamp)

        is_valid = frame.get("valid")
        if not isinstance(is_valid, bool):
            raise FixtureValidationError(f"frame {index} valid must be boolean")
        valid_count += int(is_valid)
        invalid_count += int(not is_valid)

        keypoints = frame.get("keypoints")
        if not isinstance(keypoints, list):
            raise FixtureValidationError(f"frame {index} keypoints must be a list")
        names = {
            keypoint.get("name")
            for keypoint in keypoints
            if isinstance(keypoint, dict)
        }
        all_required_names_present &= REQUIRED_ANGLE_KEYPOINTS.issubset(names)
        for keypoint in keypoints:
            if not isinstance(keypoint, dict):
                raise FixtureValidationError(
                    f"frame {index} contains a non-object keypoint"
                )
            score = keypoint.get("score")
            if not isinstance(score, (int, float)) or not 0 <= score <= 1:
                raise FixtureValidationError(
                    f"frame {index} keypoint score must be within [0, 1]"
                )

    if len(frames) != metadata.capture.frameCount:
        raise FixtureValidationError(
            f"capture.frameCount={metadata.capture.frameCount} "
            f"but frames contains {len(frames)}"
        )
    if valid_count != metadata.capture.validFrames:
        raise FixtureValidationError(
            f"capture.validFrames={metadata.capture.validFrames} "
            f"but counted {valid_count}"
        )
    if invalid_count != metadata.capture.invalidFrames:
        raise FixtureValidationError(
            f"capture.invalidFrames={metadata.capture.invalidFrames} "
            f"but counted {invalid_count}"
        )
    if not all_required_names_present:
        raise FixtureValidationError(
            "one or more frames are missing required right-arm keypoints"
        )

    warnings: list[str] = []
    computed_rate = valid_count / len(frames)
    if abs(computed_rate - metadata.capture.validJointRate) > 1e-9:
        warnings.append(
            "capture.validJointRate differs from valid frame ratio; "
            "the capture metric may use a different denominator"
        )

    return FixtureValidationReport(
        fixture=str(fixture_path),
        testId=metadata.testId,
        schemaVersion=metadata.schemaVersion,
        metadataValid=True,
        frameValidation=FrameValidationResult(
            frameCount=len(frames),
            validFrames=valid_count,
            invalidFrames=invalid_count,
            firstTimestampMs=float(frames[0]["timestampMs"]),
            lastTimestampMs=float(frames[-1]["timestampMs"]),
            requiredKeypointNamesPresent=all_required_names_present,
        ),
        warnings=warnings,
    )

