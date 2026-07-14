from __future__ import annotations

from collections.abc import Callable

from src.retrieval.types import SearchResult

SearchFn = Callable[[str, int], list[SearchResult]]


class HybridRetriever:
    def __init__(
        self,
        vector_search: SearchFn,
        bm25_search: SearchFn,
        vector_weight: float = 0.5,
        bm25_weight: float = 0.5,
        rrf_k: int = 60,
    ):
        self.vector_search = vector_search
        self.bm25_search = bm25_search
        self.vector_weight = vector_weight
        self.bm25_weight = bm25_weight
        self.rrf_k = rrf_k

    def search(self, query: str, top_k: int) -> list[SearchResult]:
        candidate_k = max(top_k * 3, 10)
        vector_hits = self.vector_search(query, candidate_k)
        bm25_hits = self.bm25_search(query, candidate_k)
        return reciprocal_rank_fusion(
            vector_hits=vector_hits,
            bm25_hits=bm25_hits,
            top_k=top_k,
            vector_weight=self.vector_weight,
            bm25_weight=self.bm25_weight,
            rrf_k=self.rrf_k,
        )


def reciprocal_rank_fusion(
    vector_hits: list[SearchResult],
    bm25_hits: list[SearchResult],
    top_k: int,
    vector_weight: float = 0.5,
    bm25_weight: float = 0.5,
    rrf_k: int = 60,
) -> list[SearchResult]:
    candidates: dict[str, SearchResult] = {}
    scores: dict[str, float] = {}

    _accumulate(scores, candidates, vector_hits, vector_weight, rrf_k)
    _accumulate(scores, candidates, bm25_hits, bm25_weight, rrf_k)

    fused = [
        SearchResult(
            chunk_id=hit.chunk_id,
            doc_id=hit.doc_id,
            text=hit.text,
            score=scores[chunk_id],
            source=hit.source,
        )
        for chunk_id, hit in candidates.items()
    ]
    fused.sort(key=lambda hit: hit.score, reverse=True)
    return fused[:top_k]


def _accumulate(
    scores: dict[str, float],
    candidates: dict[str, SearchResult],
    hits: list[SearchResult],
    weight: float,
    rrf_k: int,
) -> None:
    for rank, hit in enumerate(hits, start=1):
        candidates.setdefault(hit.chunk_id, hit)
        scores[hit.chunk_id] = scores.get(hit.chunk_id, 0.0) + weight / (rrf_k + rank)
