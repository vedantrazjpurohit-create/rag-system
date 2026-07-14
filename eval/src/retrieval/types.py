from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SearchResult:
    chunk_id: str
    doc_id: str
    text: str
    score: float
    source: str = ""