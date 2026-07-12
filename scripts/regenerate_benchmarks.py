"""Regenerate committed benchmark JSON artifacts and comparison chart."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVAL_ROOT = ROOT / "eval"
sys.path.insert(0, str(EVAL_ROOT))

from src.pipeline import run_pipeline  # noqa: E402


def main() -> None:
    strategies = ["vector", "bm25", "hybrid", "router"]
    config_path = EVAL_ROOT / "configs" / "default.yaml"

    baseline = run_pipeline(config_path, strategy="vector")
    (EVAL_ROOT / "results" / "baseline_by_category.json").write_text(
        json.dumps(baseline, indent=2),
        encoding="utf-8",
    )

    comparison: dict[str, dict] = {}
    for strategy in strategies:
        results = run_pipeline(config_path, strategy=strategy)
        comparison[strategy] = {
            "config": results["config"],
            "num_questions": results["num_questions"],
            "metrics": results["metrics"],
            "metrics_by_category": results["metrics_by_category"],
        }

    hybrid_path = EVAL_ROOT / "results" / "hybrid_by_category.json"
    hybrid_path.write_text(json.dumps(comparison, indent=2), encoding="utf-8")

    router_path = EVAL_ROOT / "results" / "router_by_category.json"
    router_path.write_text(json.dumps(comparison, indent=2), encoding="utf-8")

    chart_path = EVAL_ROOT / "results" / "comparison.png"
    _write_chart(comparison, chart_path)

    print(json.dumps({k: v["metrics"] for k, v in comparison.items()}, indent=2))
    print(f"Saved baseline, hybrid/router comparison, and {chart_path}")


def _write_chart(comparison: dict[str, dict], path: Path) -> None:
    import matplotlib.pyplot as plt

    strategies = list(comparison.keys())
    categories = sorted(
        {
            category
            for payload in comparison.values()
            for category in payload["metrics_by_category"].keys()
        }
    )
    metric_key = "retrieval.recall_at_k"

    x_labels = [f"{cat}\n({strategy})" for cat in categories for strategy in strategies]
    values = [
        comparison[strategy]["metrics_by_category"][category]["metrics"][metric_key]
        for category in categories
        for strategy in strategies
    ]
    colors = ["#f2a7c6", "#ff85c8", "#c77dff", "#9a7a8a"] * len(categories)

    fig, ax = plt.subplots(figsize=(12, 5))
    bars = ax.bar(range(len(x_labels)), values, color=colors[: len(x_labels)], edgecolor="#1a1a1a", linewidth=0.6)
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("Recall@k")
    ax.set_title("Retrieval recall@k by query category and strategy")
    ax.set_xticks(range(len(x_labels)))
    ax.set_xticklabels(x_labels, rotation=35, ha="right", fontsize=8)
    ax.axhline(1.0, color="#dddddd", linewidth=0.8, linestyle="--")
    for bar, value in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width() / 2, value + 0.03, f"{value:.2f}", ha="center", fontsize=7)

    handles = [plt.Rectangle((0, 0), 1, 1, color=color) for color in ["#f2a7c6", "#ff85c8", "#c77dff", "#9a7a8a"]]
    ax.legend(handles, strategies, loc="upper right", fontsize=8)
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=160)
    plt.close(fig)


if __name__ == "__main__":
    main()