from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Iterable

import pandas as pd


def generate_configurations(
    thresholds: Iterable[float],
    hold_times_ms: Iterable[int],
    *,
    hysteresis: float = 8,
    contract_start_angle: float = 60,
    full_extend_angle: float = 155,
) -> list[dict[str, Any]]:
    configurations: list[dict[str, Any]] = []
    for hold_ms in hold_times_ms:
        for threshold in thresholds:
            configurations.append(
                {
                    "configurationId": f"fc-{threshold:g}__hold-{hold_ms}",
                    "contractStartAngle": contract_start_angle,
                    "fullContractAngle": float(threshold),
                    "fullExtendAngle": full_extend_angle,
                    "hysteresis": hysteresis,
                    "holdMs": int(hold_ms),
                }
            )
    return configurations


def invoke_javascript_sweep(
    repository: Path,
    configurations: list[dict[str, Any]],
    output_directory: Path,
) -> Path:
    output_directory.mkdir(parents=True, exist_ok=True)
    config_path = output_directory / "sweep-configurations.json"
    raw_path = output_directory / "sweep-raw-results.json"
    config_path.write_text(
        json.dumps(configurations, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    command = [
        "node",
        str(repository / "scripts" / "run-enhanced-fsm-sweep.js"),
        "--fixtures",
        str(repository / "tests" / "fixtures" / "canonical"),
        "--configs",
        str(config_path),
        "--output",
        str(raw_path),
    ]
    subprocess.run(command, check=True, cwd=repository)
    return raw_path


def load_sweep_table(raw_path: Path, *, normal_target: int = 13) -> pd.DataFrame:
    payload = json.loads(raw_path.read_text(encoding="utf-8"))
    table = pd.DataFrame(payload["results"])
    table["normalMaintained"] = table["normalPredictedReps"] == normal_target
    table["boundarySafe"] = table["boundaryPredictedReps"] == 0
    table["trackingFailureSafe"] = (
        table["trackingFailurePredictedReps"] == 0
    )
    table["movementDefinitionStable"] = (
        table["normalMaintained"] & table["boundarySafe"]
    )
    table["fullSafetyStable"] = (
        table["movementDefinitionStable"] & table["trackingFailureSafe"]
    )
    table["stable"] = table["fullSafetyStable"]
    return table.sort_values(["holdMs", "fullContractAngle"]).reset_index(drop=True)


def _contiguous_ranges(values: list[float], step: float) -> list[list[float]]:
    if not values:
        return []
    ranges: list[list[float]] = [[values[0], values[0]]]
    for value in values[1:]:
        if abs(value - ranges[-1][1] - step) < 1e-9:
            ranges[-1][1] = value
        else:
            ranges.append([value, value])
    return ranges


def summarize_stability(
    table: pd.DataFrame, *, threshold_step: float
) -> dict[str, Any]:
    stable = table[table["fullSafetyStable"]]
    movement_stable = table[table["movementDefinitionStable"]]
    ranges_by_hold: list[dict[str, Any]] = []
    movement_ranges_by_hold: list[dict[str, Any]] = []
    for hold_ms, group in table.groupby("holdMs", sort=True):
        stable_thresholds = sorted(
            group.loc[group["fullSafetyStable"], "fullContractAngle"]
            .astype(float)
            .tolist()
        )
        movement_thresholds = sorted(
            group.loc[group["movementDefinitionStable"], "fullContractAngle"]
            .astype(float)
            .tolist()
        )
        ranges_by_hold.append(
            {
                "holdMs": int(hold_ms),
                "stableThresholdCount": len(stable_thresholds),
                "stableRangesDeg": _contiguous_ranges(
                    stable_thresholds, threshold_step
                ),
            }
        )
        movement_ranges_by_hold.append(
            {
                "holdMs": int(hold_ms),
                "stableThresholdCount": len(movement_thresholds),
                "stableRangesDeg": _contiguous_ranges(
                    movement_thresholds, threshold_step
                ),
            }
        )

    threshold_summary = (
        stable.groupby("fullContractAngle")["holdMs"]
        .agg(["min", "max", "count"])
        .reset_index()
        if not stable.empty
        else pd.DataFrame()
    )
    stable_thresholds = [
        {
            "fullContractAngle": float(row["fullContractAngle"]),
            "minHoldMs": int(row["min"]),
            "maxHoldMs": int(row["max"]),
            "stableHoldCount": int(row["count"]),
        }
        for row in threshold_summary.to_dict(orient="records")
    ]
    return {
        "analysisVersion": "1.0",
        "scope": "in-sample robustness on three existing canonical fixtures",
        "independentValidation": False,
        "criteria": {
            "normalPredictedReps": 13,
            "boundaryPredictedReps": 0,
            "trackingFailurePredictedReps": 0,
        },
        "configurationCount": int(len(table)),
        "stableConfigurationCount": int(table["stable"].sum()),
        "stableConfigurationRate": float(table["stable"].mean()),
        "movementDefinitionStableConfigurationCount": int(
            table["movementDefinitionStable"].sum()
        ),
        "movementDefinitionStableConfigurationRate": float(
            table["movementDefinitionStable"].mean()
        ),
        "rangesByHold": ranges_by_hold,
        "movementDefinitionRangesByHold": movement_ranges_by_hold,
        "stableThresholds": stable_thresholds,
        "limitations": [
            "The same fixtures are used for exploratory threshold selection and robustness analysis.",
            "Confidence and invalid-reset parameters are fixed in the upstream F_FULL trace.",
            "The result demonstrates an in-sample stable region, not user-level generalization.",
        ],
        "finding": (
            "No configuration preserved normal=13, boundary=0, and "
            "tracking-failure=0 simultaneously."
            if stable.empty and not movement_stable.empty
            else "See stability ranges for the observed in-sample result."
        ),
    }


def render_robustness_heatmap(table: pd.DataFrame, output: Path) -> None:
    thresholds = sorted(table["fullContractAngle"].unique())
    holds = sorted(table["holdMs"].unique())
    cell_width, cell_height = 16, 24
    left, top = 120, 62
    width = left + len(thresholds) * cell_width + 45
    height = top + len(holds) * cell_height + 62
    lookup = {
        (float(row.fullContractAngle), int(row.holdMs)): row
        for row in table.itertuples()
    }

    def color(row: Any) -> str:
        if row.fullSafetyStable:
            return "#ceff2f"
        if row.movementDefinitionStable:
            return "#dce4ff"
        if not row.trackingFailureSafe:
            return "#e9553d"
        if not row.boundarySafe:
            return "#f5a623"
        if not row.normalMaintained:
            return "#8ca4ff"
        return "#d9d9d2"

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" '
        f'height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="#fffef9"/>',
        '<text x="20" y="28" font-family="Arial,sans-serif" font-size="17" '
        'font-weight="700" fill="#11140f">Enhanced FSM in-sample robustness</text>',
        '<text x="20" y="45" font-family="Arial,sans-serif" font-size="9" '
        'fill="#65685f">Green = full safety · blue = normal 13 and boundary 0 only</text>',
    ]
    for row_index, hold_ms in enumerate(holds):
        y = top + row_index * cell_height
        parts.append(
            f'<text x="{left - 10}" y="{y + 15}" text-anchor="end" '
            f'font-family="Arial,sans-serif" font-size="8" fill="#11140f">{hold_ms}ms</text>'
        )
        for column_index, threshold in enumerate(thresholds):
            x = left + column_index * cell_width
            row = lookup[(float(threshold), int(hold_ms))]
            parts.append(
                f'<rect x="{x}" y="{y}" width="{cell_width - 1}" '
                f'height="{cell_height - 1}" fill="{color(row)}" '
                'stroke="#fffef9" stroke-width=".5"/>'
            )
    for column_index, threshold in enumerate(thresholds):
        if column_index % 2:
            continue
        x = left + column_index * cell_width + cell_width / 2
        parts.append(
            f'<text x="{x}" y="{top + len(holds) * cell_height + 14}" '
            f'text-anchor="middle" font-family="Arial,sans-serif" '
            f'font-size="7" fill="#11140f">{threshold:g}°</text>'
        )
    parts.extend(
        [
            f'<text x="{left + len(thresholds) * cell_width / 2}" '
            f'y="{height - 12}" text-anchor="middle" '
            'font-family="Arial,sans-serif" font-size="9" fill="#65685f">'
            "Full contraction threshold</text>",
            f'<text x="20" y="{top + len(holds) * cell_height / 2}" '
            'font-family="Arial,sans-serif" font-size="9" fill="#65685f" '
            'transform="rotate(-90 20 {0})">Hold time</text>'.format(
                top + len(holds) * cell_height / 2
            ),
            "</svg>",
        ]
    )
    output.write_text("\n".join(parts), encoding="utf-8")


def run_robustness_analysis(
    repository: Path,
    output_directory: Path,
    *,
    thresholds: list[float],
    hold_times_ms: list[int],
    hysteresis: float = 8,
) -> dict[str, Path]:
    configurations = generate_configurations(
        thresholds, hold_times_ms, hysteresis=hysteresis
    )
    raw_path = invoke_javascript_sweep(
        repository, configurations, output_directory
    )
    table = load_sweep_table(raw_path)
    csv_path = output_directory / "robustness-results.csv"
    summary_path = output_directory / "robustness-summary.json"
    svg_path = output_directory / "robustness-heatmap.svg"
    table.to_csv(csv_path, index=False)
    step = thresholds[1] - thresholds[0] if len(thresholds) > 1 else 1
    summary_path.write_text(
        json.dumps(
            summarize_stability(table, threshold_step=step),
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    render_robustness_heatmap(table, svg_path)
    return {
        "configurations": output_directory / "sweep-configurations.json",
        "raw": raw_path,
        "csv": csv_path,
        "summary": summary_path,
        "svg": svg_path,
    }
