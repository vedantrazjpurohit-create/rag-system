from __future__ import annotations

import json
import re
import time
from typing import Literal

from app import llm, web_search
from app.contexts import public_contexts
from app.engine import RagEngine, _default_strategy

StudyMode = Literal["notes", "define", "flashcards", "web"]

_DEFINE_PREFIX = re.compile(r"(?i)^(?:define|what is|what's|meaning of)\s+")
_URL_PATTERN = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)


def _strip_urls(text: str) -> str:
    cleaned = _URL_PATTERN.sub("", text)
    return re.sub(r"\s+", " ", cleaned).strip()


def _extract_term(topic: str) -> str:
    term = _DEFINE_PREFIX.sub("", topic.strip())
    return term.strip(" ?.,") or topic.strip()


def _template_notes(topic: str, contexts: list[dict]) -> str:
    if not contexts:
        return f"No notes could be built for “{topic}” — upload matching PDFs first."
    lines = [f"Study notes: {topic}", ""]
    for idx, ctx in enumerate(contexts[:6], start=1):
        source = ctx.get("source") or ctx.get("doc_id") or "document"
        text = str(ctx.get("text", ctx.get("excerpt", ""))).strip()
        text = re.sub(r"\s+", " ", text)
        if len(text) > 280:
            text = text[:280].rsplit(" ", 1)[0] + "…"
        lines.append(f"{idx}. {source}")
        lines.append(f"   {text}")
        lines.append("")
    return "\n".join(lines).strip()


def _template_definition(term: str, contexts: list[dict]) -> str:
    if not contexts:
        return f"No definition for “{term}” was found in your uploaded files."
    body = str(contexts[0].get("text", contexts[0].get("excerpt", ""))).strip()
    body = re.sub(r"\s+", " ", body)
    if len(body) > 420:
        body = body[:420].rsplit(" ", 1)[0] + "…"
    source = contexts[0].get("source") or contexts[0].get("doc_id") or "your notes"
    return f"{term}: {body} (from {source})"


def _template_flashcards(topic: str, contexts: list[dict], count: int) -> list[dict]:
    cards: list[dict] = []
    for ctx in contexts[:count]:
        source = ctx.get("source") or ctx.get("doc_id") or "document"
        text = str(ctx.get("text", ctx.get("excerpt", ""))).strip()
        text = re.sub(r"\s+", " ", text)
        if len(text) > 220:
            text = text[:220].rsplit(" ", 1)[0] + "…"
        cards.append(
            {
                "front": f"What does your material say about “{topic}” in {source}?",
                "back": text,
                "source": source,
            }
        )
    if not cards:
        cards.append(
            {
                "front": f"Define “{topic}” from your uploaded notes",
                "back": "Upload PDFs that mention this topic, then regenerate flashcards.",
                "source": "Index",
            }
        )
    return cards


def _parse_flashcards(raw: str, topic: str, contexts: list[dict], count: int) -> list[dict]:
    try:
        start = raw.find("[")
        end = raw.rfind("]")
        if start == -1 or end == -1:
            raise ValueError("no json array")
        parsed = json.loads(raw[start : end + 1])
        if not isinstance(parsed, list):
            raise ValueError("not a list")
        cards = []
        for item in parsed[:count]:
            if not isinstance(item, dict):
                continue
            front = str(item.get("front", "")).strip()
            back = str(item.get("back", "")).strip()
            source = str(item.get("source", "your notes")).strip()
            if front and back:
                cards.append({"front": front, "back": back, "source": source})
        if cards:
            return cards
    except Exception:
        pass
    return _template_flashcards(topic, contexts, count)


def run_study(
    engine: RagEngine,
    *,
    mode: StudyMode,
    topic: str,
    owner_id: str,
    top_k: int = 8,
    count: int = 8,
    strategy: str | None = None,
    include_full_context: bool = False,
) -> dict:
    started = time.perf_counter()
    chosen = strategy or _default_strategy()

    if mode == "web":
        snippets = web_search.fetch_snippets(topic)
        if llm.is_enabled() and snippets:
            summary, answer_mode = llm.generate_web_summary(topic, snippets)
        else:
            summary = web_search.template_paragraph(topic, snippets)
            answer_mode = "template"
        total_ms = (time.perf_counter() - started) * 1000
        return {
            "mode": mode,
            "topic": topic,
            "summary": _strip_urls(summary),
            "answer_mode": answer_mode,
            "timing_ms": {"total": round(total_ms, 2)},
        }

    t0 = time.perf_counter()
    search_query = _extract_term(topic) if mode == "define" else topic
    contexts = engine.search_contexts(search_query, top_k=top_k, strategy=chosen, owner_id=owner_id)
    retrieve_ms = (time.perf_counter() - t0) * 1000
    public = public_contexts(contexts, include_full_text=include_full_context)

    t1 = time.perf_counter()
    if mode == "notes":
        if llm.is_enabled() and contexts:
            content, answer_mode = llm.generate_notes(topic, contexts)
        else:
            content = _template_notes(topic, contexts)
            answer_mode = "template"
        generate_ms = (time.perf_counter() - t1) * 1000
        return {
            "mode": mode,
            "topic": topic,
            "notes": content,
            "contexts": public,
            "strategy": chosen,
            "answer_mode": answer_mode,
            "timing_ms": {
                "retrieve": round(retrieve_ms, 2),
                "generate": round(generate_ms, 2),
                "total": round((time.perf_counter() - started) * 1000, 2),
            },
        }

    if mode == "define":
        term = _extract_term(topic)
        if llm.is_enabled() and contexts:
            definition, answer_mode = llm.generate_definition(term, contexts)
        else:
            definition = _template_definition(term, contexts)
            answer_mode = "template"
        generate_ms = (time.perf_counter() - t1) * 1000
        return {
            "mode": mode,
            "topic": topic,
            "term": term,
            "definition": definition,
            "contexts": public,
            "strategy": chosen,
            "answer_mode": answer_mode,
            "timing_ms": {
                "retrieve": round(retrieve_ms, 2),
                "generate": round(generate_ms, 2),
                "total": round((time.perf_counter() - started) * 1000, 2),
            },
        }

    if mode == "flashcards":
        if llm.is_enabled() and contexts:
            raw, answer_mode = llm.generate_flashcards(topic, contexts, count)
            cards = _parse_flashcards(raw, topic, contexts, count)
        else:
            cards = _template_flashcards(topic, contexts, count)
            answer_mode = "template"
        generate_ms = (time.perf_counter() - t1) * 1000
        return {
            "mode": mode,
            "topic": topic,
            "cards": cards,
            "contexts": public,
            "strategy": chosen,
            "answer_mode": answer_mode,
            "timing_ms": {
                "retrieve": round(retrieve_ms, 2),
                "generate": round(generate_ms, 2),
                "total": round((time.perf_counter() - started) * 1000, 2),
            },
        }

    raise ValueError(f"Unsupported study mode: {mode}")