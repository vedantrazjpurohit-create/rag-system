from __future__ import annotations

import os
import re
from urllib.parse import quote

import httpx

_URL_PATTERN = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
_TIMEOUT_S = float(os.environ.get("WEB_SEARCH_TIMEOUT_S", "10"))
_MAX_RESULTS = int(os.environ.get("WEB_SEARCH_MAX_RESULTS", "5"))


def is_enabled() -> bool:
    google = bool(os.environ.get("GOOGLE_SEARCH_API_KEY", "").strip()) and bool(
        os.environ.get("GOOGLE_SEARCH_ENGINE_ID", "").strip()
    )
    return google or os.environ.get("WEB_SEARCH_ENABLED", "true").lower() in {"1", "true", "yes"}


def _strip_urls(text: str) -> str:
    cleaned = _URL_PATTERN.sub("", text)
    return re.sub(r"\s+", " ", cleaned).strip()


def _google_snippets(query: str, max_results: int) -> list[str]:
    api_key = os.environ.get("GOOGLE_SEARCH_API_KEY", "").strip()
    engine_id = os.environ.get("GOOGLE_SEARCH_ENGINE_ID", "").strip()
    if not api_key or not engine_id:
        return []

    url = (
        "https://www.googleapis.com/customsearch/v1"
        f"?key={quote(api_key, safe='')}&cx={quote(engine_id, safe='')}"
        f"&q={quote(query)}&num={max(1, min(max_results, 10))}"
    )
    try:
        with httpx.Client(timeout=_TIMEOUT_S) as client:
            response = client.get(url)
            response.raise_for_status()
            payload = response.json()
    except Exception:
        return []

    snippets: list[str] = []
    for item in payload.get("items", []):
        title = str(item.get("title", "")).strip()
        snippet = str(item.get("snippet", "")).strip()
        if title and snippet:
            snippets.append(f"{title}: {snippet}")
        elif snippet:
            snippets.append(snippet)
    return snippets[:max_results]


def _wikipedia_snippets(query: str, max_results: int) -> list[str]:
    snippets: list[str] = []
    try:
        with httpx.Client(timeout=_TIMEOUT_S) as client:
            search_url = (
                "https://en.wikipedia.org/w/api.php"
                f"?action=opensearch&search={quote(query)}&limit={max_results}&namespace=0&format=json"
            )
            search_response = client.get(search_url, headers={"User-Agent": "rag-system-study/1.0"})
            search_response.raise_for_status()
            titles = search_response.json()[1][:max_results]

            for title in titles:
                summary_url = (
                    "https://en.wikipedia.org/api/rest_v1/page/summary/"
                    f"{quote(str(title).replace(' ', '_'))}"
                )
                summary_response = client.get(summary_url, headers={"User-Agent": "rag-system-study/1.0"})
                if summary_response.status_code != 200:
                    continue
                data = summary_response.json()
                extract = str(data.get("extract", "")).strip()
                if extract:
                    snippets.append(f"{title}: {extract}")
    except Exception:
        return snippets
    return snippets[:max_results]


def fetch_snippets(query: str, max_results: int | None = None) -> list[str]:
    limit = max_results or _MAX_RESULTS
    snippets = _google_snippets(query, limit)
    if not snippets:
        snippets = _wikipedia_snippets(query, limit)
    return [_strip_urls(s) for s in snippets if s.strip()]


def template_paragraph(query: str, snippets: list[str]) -> str:
    if not snippets:
        return (
            f"No web background was found for “{query}”. "
            "Try a broader term, or set GOOGLE_SEARCH_API_KEY for richer results."
        )
    joined = " ".join(snippets[:3])
    if len(joined) > 900:
        joined = joined[:900].rsplit(" ", 1)[0] + "…"
    return joined