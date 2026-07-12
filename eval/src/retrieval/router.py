from __future__ import annotations

import re
from dataclasses import dataclass

DEFAULT_CATEGORY_STRATEGIES = {
    "factual_lookup": "bm25",
    "paraphrased_factual": "bm25",
    "multi_hop": "hybrid",
    "ambiguous": "hybrid",
    "exact_term_acronym": "bm25",
    "out_of_domain": "bm25",
}


@dataclass(frozen=True)
class QueryRoute:
    category: str
    strategy: str
    reason: str


class AdaptiveQueryRouter:
    def __init__(self, category_strategies: dict[str, str] | None = None):
        self.category_strategies = category_strategies or DEFAULT_CATEGORY_STRATEGIES

    def pick_strategy(self, query: str) -> str:
        return self.classify(query).strategy

    def classify(self, query: str) -> QueryRoute:
        text = query.strip()
        lower = text.lower()
        tokens = re.findall(r"[A-Za-z0-9@.+#/-]+", text)

        if _looks_out_of_domain(lower):
            return self._route("out_of_domain", "domain keyword looks outside the indexed corpus")
        if _looks_multi_hop(lower):
            return self._route("multi_hop", "query asks to combine or compare multiple facts")
        if _looks_ambiguous(tokens, lower):
            return self._route("ambiguous", "query is short or underspecified")
        if _looks_paraphrased(lower):
            return self._route("paraphrased_factual", "query asks for an effect, result, or explanation")
        if _has_exact_terms(text, tokens):
            return self._route("exact_term_acronym", "query contains an exact term, acronym, number, or symbol")
        return self._route("factual_lookup", "default direct lookup")

    def _route(self, category: str, reason: str) -> QueryRoute:
        return QueryRoute(
            category=category,
            strategy=self.category_strategies[category],
            reason=reason,
        )


def _looks_out_of_domain(text: str) -> bool:
    hints = {
        "weather",
        "stock",
        "nvidia",
        "movie",
        "recipe",
        "butter chicken",
        "flight",
        "president",
        "capital of",
        "sports",
        "fifa",
        "world cup",
        "fine-tune",
        "fine tune",
        "llama",
        "lora",
        "gpu cluster",
    }
    return any(hint in text for hint in hints)


def _looks_multi_hop(text: str) -> bool:
    hints = [
        "compare",
        "difference between",
        "relationship between",
        "how does",
        "why does",
        "both",
        "across",
        "combine",
    ]
    return any(hint in text for hint in hints) or text.count(" and ") >= 2


def _looks_ambiguous(tokens: list[str], text: str) -> bool:
    if len(tokens) <= 2:
        return True
    vague_refs = {"it", "this", "that", "they", "those"}
    return any(token.lower() in vague_refs for token in tokens) and len(tokens) <= 5


def _looks_paraphrased(text: str) -> bool:
    hints = [
        "what happened",
        "what changed",
        "result",
        "effect",
        "impact",
        "improved",
        "reduced",
        "increased",
        "why",
    ]
    return any(hint in text for hint in hints)


def _has_exact_terms(text: str, tokens: list[str]) -> bool:
    if re.search(r"\d|[@/#_.-]", text):
        return True
    return any(token.isupper() and len(token) >= 2 for token in tokens)
