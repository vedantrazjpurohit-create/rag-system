from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from src.retrieval.router import AdaptiveQueryRouter, QueryRoute

REFUSAL_ANSWER = "No supporting context retrieved."


@dataclass(frozen=True)
class GuardConfig:
    enabled: bool = True
    min_vector_score: float = 0.38
    min_bm25_score: float = 0.45
    min_hybrid_score: float = 0.35
    filter_superseded: bool = True
    reject_unseen_numerics: bool = True


def trust_tier_for_source(source: str) -> str:
    name = source.replace("\\", "/").lower()
    if any(token in name for token in ("poison", "misleading", "superseded")):
        return "superseded"
    return "trusted"


def build_doc_trust_map(chunks: list[dict]) -> dict[str, str]:
    trust: dict[str, str] = {}
    for chunk in chunks:
        trust[str(chunk["doc_id"])] = str(chunk.get("trust_tier", "trusted"))
    return trust


def build_trusted_corpus_blob(chunks: list[dict]) -> str:
    trusted = [
        chunk["text"]
        for chunk in chunks
        if chunk.get("trust_tier", "trusted") == "trusted"
    ]
    return "\n".join(trusted).lower()


def _hit_value(hit: Any, key: str, default: Any = "") -> Any:
    if isinstance(hit, dict):
        return hit.get(key, default)
    return getattr(hit, key, default)


def _numeric_tokens(text: str) -> set[str]:
    return set(re.findall(r"\d+", text))


def query_has_unseen_numerics(question: str, trusted_corpus_blob: str) -> bool:
    for token in _numeric_tokens(question):
        if token not in trusted_corpus_blob:
            return True
    return False


def filter_superseded_hits(hits: list[Any], doc_trust: dict[str, str]) -> list[Any]:
    filtered = []
    for hit in hits:
        doc_id = str(_hit_value(hit, "doc_id"))
        if doc_trust.get(doc_id, "trusted") == "superseded":
            continue
        filtered.append(hit)
    return filtered


def _score_threshold(strategy: str, cfg: GuardConfig) -> float:
    if strategy == "vector":
        return cfg.min_vector_score
    if strategy == "bm25":
        return cfg.min_bm25_score
    if strategy == "hybrid":
        return cfg.min_hybrid_score
    return cfg.min_hybrid_score


def apply_retrieval_guard(
    question: str,
    hits: list[Any],
    *,
    strategy: str,
    route: QueryRoute,
    doc_trust: dict[str, str],
    trusted_corpus_blob: str,
    cfg: GuardConfig,
) -> list[Any]:
    if not cfg.enabled:
        return hits

    if route.category == "out_of_domain":
        return []

    if cfg.reject_unseen_numerics and query_has_unseen_numerics(question, trusted_corpus_blob):
        return []

    if cfg.filter_superseded:
        hits = filter_superseded_hits(hits, doc_trust)

    if not hits:
        return []

    effective = strategy if strategy != "router" else route.strategy
    top_score = float(_hit_value(hits[0], "score", 0.0))
    if top_score < _score_threshold(effective, cfg):
        return []

    return hits


def wrap_guarded_search(
    search,
    *,
    strategy: str,
    chunks: list[dict],
    cfg: GuardConfig,
    router: AdaptiveQueryRouter | None = None,
):
    router = router or AdaptiveQueryRouter()
    doc_trust = build_doc_trust_map(chunks)
    trusted_blob = build_trusted_corpus_blob(chunks)

    def guarded(query: str, top_k: int) -> list[Any]:
        route = router.classify(query)
        raw_hits = search(query, max(top_k * 3, top_k))
        return apply_retrieval_guard(
            query,
            raw_hits,
            strategy=strategy,
            route=route,
            doc_trust=doc_trust,
            trusted_corpus_blob=trusted_blob,
            cfg=cfg,
        )[:top_k]

    return guarded