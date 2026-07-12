from __future__ import annotations

import json
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import yaml

from src.evaluation.metrics import citation_coverage, faithfulness, mrr, ndcg_at_k, recall_at_k
from src.ingestion.chunker import chunk_text
from src.ingestion.loaders import load_documents
from src.retrieval.bm25 import BM25Index
from src.retrieval.hybrid import HybridRetriever
from src.retrieval.index import RetrievalIndex, stable_chunk_id
from src.retrieval.router import AdaptiveQueryRouter

SearchFn = Callable[[str, int], list[Any]]
SUPPORTED_STRATEGIES = {"vector", "bm25", "hybrid", "router"}
SCORE_KEYS = [
    "retrieval.recall_at_k",
    "retrieval.mrr",
    "retrieval.ndcg_at_k",
    "gen.faithfulness",
    "gen.citation_coverage",
]


def load_config(path: str | Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def resolve_project_path(config_path: str | Path, value: str | Path) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path

    config_file = Path(config_path).resolve()
    project_root = config_file.parent.parent if config_file.parent.name == "configs" else config_file.parent
    return project_root / path


def load_questions(path: str | Path) -> list[dict]:
    questions = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                questions.append(json.loads(line))
    return questions


def build_chunks(docs: list[dict], chunk_size: int, chunk_overlap: int) -> list[dict]:
    chunks: list[dict] = []
    for doc in docs:
        for text in chunk_text(doc["text"], chunk_size, chunk_overlap):
            chunks.append(
                {
                    "id": stable_chunk_id(doc["id"], text),
                    "doc_id": doc["id"],
                    "source": doc["source"],
                    "text": text,
                }
            )
    return chunks


def _hit_value(hit: Any, key: str, default: Any = "") -> Any:
    if isinstance(hit, dict):
        return hit.get(key, default)
    return getattr(hit, key, default)


def generate_answer(question: str, hits: list) -> str:
    """Template answer with lightweight citations; no external LLM required."""
    if not hits:
        return "No supporting context retrieved."

    snippets = []
    for hit in hits[:2]:
        snippet = str(_hit_value(hit, "text")).replace("\n", " ")[:180]
        doc_id = _hit_value(hit, "doc_id", "unknown")
        snippets.append(f"{snippet} [doc_{doc_id}]")

    return f"Based on retrieved notes: {' '.join(snippets)}"


def evaluate_questions(
    questions: list[dict],
    search: SearchFn,
    top_k: int,
    k: int,
    config: str | dict,
    started: float | None = None,
) -> dict:
    started = started if started is not None else time.perf_counter()
    score_rows: list[dict] = []

    for item in questions:
        t0 = time.perf_counter()
        hits = search(item["question"], top_k)
        latency_ms = (time.perf_counter() - t0) * 1000

        retrieved_doc_ids = [str(_hit_value(hit, "doc_id")) for hit in hits]
        answer = generate_answer(item["question"], hits)
        contexts = [str(_hit_value(hit, "text")) for hit in hits]

        score_rows.append(
            {
                "id": item.get("id"),
                "category": item.get("category", "uncategorized"),
                "latency_ms": latency_ms,
                "retrieval.recall_at_k": recall_at_k(retrieved_doc_ids, item["gold_doc_ids"], k),
                "retrieval.mrr": mrr(retrieved_doc_ids, item["gold_doc_ids"]),
                "retrieval.ndcg_at_k": ndcg_at_k(retrieved_doc_ids, item["gold_doc_ids"], k),
                "gen.faithfulness": faithfulness(answer, contexts),
                "gen.citation_coverage": citation_coverage(answer, contexts),
            }
        )

    aggregate_metrics = _summarize_score_rows(score_rows)
    aggregate_metrics["runtime.total_s"] = round(time.perf_counter() - started, 2)

    return {
        "config": config,
        "num_questions": len(questions),
        "metrics": aggregate_metrics,
        "metrics_by_category": _summarize_by_category(score_rows),
    }


def _summarize_score_rows(score_rows: list[dict]) -> dict:
    latencies = sorted(row["latency_ms"] for row in score_rows)
    latencies.sort()
    p50 = latencies[len(latencies) // 2] if latencies else 0.0
    p95 = latencies[int(len(latencies) * 0.95)] if latencies else 0.0

    return {
        **{
            key: round(sum(row[key] for row in score_rows) / max(1, len(score_rows)), 3)
            for key in SCORE_KEYS
        },
        "latency.p50_ms": round(p50, 1),
        "latency.p95_ms": round(p95, 1),
    }


def _summarize_by_category(score_rows: list[dict]) -> dict:
    grouped: dict[str, list[dict]] = {}
    for row in score_rows:
        grouped.setdefault(row["category"], []).append(row)

    return {
        category: {
            "num_questions": len(rows),
            "metrics": _summarize_score_rows(rows),
        }
        for category, rows in sorted(grouped.items())
    }


def build_search(
    chunks: list[dict],
    cfg: dict,
    strategy: str = "vector",
) -> SearchFn:
    if strategy not in SUPPORTED_STRATEGIES:
        raise ValueError(f"Unsupported retrieval strategy: {strategy}")

    vector_index = None
    bm25_index = None

    def vector() -> RetrievalIndex:
        nonlocal vector_index
        if vector_index is None:
            vector_index = RetrievalIndex(
                embedder_name=cfg["retrieval"]["embedder"],
                collection_name=cfg["retrieval"]["collection_name"],
            )
            vector_index.index_chunks(chunks)
        return vector_index

    def bm25() -> BM25Index:
        nonlocal bm25_index
        if bm25_index is None:
            bm25_index = BM25Index()
            bm25_index.index_chunks(chunks)
        return bm25_index

    if strategy == "vector":
        return vector().search
    if strategy == "bm25":
        return bm25().search

    def hybrid_search(query: str, top_k: int) -> list[Any]:
        hybrid = HybridRetriever(
            vector_search=vector().search,
            bm25_search=bm25().search,
        )
        return hybrid.search(query, top_k)

    if strategy == "hybrid":
        hybrid = HybridRetriever(
            vector_search=vector().search,
            bm25_search=bm25().search,
        )
        return hybrid.search

    router = AdaptiveQueryRouter()

    def router_search(query: str, top_k: int) -> list[Any]:
        selected = router.pick_strategy(query)
        if selected == "vector":
            return vector().search(query, top_k)
        if selected == "bm25":
            return bm25().search(query, top_k)
        return hybrid_search(query, top_k)

    return router_search


def run_pipeline(config_path: str | Path, strategy: str | None = None) -> dict:
    cfg = load_config(config_path)
    started = time.perf_counter()
    strategy = strategy or cfg["retrieval"].get("strategy", "vector")

    docs = load_documents(resolve_project_path(config_path, cfg["data"]["raw_dir"]))
    chunks = build_chunks(
        docs,
        cfg["ingestion"]["chunk_size"],
        cfg["ingestion"]["chunk_overlap"],
    )
    search = build_search(chunks, cfg, strategy=strategy)

    questions = load_questions(resolve_project_path(config_path, cfg["data"]["questions_file"]))
    return evaluate_questions(
        questions=questions,
        search=search,
        top_k=cfg["retrieval"]["top_k"],
        k=cfg["evaluation"]["k"],
        config={
            "source": "standalone_index",
            "config_path": str(config_path),
            "strategy": strategy,
        },
        started=started,
    )
