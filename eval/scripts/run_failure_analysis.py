"""Run brutal adversarial failure-mode analysis across retrieval strategies."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.evaluation.failure_analysis import run_all_strategies, run_adversarial_pipeline  # noqa: E402


def _summary(payload: dict) -> dict:
    return {
        strategy: {
            "pass_rate": result["pass_rate"],
            "break_rate": result["break_rate"],
            "failed": result["failed"],
            "num_questions": result["num_questions"],
            "top_failures": result["failure_counts"],
        }
        for strategy, result in payload.items()
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Adversarial failure-mode eval for rag-system")
    parser.add_argument("--config", default=str(ROOT / "configs" / "adversarial.yaml"))
    parser.add_argument("--failure-modes", default=str(ROOT / "configs" / "failure_modes.yaml"))
    parser.add_argument("--strategy", choices=["vector", "bm25", "hybrid", "router"], default=None)
    parser.add_argument("--guarded", action="store_true", help="Enable OOD + poison guardrails")
    parser.add_argument("--both", action="store_true", help="Write baseline and guarded artifacts")
    parser.add_argument("--out", default=str(ROOT / "results" / "failure_analysis.json"))
    args = parser.parse_args()

    results_dir = ROOT / "results"

    if args.both:
        baseline = run_all_strategies(args.config, failure_modes_path=args.failure_modes, use_guard=False)
        guarded = run_all_strategies(args.config, failure_modes_path=args.failure_modes, use_guard=True)
        comparison = {
            "baseline": baseline,
            "guarded": guarded,
            "delta_pass_rate": {
                strategy: round(guarded[strategy]["pass_rate"] - baseline[strategy]["pass_rate"], 3)
                for strategy in baseline
            },
        }
        baseline_path = results_dir / "failure_analysis_baseline.json"
        guarded_path = results_dir / "failure_analysis_guarded.json"
        comparison_path = results_dir / "failure_analysis_comparison.json"
        baseline_path.write_text(json.dumps(baseline, indent=2), encoding="utf-8")
        guarded_path.write_text(json.dumps(guarded, indent=2), encoding="utf-8")
        comparison_path.write_text(json.dumps(comparison, indent=2), encoding="utf-8")
        print(json.dumps({"baseline": _summary(baseline), "guarded": _summary(guarded), "delta_pass_rate": comparison["delta_pass_rate"]}, indent=2))
        print(f"\nSaved: {baseline_path}")
        print(f"Saved: {guarded_path}")
        print(f"Saved: {comparison_path}")
        return

    use_guard = args.guarded
    if args.strategy:
        payload = {
            args.strategy: run_adversarial_pipeline(
                args.config,
                strategy=args.strategy,
                failure_modes_path=args.failure_modes,
                use_guard=use_guard,
            )
        }
    else:
        payload = run_all_strategies(
            args.config,
            failure_modes_path=args.failure_modes,
            use_guard=use_guard,
        )

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(_summary(payload), indent=2))
    print(f"\nSaved: {out_path}")


if __name__ == "__main__":
    main()