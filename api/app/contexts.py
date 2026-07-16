from __future__ import annotations

import os

from app.text_normalize import normalize_engineering_text

_DEFAULT_EXCERPT_CHARS = 320


def excerpt_chars() -> int:
    try:
        return max(80, int(os.environ.get("CONTEXT_EXCERPT_CHARS", str(_DEFAULT_EXCERPT_CHARS))))
    except ValueError:
        return _DEFAULT_EXCERPT_CHARS


def public_context(hit: dict, *, include_full_text: bool = False) -> dict:
    text = normalize_engineering_text(str(hit.get("text", "")))
    excerpt = text if include_full_text else text[: excerpt_chars()].rstrip()
    if not include_full_text and len(text) > len(excerpt):
        excerpt += "…"
    return {
        "chunk_id": hit.get("chunk_id"),
        "doc_id": hit.get("doc_id"),
        "source": hit.get("source"),
        "score": hit.get("score"),
        "excerpt": excerpt,
        **({"text": text} if include_full_text else {}),
    }


def public_contexts(hits: list[dict], *, include_full_text: bool = False) -> list[dict]:
    return [public_context(hit, include_full_text=include_full_text) for hit in hits]