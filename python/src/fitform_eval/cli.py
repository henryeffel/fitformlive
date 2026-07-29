from __future__ import annotations

import argparse
import json
from pathlib import Path

from .cycles import (
    CycleAnalysisPaths,
    build_cycle_feature_table,
    write_analysis_outputs,
)
from .validator import validate_fixture
from .robustness import run_robustness_analysis
from .evaluator import evaluate_batch


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="fitform-eval")
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_parser = subparsers.add_parser(
        "validate-fixture", help="Validate a canonical pose fixture"
    )
    validate_parser.add_argument("fixture", type=Path)

    cycle_parser = subparsers.add_parser(
        "analyze-cycles", help="Compare aligned and unmatched normal cycles"
    )
    cycle_parser.add_argument("--fixture", type=Path, required=True)
    cycle_parser.add_argument("--cycles", type=Path, required=True)
    cycle_parser.add_argument("--trace", type=Path, required=True)
    cycle_parser.add_argument("--output", type=Path, required=True)

    robustness_parser = subparsers.add_parser(
        "robustness-sweep",
        help="Run an enhanced-FSM in-sample parameter sweep through Node.js",
    )
    robustness_parser.add_argument("--repository", type=Path, required=True)
    robustness_parser.add_argument("--output", type=Path, required=True)
    robustness_parser.add_argument("--threshold-min", type=int, default=25)
    robustness_parser.add_argument("--threshold-max", type=int, default=60)
    robustness_parser.add_argument("--threshold-step", type=int, default=1)
    robustness_parser.add_argument("--hold-min", type=int, default=0)
    robustness_parser.add_argument("--hold-max", type=int, default=500)
    robustness_parser.add_argument("--hold-step", type=int, default=50)
    robustness_parser.add_argument("--hysteresis", type=float, default=8)

    batch_parser = subparsers.add_parser(
        "evaluate-batch",
        help="Evaluate predicted rep events against cycle-level annotations",
    )
    batch_parser.add_argument("--manifest", type=Path, required=True)
    batch_parser.add_argument("--output", type=Path, required=True)
    batch_parser.add_argument("--tolerance-ms", type=float, default=500)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "validate-fixture":
        report = validate_fixture(args.fixture)
        print(report.model_dump_json(indent=2))
        return 0
    if args.command == "analyze-cycles":
        table = build_cycle_feature_table(
            CycleAnalysisPaths(
                fixture=args.fixture,
                cycles_csv=args.cycles,
                trace_json=args.trace,
            )
        )
        outputs = write_analysis_outputs(table, args.output)
        print(
            json.dumps(
                {key: str(value) for key, value in outputs.items()},
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    if args.command == "evaluate-batch":
        outputs = evaluate_batch(
            args.manifest.resolve(),
            args.output.resolve(),
            tolerance_ms=args.tolerance_ms,
        )
        print(
            json.dumps(
                {key: str(value) for key, value in outputs.items()},
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    if args.command == "robustness-sweep":
        thresholds = list(
            range(
                args.threshold_min,
                args.threshold_max + 1,
                args.threshold_step,
            )
        )
        hold_times = list(
            range(args.hold_min, args.hold_max + 1, args.hold_step)
        )
        outputs = run_robustness_analysis(
            args.repository.resolve(),
            args.output.resolve(),
            thresholds=thresholds,
            hold_times_ms=hold_times,
            hysteresis=args.hysteresis,
        )
        print(
            json.dumps(
                {key: str(value) for key, value in outputs.items()},
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
