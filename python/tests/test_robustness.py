from __future__ import annotations

import pandas as pd

from fitform_eval.robustness import (
    generate_configurations,
    summarize_stability,
)


def test_configuration_grid_is_deterministic() -> None:
    configurations = generate_configurations(
        thresholds=[34, 35, 36],
        hold_times_ms=[100, 200],
    )

    assert len(configurations) == 6
    assert configurations[0]["configurationId"] == "fc-34__hold-100"
    assert configurations[-1]["configurationId"] == "fc-36__hold-200"
    assert all(item["hysteresis"] == 8 for item in configurations)


def test_stability_summary_finds_contiguous_threshold_ranges() -> None:
    rows = []
    for hold_ms in [100, 200]:
        for threshold in [34, 35, 36, 37, 38]:
            stable = (hold_ms == 100 and 35 <= threshold <= 37) or (
                hold_ms == 200 and 36 <= threshold <= 38
            )
            rows.append(
                {
                    "holdMs": hold_ms,
                    "fullContractAngle": threshold,
                    "stable": stable,
                    "fullSafetyStable": stable,
                    "movementDefinitionStable": stable,
                }
            )
    summary = summarize_stability(pd.DataFrame(rows), threshold_step=1)

    assert summary["stableConfigurationCount"] == 6
    assert summary["rangesByHold"][0]["stableRangesDeg"] == [[35.0, 37.0]]
    assert summary["rangesByHold"][1]["stableRangesDeg"] == [[36.0, 38.0]]
    assert summary["independentValidation"] is False
