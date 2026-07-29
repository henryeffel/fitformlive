from __future__ import annotations

from pathlib import Path

import pytest

from fitform_eval.cycles import (
    CycleAnalysisPaths,
    align_cycles_to_labels,
    build_cycle_feature_table,
    summarize_groups,
    write_analysis_outputs,
)


REPOSITORY = Path(__file__).resolve().parents[2]
REP_ANALYSIS = REPOSITORY / "evaluation" / "rep-analysis"
NORMAL_PATHS = CycleAnalysisPaths(
    fixture=(
        REPOSITORY
        / "tests"
        / "fixtures"
        / "canonical"
        / "curl-normal-01.derived.json"
    ),
    cycles_csv=REP_ANALYSIS / "curl-normal-01--F_FULL.cycles.csv",
    trace_json=REP_ANALYSIS / "curl-normal-01--F_FULL.trace.json",
)


def test_order_preserving_alignment_skips_extra_cycles() -> None:
    alignment = align_cycles_to_labels(
        [100, 200, 250, 300],
        [110, 290],
    )

    assert [item["matched"] for item in alignment] == [True, False, False, True]
    assert [item["label_index"] for item in alignment if item["matched"]] == [1, 2]


def test_real_normal_cycle_features_reproduce_10_vs_3_split() -> None:
    table = build_cycle_feature_table(NORMAL_PATHS)

    aligned = table[table["group"] == "aligned"]
    unmatched = table[table["group"] == "unmatched"]
    assert len(table) == 13
    assert aligned["cycle"].tolist() == [1, 2, 3, 4, 5, 6, 10, 11, 12, 13]
    assert unmatched["cycle"].tolist() == [7, 8, 9]
    assert aligned["processed_min_angle"].max() == pytest.approx(
        28.89718227424977
    )
    assert unmatched["invalid_frame_ratio"].between(0, 1).all()
    assert table["peak_abs_angular_velocity_deg_per_sec"].notna().all()


def test_group_summary_and_artifacts_are_deterministic(tmp_path: Path) -> None:
    table = build_cycle_feature_table(NORMAL_PATHS)
    summary = summarize_groups(table)
    first = write_analysis_outputs(table, tmp_path / "first")
    second = write_analysis_outputs(table, tmp_path / "second")

    assert summary["groups"]["aligned"]["cycleCount"] == 10
    assert summary["groups"]["unmatched"]["cycleCount"] == 3
    for artifact in ("csv", "json", "svg"):
        assert first[artifact].read_bytes() == second[artifact].read_bytes()
