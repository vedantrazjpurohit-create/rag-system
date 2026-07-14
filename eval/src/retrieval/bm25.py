from __future__ import annotations

import math
import re
from collections import Counter

from src.retrieval.types import SearchResult


class BM25Index:
    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self._chunks: list[dict] = []
        self._term_counts: list[Counter[str]] = []
        self._doc_freqs: Counter[str] = Counter()
        self._avg_doc_len = 0.0

    def index_chunks(self, chunks: list[dict]) -> None:
        self._chunks = list(chunks)
        self._term_counts = []
        self._doc_freqs = Counter()

        total_terms = 0
        for chunk in self._chunks:
            counts = Counter(_tokenize(chunk["text"]))
            self._term_counts.append(counts)
            self._doc_freqs.update(counts.keys())
            total_terms += sum(counts.values())

        self._avg_doc_len = total_terms / max(1, len(self._term_counts))

    def search(self, query: str, top_k: int) -> list[SearchResult]:
        query_terms = _tokenize(query)
        if not query_terms or not self._chunks:
            return []

        scored: list[SearchResult] = []
        for chunk, counts in zip(self._chunks, self._term_counts, strict=True):
            score = self._score(query_terms, counts)
            if score <= 0:
                continue
            scored.append(
                SearchResult(
                    chunk_id=chunk["id"],
                    doc_id=chunk["doc_id"],
                    text=chunk["text"],
                    score=score,
                    source=chunk.get("source", ""),
                )
            )

        scored.sort(key=lambda hit: hit.score, reverse=True)
        return scored[:top_k]

    def _score(self, query_terms: list[str], counts: Counter[str]) -> float:
        score = 0.0
        doc_len = sum(counts.values())
        for term in query_terms:
            freq = counts.get(term, 0)
            if freq == 0:
                continue

            idf = self._idf(term)
            denom = freq + self.k1 * (1 - self.b + self.b * doc_len / max(1.0, self._avg_doc_len))
            score += idf * (freq * (self.k1 + 1)) / denom
        return score

    def _idf(self, term: str) -> float:
        n_docs = len(self._chunks)
        doc_freq = self._doc_freqs.get(term, 0)
        return math.log(1 + (n_docs - doc_freq + 0.5) / (doc_freq + 0.5))


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())
