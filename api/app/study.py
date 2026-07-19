from __future__ import annotations

import json
import re
import time
from typing import Literal

from app import llm, web_search
from app.contexts import public_contexts
from app.engine import RagEngine, _default_strategy
from app.text_normalize import (
    best_prose_sentence,
    has_remaining_garbage,
    is_formula_heavy,
    normalize_engineering_text,
    prose_ratio,
)

StudyMode = Literal["notes", "define", "flashcards", "web"]

_DEFINE_PREFIX = re.compile(r"(?i)^(?:define|what is|what's|meaning of)\s+")
_URL_PATTERN = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _strip_urls(text: str) -> str:
    cleaned = _URL_PATTERN.sub("", text)
    return re.sub(r"\s+", " ", cleaned).strip()


def _extract_term(topic: str) -> str:
    term = _DEFINE_PREFIX.sub("", topic.strip())
    return term.strip(" ?.,") or topic.strip()


def _readable_excerpt(text: str, limit: int = 320) -> str:
    cleaned = normalize_engineering_text(str(text).strip())
    cleaned = re.sub(r"\s+", " ", cleaned)
    prose = best_prose_sentence(cleaned)
    if prose:
        cleaned = prose
    elif is_formula_heavy(cleaned) or has_remaining_garbage(cleaned):
        candidates = [s.strip() for s in _SENTENCE_SPLIT.split(cleaned) if len(s.strip()) >= 40]
        candidates = [s for s in candidates if prose_ratio(s) >= 0.7 and not is_formula_heavy(s)]
        if candidates:
            cleaned = candidates[0]
    if len(cleaned) > limit:
        cleaned = cleaned[:limit].rsplit(" ", 1)[0] + "…"
    return cleaned


def _template_notes(topic: str, contexts: list[dict]) -> str:
    if not contexts:
        return (
            f"No notes for “{topic}”.\n\n"
            "Nothing in your uploaded files matched this topic yet. "
            "Upload a PDF that covers it, wait for indexing to finish, then try again "
            "with a shorter keyword (e.g. “force” instead of a full sentence)."
        )

    lines = [
        f"Study notes: {topic}",
        "",
        f"Pulled {min(len(contexts), 6)} passage(s) from your library.",
        "",
        "Key passages",
        "------------",
    ]
    for idx, ctx in enumerate(contexts[:6], start=1):
        source = ctx.get("source") or ctx.get("doc_id") or "document"
        text = _readable_excerpt(str(ctx.get("text", ctx.get("excerpt", ""))), limit=360)
        lines.append("")
        lines.append(f"{idx}. From {source}")
        lines.append(f"   {text}")

    lines.extend(
        [
            "",
            "How to use these notes",
            "----------------------",
            f"• Cover the page and restate what each passage says about “{topic}”.",
            "• Turn any formula-looking line into plain English in your own words.",
            "• Use the Definition or Flashcards modes for a tighter review set.",
        ]
    )
    return "\n".join(lines).strip()


def _template_definition(term: str, contexts: list[dict]) -> str:
    if not contexts:
        return (
            f"No definition for “{term}” was found in your uploaded files. "
            "Upload matching PDFs, or try the Web mode for background."
        )
    for ctx in contexts[:6]:
        text = normalize_engineering_text(str(ctx.get("text", ctx.get("excerpt", ""))).strip())
        prose = best_prose_sentence(text, term)
        source = ctx.get("source") or ctx.get("doc_id") or "your notes"
        if prose:
            return f"{term}: {prose} (from {source})"
    body = _readable_excerpt(str(contexts[0].get("text", contexts[0].get("excerpt", ""))), limit=420)
    source = contexts[0].get("source") or contexts[0].get("doc_id") or "your notes"
    if has_remaining_garbage(body) or is_formula_heavy(body):
        return (
            f"{term}: found in {source}, but formulas didn't extract cleanly — re-upload the PDF "
            f"or ask for a plain-language explanation."
        )
    return f"{term}: {body} (from {source})"


def _template_flashcards(topic: str, contexts: list[dict], count: int) -> list[dict]:
    cards: list[dict] = []
    for ctx in contexts[:count]:
        source = ctx.get("source") or ctx.get("doc_id") or "document"
        text = _readable_excerpt(str(ctx.get("text", ctx.get("excerpt", ""))), limit=220)
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


def _web_payload(topic: str, started: float) -> dict:
    result = web_search.fetch_web(topic)
    if llm.is_enabled() and result.snippets:
        summary, answer_mode = llm.generate_web_summary(topic, result.snippets)
        summary = _strip_urls(summary)
    else:
        summary = web_search.template_paragraph(topic, result.snippets, result.sources)
        answer_mode = "template"

    total_ms = (time.perf_counter() - started) * 1000
    return {
        "mode": "web",
        "topic": topic,
        "summary": summary,
        "sources": result.sources,
        "provider": result.provider,
        "search_error": result.error,
        "answer_mode": answer_mode,
        "timing_ms": {"total": round(total_ms, 2)},
    }


def run_study(
    engine: RagEngine,
    *,
    mode: StudyMode,
    topic: str,
    owner_id: str,
    top_k: int = 8,
    count: int = 8,
    strategy: str | None = None,
    include_full_context: bool = True,
) -> dict:
    started = time.perf_counter()
    chosen = strategy or _default_strategy()
    topic = topic.strip()

    if mode == "web":
        return _web_payload(topic, started)

    t0 = time.perf_counter()
    search_query = _extract_term(topic) if mode == "define" else topic
    contexts = engine.search_contexts(
        search_query,
        top_k=max(top_k, 8),
        strategy=chosen,
        owner_id=owner_id,
    )
    # Second try with shorter query if nothing matched
    if not contexts and " " in search_query:
        short = " ".join(search_query.split()[:3])
        if short != search_query:
            contexts = engine.search_contexts(
                short,
                top_k=max(top_k, 8),
                strategy=chosen,
                owner_id=owner_id,
            )
    retrieve_ms = (time.perf_counter() - t0) * 1000
    public = public_contexts(contexts, include_full_text=include_full_context)

    t1 = time.perf_counter()
    if mode == "notes":
        if llm.is_enabled() and contexts:
            content, answer_mode = llm.generate_notes(topic, contexts)
            content = normalize_engineering_text(content)
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
            "matched_passages": len(contexts),
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
            definition = normalize_engineering_text(definition)
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
            "matched_passages": len(contexts),
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
            "matched_passages": len(contexts),
            "timing_ms": {
                "retrieve": round(retrieve_ms, 2),
                "generate": round(generate_ms, 2),
                "total": round((time.perf_counter() - started) * 1000, 2),
            },
        }

    raise ValueError(f"Unsupported study mode: {mode}")
