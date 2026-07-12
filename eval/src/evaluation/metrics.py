from __future__ import annotations

import math
import re


def recall_at_k(retrieved_doc_ids: list[str], gold_doc_ids: list[str], k: int) -> float:
    if not gold_doc_ids:
        return 0.0
    top = set(retrieved_doc_ids[:k])
    hits = sum(1 for doc_id in gold_doc_ids if doc_id in top)
    return hits / len(gold_doc_ids)


def mrr(retrieved_doc_ids: list[str], gold_doc_ids: list[str]) -> float:
    for rank, doc_id in enumerate(retrieved_doc_ids, start=1):
        if doc_id in gold_doc_ids:
            return 1.0 / rank
    return 0.0


def ndcg_at_k(retrieved_doc_ids: list[str], gold_doc_ids: list[str], k: int) -> float:
    if not gold_doc_ids:
        return 0.0

    gold = set(gold_doc_ids)
    dcg = 0.0
    for rank, doc_id in enumerate(retrieved_doc_ids[:k], start=1):
        rel = 1.0 if doc_id in gold else 0.0
        dcg += rel / math.log2(rank + 1)

    ideal_hits = min(len(gold_doc_ids), k)
    idcg = sum(1.0 / math.log2(rank + 1) for rank in range(1, ideal_hits + 1))
    if idcg == 0.0:
        return 0.0
    return dcg / idcg


def faithfulness(answer: str, contexts: list[str]) -> float:
    """Claim overlap proxy — cheap stand-in for an LLM judge in offline runs."""
    if not answer.strip() or not contexts:
        return 0.0

    claims = _split_claims(answer)
    if not claims:
        return 0.0

    context_blob = " ".join(contexts).lower()
    supported = sum(1 for claim in claims if _claim_supported(claim, context_blob))
    return supported / len(claims)


def citation_coverage(answer: str, contexts: list[str]) -> float:
    if not answer.strip():
        return 0.0
    cited = len(re.findall(r"\[doc_[^\]]+\]", answer))
    if cited == 0:
        # fallback: reward answers that reuse context phrases
        overlap = faithfulness(answer, contexts)
        return overlap
    return min(1.0, cited / max(1, len(contexts)))


def _split_claims(answer: str) -> list[str]:
    parts = re.split(r"[.!?]\s+", answer.strip())
    return [p.strip() for p in parts if len(p.strip()) > 8]


def _claim_supported(claim: str, context_blob: str) -> bool:
    tokens = [t for t in re.findall(r"[a-z0-9]+", claim.lower()) if len(t) > 3]
    if not tokens:
        return False
    hits = sum(1 for token in tokens if token in context_blob)
    return hits / len(tokens) >= 0.5