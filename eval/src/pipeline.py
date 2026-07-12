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
from src.retrieval.index import RetrievalIndex, stable_chunk_id

SearchFn = Callable[[str, int], list[Any]]


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
    recall_scores: list[float] = []
    mrr_scores: list[float] = []
    ndcg_scores: list[float] = []
    faith_scores: list[float] = []
    citation_scores: list[float] = []
    latencies: list[float] = []

    for item in questions:
        t0 = time.perf_counter()
        hits = search(item["question"], top_k)
        latencies.append((time.perf_counter() - t0) * 1000)

        retrieved_doc_ids = [str(_hit_value(hit, "doc_id")) for hit in hits]
        recall_scores.append(recall_at_k(retrieved_doc_ids, item["gold_doc_ids"], k))
        mrr_scores.append(mrr(retrieved_doc_ids, item["gold_doc_ids"]))
        ndcg_scores.append(ndcg_at_k(retrieved_doc_ids, item["gold_doc_ids"], k))

        answer = generate_answer(item["question"], hits)
        contexts = [str(_hit_value(hit, "text")) for hit in hits]
        faith_scores.append(faithfulness(answer, contexts))
        citation_scores.append(citation_coverage(answer, contexts))

    latencies.sort()
    p50 = latencies[len(latencies) // 2] if latencies else 0.0
    p95 = latencies[int(len(latencies) * 0.95)] if latencies else 0.0

    return {
        "config": config,
        "num_questions": len(questions),
        "metrics": {
            "retrieval.recall_at_k": round(sum(recall_scores) / max(1, len(recall_scores)), 3),
            "retrieval.mrr": round(sum(mrr_scores) / max(1, len(mrr_scores)), 3),
            "retrieval.ndcg_at_k": round(sum(ndcg_scores) / max(1, len(ndcg_scores)), 3),
            "gen.faithfulness": round(sum(faith_scores) / max(1, len(faith_scores)), 3),
            "gen.citation_coverage": round(sum(citation_scores) / max(1, len(citation_scores)), 3),
            "latency.p50_ms": round(p50, 1),
            "latency.p95_ms": round(p95, 1),
            "runtime.total_s": round(time.perf_counter() - started, 2),
        },
    }


def run_pipeline(config_path: str | Path) -> dict:
    cfg = load_config(config_path)
    started = time.perf_counter()

    docs = load_documents(resolve_project_path(config_path, cfg["data"]["raw_dir"]))
    chunks = build_chunks(
        docs,
        cfg["ingestion"]["chunk_size"],
        cfg["ingestion"]["chunk_overlap"],
    )

    index = RetrievalIndex(
        embedder_name=cfg["retrieval"]["embedder"],
        collection_name=cfg["retrieval"]["collection_name"],
    )
    index.index_chunks(chunks)

    questions = load_questions(resolve_project_path(config_path, cfg["data"]["questions_file"]))
    return evaluate_questions(
        questions=questions,
        search=index.search,
        top_k=cfg["retrieval"]["top_k"],
        k=cfg["evaluation"]["k"],
        config=str(config_path),
        started=started,
    )
