from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


FEATURE_COLUMNS = [
    "processed_min_angle",
    "processed_max_angle",
    "observed_processed_rom",
    "duration_ms",
    "contraction_hold_ms",
    "extension_hold_ms",
    "peak_abs_angular_velocity_deg_per_sec",
    "median_abs_angular_velocity_deg_per_sec",
    "mean_required_joint_confidence",
    "min_required_joint_confidence",
    "invalid_frame_ratio",
    "gap_from_previous_rep_ms",
    "reset_count",
    "recovery_count",
]


@dataclass(frozen=True)
class CycleAnalysisPaths:
    fixture: Path
    cycles_csv: Path
    trace_json: Path


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _browser_rep_timestamps(fixture_payload: dict[str, Any]) -> list[float]:
    return [
        float(event["timestampMs"])
        for event in fixture_payload.get("events", [])
        if event.get("type") == "REP_COUNTED"
    ]


def align_cycles_to_labels(
    cycle_timestamps: list[float], label_timestamps: list[float]
) -> list[dict[str, Any]]:
    """Order-preserving minimum-distance alignment matching the JS trace analyzer."""
    cycle_count = len(cycle_timestamps)
    label_count = len(label_timestamps)
    if label_count == 0:
        return [
            {
                "matched": False,
                "label_index": None,
                "label_timestamp_ms": None,
                "alignment_distance_ms": None,
            }
            for _ in cycle_timestamps
        ]

    costs = np.full((cycle_count + 1, label_count + 1), np.inf)
    choices = np.empty((cycle_count + 1, label_count + 1), dtype=object)
    costs[:, 0] = 0
    choices[:, 0] = "skip"

    for cycle_index in range(1, cycle_count + 1):
        for label_index in range(1, min(label_count, cycle_index) + 1):
            skip = costs[cycle_index - 1, label_index]
            match = costs[cycle_index - 1, label_index - 1] + abs(
                cycle_timestamps[cycle_index - 1]
                - label_timestamps[label_index - 1]
            )
            if match <= skip:
                costs[cycle_index, label_index] = match
                choices[cycle_index, label_index] = "match"
            else:
                costs[cycle_index, label_index] = skip
                choices[cycle_index, label_index] = "skip"

    alignment = [
        {
            "matched": False,
            "label_index": None,
            "label_timestamp_ms": None,
            "alignment_distance_ms": None,
        }
        for _ in cycle_timestamps
    ]
    cycle_index = cycle_count
    label_index = min(label_count, cycle_count)
    while cycle_index > 0 and label_index > 0:
        if choices[cycle_index, label_index] == "match":
            timestamp = label_timestamps[label_index - 1]
            alignment[cycle_index - 1] = {
                "matched": True,
                "label_index": label_index,
                "label_timestamp_ms": timestamp,
                "alignment_distance_ms": abs(
                    cycle_timestamps[cycle_index - 1] - timestamp
                ),
            }
            cycle_index -= 1
            label_index -= 1
        else:
            cycle_index -= 1
    return alignment


def build_cycle_feature_table(paths: CycleAnalysisPaths) -> pd.DataFrame:
    cycles = pd.read_csv(paths.cycles_csv)
    trace_payload = _load_json(paths.trace_json)
    fixture_payload = _load_json(paths.fixture)
    trace = pd.DataFrame(trace_payload["trace"])

    alignment = align_cycles_to_labels(
        cycles["rep_counted_at_ms"].astype(float).tolist(),
        _browser_rep_timestamps(fixture_payload),
    )
    alignment_frame = pd.DataFrame(alignment)
    cycles = pd.concat([cycles.reset_index(drop=True), alignment_frame], axis=1)
    cycles["group"] = np.where(cycles["matched"], "aligned", "unmatched")

    trace["requiredJointMinConfidence"] = pd.to_numeric(
        trace["requiredJointMinConfidence"], errors="coerce"
    )
    trace["angularVelocityDegPerSec"] = pd.to_numeric(
        trace["angularVelocityDegPerSec"], errors="coerce"
    )
    rows: list[dict[str, Any]] = []

    for cycle in cycles.to_dict(orient="records"):
        window = trace[
            (trace["timestampMs"] >= cycle["contraction_confirmed_at_ms"])
            & (trace["timestampMs"] <= cycle["rep_counted_at_ms"])
        ].copy()
        velocities = window["angularVelocityDegPerSec"].dropna().abs()
        confidence = window["requiredJointMinConfidence"].dropna()
        valid = window["valid"].astype(bool)

        row = dict(cycle)
        row.update(
            {
                "frame_count": int(len(window)),
                "valid_frame_count": int(valid.sum()),
                "invalid_frame_count": int((~valid).sum()),
                "invalid_frame_ratio": float((~valid).mean())
                if len(valid)
                else np.nan,
                "mean_required_joint_confidence": float(confidence.mean())
                if len(confidence)
                else np.nan,
                "min_required_joint_confidence": float(confidence.min())
                if len(confidence)
                else np.nan,
                "peak_abs_angular_velocity_deg_per_sec": float(velocities.max())
                if len(velocities)
                else np.nan,
                "median_abs_angular_velocity_deg_per_sec": float(
                    velocities.median()
                )
                if len(velocities)
                else np.nan,
            }
        )
        rows.append(row)

    return pd.DataFrame(rows)


def _finite(values: pd.Series) -> np.ndarray:
    return values.replace([np.inf, -np.inf], np.nan).dropna().to_numpy(dtype=float)


def summarize_groups(table: pd.DataFrame) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "cycleCount": int(len(table)),
        "groups": {},
        "interpretation": {
            "scope": (
                "Kinematic similarity can be assessed, but the physical meaning of "
                "unmatched cycles cannot be confirmed without synchronized video and "
                "cycle-level ground truth."
            )
        },
    }
    for group_name, group in table.groupby("group", sort=False):
        features: dict[str, Any] = {}
        for column in FEATURE_COLUMNS:
            values = _finite(group[column])
            if not len(values):
                continue
            q1, median, q3 = np.percentile(values, [25, 50, 75])
            features[column] = {
                "count": int(len(values)),
                "min": float(values.min()),
                "q1": float(q1),
                "median": float(median),
                "q3": float(q3),
                "max": float(values.max()),
                "iqr": float(q3 - q1),
            }
        summary["groups"][group_name] = {
            "cycleCount": int(len(group)),
            "cycles": [int(value) for value in group["cycle"].tolist()],
            "features": features,
        }
    return summary


def render_feature_strip_svg(table: pd.DataFrame, output: Path) -> None:
    features = [
        ("processed_min_angle", "Minimum angle", "deg"),
        ("observed_processed_rom", "Observed ROM", "deg"),
        ("duration_ms", "Cycle duration", "ms"),
        (
            "peak_abs_angular_velocity_deg_per_sec",
            "Peak angular velocity",
            "deg/s",
        ),
        ("invalid_frame_ratio", "Invalid frame ratio", "ratio"),
    ]
    width, row_height = 920, 92
    height = 70 + row_height * len(features)
    plot_left, plot_right = 230, 880
    colors = {"aligned": "#335cff", "unmatched": "#e9553d"}
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" '
        f'height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="#fffef9"/>',
        '<text x="28" y="32" font-family="Arial,sans-serif" font-size="19" '
        'font-weight="700" fill="#11140f">10 aligned vs 3 unmatched cycles</text>',
        '<circle cx="655" cy="27" r="5" fill="#335cff"/>',
        '<text x="666" y="31" font-family="Arial,sans-serif" font-size="10" '
        'fill="#11140f">aligned (n=10)</text>',
        '<circle cx="777" cy="27" r="5" fill="#e9553d"/>',
        '<text x="788" y="31" font-family="Arial,sans-serif" font-size="10" '
        'fill="#11140f">unmatched (n=3)</text>',
    ]
    for row_index, (column, label, unit) in enumerate(features):
        y = 78 + row_index * row_height
        values = _finite(table[column])
        minimum = float(values.min())
        maximum = float(values.max())
        padding = (maximum - minimum) * 0.08 or 1.0
        low, high = minimum - padding, maximum + padding

        def x_position(value: float) -> float:
            return plot_left + (value - low) / (high - low) * (
                plot_right - plot_left
            )

        parts.extend(
            [
                f'<text x="28" y="{y + 8}" font-family="Arial,sans-serif" '
                f'font-size="12" font-weight="700" fill="#11140f">{label}</text>',
                f'<text x="28" y="{y + 26}" font-family="Arial,sans-serif" '
                f'font-size="9" fill="#65685f">{minimum:.2f}–{maximum:.2f} {unit}</text>',
                f'<line x1="{plot_left}" y1="{y + 14}" x2="{plot_right}" '
                'y2="{0}" stroke="#c9c9bf"/>'.format(y + 14),
            ]
        )
        for group_name, vertical_offset in (("aligned", -7), ("unmatched", 7)):
            group = table[table["group"] == group_name]
            for point_index, value in enumerate(group[column]):
                if pd.isna(value):
                    continue
                jitter = ((point_index % 3) - 1) * 2
                parts.append(
                    f'<circle cx="{x_position(float(value)):.2f}" '
                    f'cy="{y + 14 + vertical_offset + jitter}" r="4.5" '
                    f'fill="{colors[group_name]}" stroke="#fffef9" stroke-width="1"/>'
                )
        parts.extend(
            [
                f'<text x="{plot_left}" y="{y + 45}" text-anchor="start" '
                f'font-family="Arial,sans-serif" font-size="8" fill="#65685f">{low:.2f}</text>',
                f'<text x="{plot_right}" y="{y + 45}" text-anchor="end" '
                f'font-family="Arial,sans-serif" font-size="8" fill="#65685f">{high:.2f}</text>',
            ]
        )
    parts.append("</svg>")
    output.write_text("\n".join(parts), encoding="utf-8")


def write_analysis_outputs(
    table: pd.DataFrame, output_directory: Path
) -> dict[str, Path]:
    output_directory.mkdir(parents=True, exist_ok=True)
    csv_path = output_directory / "normal-cycle-features.csv"
    json_path = output_directory / "normal-cycle-comparison.json"
    svg_path = output_directory / "normal-cycle-feature-strip.svg"
    table.to_csv(csv_path, index=False)
    json_path.write_text(
        json.dumps(summarize_groups(table), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    render_feature_strip_svg(table, svg_path)
    return {"csv": csv_path, "json": json_path, "svg": svg_path}

