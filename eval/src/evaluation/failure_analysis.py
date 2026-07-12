from __future__ import annotations

import json
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import yaml

from src.evaluation.metrics import citation_coverage, faithfulness, mrr, ndcg_at_k, recall_at_k
from src.ingestion.loaders import load_documents
from src.pipeline import (
    build_chunks,
    build_search,
    generate_answer,
    load_config,
    load_questions,
    resolve_project_path,
)


def _hit_value(hit: Any, key: str, default: Any = "") -> Any:
    if isinstance(hit, dict):
        return hit.get(key, default)
    return getattr(hit, key, default)

SearchFn = Callable[[str, int], list[Any]]

REFUSAL_PREFIX = "No supporting context retrieved."


def load_failure_config(path: str | Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def grade_adversarial_row(
    item: dict,
    hits: list[Any],
    answer: str,
    contexts: list[str],
    k: int,
    faithfulness_min: float = 0.6,
) -> dict[str, Any]:
    retrieved_doc_ids = [str(_hit_value(hit, "doc_id")) for hit in hits]
    gold_doc_ids = [str(doc_id) for doc_id in item.get("gold_doc_ids", [])]
    forbidden_doc_ids = [str(doc_id) for doc_id in item.get("forbidden_doc_ids", [])]
    forbidden_phrases = [p.lower() for p in item.get("forbidden_phrases", [])]
    expect_refusal = bool(item.get("expect_refusal"))
    min_gold_in_topk = int(item.get("min_gold_in_topk", 1 if gold_doc_ids else 0))

    answer_lower = answer.lower()
    failures: list[str] = []

    recall = recall_at_k(retrieved_doc_ids, gold_doc_ids, k) if gold_doc_ids else 0.0
    faith = faithfulness(answer, contexts)
    cites = citation_coverage(answer, contexts)

    if expect_refusal:
        if answer.strip() != REFUSAL_PREFIX:
            failures.append("ood_answered")
        if retrieved_doc_ids:
            failures.append("ood_retrieved")

    if gold_doc_ids:
        if recall < 1.0:
            failures.append("retrieval_miss")
        if retrieved_doc_ids and retrieved_doc_ids[0] not in gold_doc_ids:
            failures.append("wrong_top1")
        if min_gold_in_topk > 1:
            gold_in_top = len(set(retrieved_doc_ids[:k]) & set(gold_doc_ids))
            if gold_in_top < min_gold_in_topk:
                failures.append("multi_hop_miss")

    if forbidden_doc_ids:
        if any(doc_id in retrieved_doc_ids[:k] for doc_id in forbidden_doc_ids):
            failures.append("poison_in_topk")
        if retrieved_doc_ids and retrieved_doc_ids[0] in forbidden_doc_ids:
            failures.append("poison_top1")

    for phrase in forbidden_phrases:
        if phrase and phrase in answer_lower:
            failures.append("forbidden_claim")
            break

    if gold_doc_ids and not expect_refusal and faith < faithfulness_min:
        failures.append("low_faithfulness")

    return {
        "id": item.get("id"),
        "category": item.get("category", "uncategorized"),
        "failure_mode": item.get("failure_mode", item.get("category", "uncategorized")),
        "passed": len(failures) == 0,
        "failures": failures,
        "retrieved_doc_ids": retrieved_doc_ids[:k],
        "gold_doc_ids": gold_doc_ids,
        "answer_excerpt": answer[:220],
        "metrics": {
            "retrieval.recall_at_k": round(recall, 3),
            "retrieval.mrr": round(mrr(retrieved_doc_ids, gold_doc_ids), 3) if gold_doc_ids else 0.0,
            "retrieval.ndcg_at_k": round(ndcg_at_k(retrieved_doc_ids, gold_doc_ids, k), 3) if gold_doc_ids else 0.0,
            "gen.faithfulness": round(faith, 3),
            "gen.citation_coverage": round(cites, 3),
        },
    }


def evaluate_adversarial_questions(
    questions: list[dict],
    search: SearchFn,
    top_k: int,
    k: int,
    config: str | dict,
    failure_rules: dict | None = None,
    started: float | None = None,
) -> dict:
    started = started if started is not None else time.perf_counter()
    failure_rules = failure_rules or {}
    faithfulness_min = float(failure_rules.get("thresholds", {}).get("faithfulness_min", 0.6))

    rows: list[dict] = []
    for item in questions:
        t0 = time.perf_counter()
        hits = search(item["question"], top_k)
        latency_ms = (time.perf_counter() - t0) * 1000
        answer = generate_answer(item["question"], hits)
        contexts = [str(_hit_value(hit, "text")) for hit in hits]
        graded = grade_adversarial_row(item, hits, answer, contexts, k, faithfulness_min)
        graded["latency_ms"] = round(latency_ms, 1)
        rows.append(graded)

    return _summarize_adversarial(rows, config, started)


def _summarize_adversarial(rows: list[dict], config: str | dict, started: float) -> dict:
    total = len(rows)
    passed = sum(1 for row in rows if row["passed"])
    failure_counts: dict[str, int] = {}
    by_mode: dict[str, list[dict]] = {}
    by_category: dict[str, list[dict]] = {}

    for row in rows:
        by_mode.setdefault(row["failure_mode"], []).append(row)
        by_category.setdefault(row["category"], []).append(row)
        for failure in row["failures"]:
            failure_counts[failure] = failure_counts.get(failure, 0) + 1

    def _mode_summary(mode_rows: list[dict]) -> dict:
        mode_pass = sum(1 for row in mode_rows if row["passed"])
        return {
            "num_questions": len(mode_rows),
            "passed": mode_pass,
            "failed": len(mode_rows) - mode_pass,
            "pass_rate": round(mode_pass / max(1, len(mode_rows)), 3),
        }

    return {
        "config": config,
        "num_questions": total,
        "passed": passed,
        "failed": total - passed,
        "pass_rate": round(passed / max(1, total), 3),
        "break_rate": round((total - passed) / max(1, total), 3),
        "failure_counts": dict(sorted(failure_counts.items())),
        "metrics_by_failure_mode": {mode: _mode_summary(mode_rows) for mode, mode_rows in sorted(by_mode.items())},
        "metrics_by_category": {cat: _mode_summary(cat_rows) for cat, cat_rows in sorted(by_category.items())},
        "questions": rows,
        "runtime.total_s": round(time.perf_counter() - started, 2),
    }


def run_adversarial_pipeline(
    config_path: str | Path,
    strategy: str | None = None,
    failure_modes_path: str | Path | None = None,
) -> dict:
    cfg = load_config(config_path)
    failure_rules = load_failure_config(failure_modes_path or Path(config_path).parent / "failure_modes.yaml")
    strategy = strategy or cfg["retrieval"].get("strategy", "vector")
    started = time.perf_counter()

    docs = load_documents(resolve_project_path(config_path, cfg["data"]["raw_dir"]))
    chunks = build_chunks(
        docs,
        cfg["ingestion"]["chunk_size"],
        cfg["ingestion"]["chunk_overlap"],
    )
    search = build_search(chunks, cfg, strategy=strategy)
    questions = load_questions(resolve_project_path(config_path, cfg["data"]["questions_file"]))

    return evaluate_adversarial_questions(
        questions=questions,
        search=search,
        top_k=cfg["retrieval"]["top_k"],
        k=cfg["evaluation"]["k"],
        config={
            "source": "adversarial_eval",
            "config_path": str(config_path),
            "strategy": strategy,
            "corpus_docs": len(docs),
            "includes_poison_doc": True,
        },
        failure_rules=failure_rules,
        started=started,
    )


def run_all_strategies(
    config_path: str | Path,
    strategies: list[str] | None = None,
    failure_modes_path: str | Path | None = None,
) -> dict:
    strategies = strategies or ["vector", "bm25", "hybrid", "router"]
    comparison = {}
    for strategy in strategies:
        comparison[strategy] = run_adversarial_pipeline(
            config_path,
            strategy=strategy,
            failure_modes_path=failure_modes_path,
        )
    return comparison