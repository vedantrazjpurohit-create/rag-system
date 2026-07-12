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


def main() -> None:
    parser = argparse.ArgumentParser(description="Adversarial failure-mode eval for rag-system")
    parser.add_argument("--config", default=str(ROOT / "configs" / "adversarial.yaml"))
    parser.add_argument("--failure-modes", default=str(ROOT / "configs" / "failure_modes.yaml"))
    parser.add_argument("--strategy", choices=["vector", "bm25", "hybrid", "router"], default=None)
    parser.add_argument("--out", default=str(ROOT / "results" / "failure_analysis.json"))
    args = parser.parse_args()

    if args.strategy:
        payload = {
            args.strategy: run_adversarial_pipeline(
                args.config,
                strategy=args.strategy,
                failure_modes_path=args.failure_modes,
            )
        }
    else:
        payload = run_all_strategies(
            args.config,
            failure_modes_path=args.failure_modes,
        )

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    summary = {
        strategy: {
            "pass_rate": result["pass_rate"],
            "break_rate": result["break_rate"],
            "failed": result["failed"],
            "num_questions": result["num_questions"],
            "top_failures": result["failure_counts"],
        }
        for strategy, result in payload.items()
    }
    print(json.dumps(summary, indent=2))
    print(f"\nSaved: {out_path}")


if __name__ == "__main__":
    main()