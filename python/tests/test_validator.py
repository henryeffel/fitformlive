from __future__ import annotations

import json
from pathlib import Path

import pytest

from fitform_eval.validator import FixtureValidationError, validate_fixture


REPOSITORY = Path(__file__).resolve().parents[2]
NORMAL_FIXTURE = (
    REPOSITORY / "tests" / "fixtures" / "canonical" / "curl-normal-01.derived.json"
)


def test_real_canonical_fixture_passes_contract_validation() -> None:
    report = validate_fixture(NORMAL_FIXTURE)

    assert report.testId == "curl-normal-01"
    assert report.schemaVersion == "1.1-derived"
    assert report.frameValidation.frameCount == 4395
    assert report.frameValidation.validFrames == 2702
    assert report.frameValidation.invalidFrames == 1693
    assert report.frameValidation.requiredKeypointNamesPresent is True


def test_timestamp_regression_is_rejected(tmp_path: Path) -> None:
    payload = json.loads(NORMAL_FIXTURE.read_text(encoding="utf-8"))
    payload["frames"] = payload["frames"][:2]
    payload["capture"].update(
        {
            "frameCount": 2,
            "validFrames": sum(frame["valid"] for frame in payload["frames"]),
            "invalidFrames": sum(not frame["valid"] for frame in payload["frames"]),
            "durationMs": 30.8,
        }
    )
    payload["frames"][1]["timestampMs"] = payload["frames"][0]["timestampMs"] - 1
    invalid_fixture = tmp_path / "invalid.json"
    invalid_fixture.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(FixtureValidationError, match="timestamp must be monotonic"):
        validate_fixture(invalid_fixture)

