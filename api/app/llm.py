from __future__ import annotations

import os
from typing import Any

DEFAULT_MODEL = os.environ.get("XAI_MODEL", "grok-4.5")
REFUSAL_ANSWER = "No supporting context retrieved."


def is_enabled() -> bool:
    return bool(os.environ.get("XAI_API_KEY", "").strip())


def model_name() -> str | None:
    return DEFAULT_MODEL if is_enabled() else None


def _client() -> Any:
    from openai import OpenAI

    return OpenAI(
        api_key=os.environ["XAI_API_KEY"],
        base_url=os.environ.get("XAI_BASE_URL", "https://api.x.ai/v1"),
    )


def generate_answer(question: str, contexts: list[dict]) -> tuple[str, str]:
    """Return (answer, mode) where mode is 'llm' or 'template'."""
    if not contexts:
        return REFUSAL_ANSWER, "template"

    if not is_enabled():
        lead = contexts[0]["text"].replace("\n", " ")[:220]
        return f"Top match suggests: {lead}", "template"

    snippets = []
    for idx, ctx in enumerate(contexts[:4], start=1):
        text = str(ctx.get("text", "")).replace("\n", " ")[:400]
        source = ctx.get("source", ctx.get("doc_id", "unknown"))
        snippets.append(f"[{idx}] ({source}) {text}")

    system = (
        "You are a careful RAG assistant. Answer ONLY using the retrieved context snippets. "
        "If the context is insufficient, say you cannot answer from the documents. "
        "Cite snippet numbers like [1] when referencing evidence. Keep answers concise."
    )
    user = f"Question: {question}\n\nRetrieved context:\n" + "\n\n".join(snippets)

    try:
        response = _client().chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.2,
            max_tokens=400,
        )
        answer = (response.choices[0].message.content or "").strip()
        if answer:
            return answer, "llm"
    except Exception:
        pass

    lead = contexts[0]["text"].replace("\n", " ")[:220]
    return f"Top match suggests: {lead}", "template"


def _prompt_messages(question: str, contexts: list[dict]) -> tuple[str, str, str]:
    if not contexts:
        return "", "", REFUSAL_ANSWER

    snippets = []
    for idx, ctx in enumerate(contexts[:4], start=1):
        text = str(ctx.get("text", "")).replace("\n", " ")[:400]
        source = ctx.get("source", ctx.get("doc_id", "unknown"))
        snippets.append(f"[{idx}] ({source}) {text}")

    system = (
        "You are a careful RAG assistant. Answer ONLY using the retrieved context snippets. "
        "If the context is insufficient, say you cannot answer from the documents. "
        "Cite snippet numbers like [1] when referencing evidence. Keep answers concise."
    )
    user = f"Question: {question}\n\nRetrieved context:\n" + "\n\n".join(snippets)
    return system, user, ""


def stream_answer_tokens(question: str, contexts: list[dict]):
    """Yield (token, mode) tuples; mode is 'llm' or 'template'."""
    if not contexts:
        yield REFUSAL_ANSWER, "template"
        return

    if not is_enabled():
        lead = contexts[0]["text"].replace("\n", " ")[:220]
        yield f"Top match suggests: {lead}", "template"
        return

    system, user, _ = _prompt_messages(question, contexts)
    try:
        stream = _client().chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.2,
            max_tokens=400,
            stream=True,
        )
        emitted = False
        for chunk in stream:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                emitted = True
                yield delta, "llm"
        if emitted:
            return
    except Exception:
        pass

    lead = contexts[0]["text"].replace("\n", " ")[:220]
    yield f"Top match suggests: {lead}", "template"