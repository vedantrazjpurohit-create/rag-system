from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from urllib.parse import quote

import httpx

_URL_PATTERN = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
_TIMEOUT_S = float(os.environ.get("WEB_SEARCH_TIMEOUT_S", "12"))
_MAX_RESULTS = int(os.environ.get("WEB_SEARCH_MAX_RESULTS", "5"))
_USER_AGENT = os.environ.get(
    "WEB_SEARCH_USER_AGENT",
    "ContextIQ/1.0 (study assistant; https://github.com/vedantrazjpurohit-create/rag-system)",
)


@dataclass
class WebSearchResult:
    snippets: list[str] = field(default_factory=list)
    sources: list[dict] = field(default_factory=list)
    provider: str = "none"
    error: str | None = None


def is_enabled() -> bool:
    if os.environ.get("WEB_SEARCH_ENABLED", "true").lower() in {"0", "false", "no"}:
        return False
    return True


def _strip_urls(text: str) -> str:
    cleaned = _URL_PATTERN.sub("", text)
    return re.sub(r"\s+", " ", cleaned).strip()


def _client() -> httpx.Client:
    return httpx.Client(
        timeout=_TIMEOUT_S,
        headers={"User-Agent": _USER_AGENT, "Accept": "application/json"},
        follow_redirects=True,
    )


def _google_search(query: str, max_results: int) -> WebSearchResult:
    api_key = os.environ.get("GOOGLE_SEARCH_API_KEY", "").strip()
    engine_id = os.environ.get("GOOGLE_SEARCH_ENGINE_ID", "").strip()
    if not api_key or not engine_id:
        return WebSearchResult(error="google_not_configured")

    url = (
        "https://www.googleapis.com/customsearch/v1"
        f"?key={quote(api_key, safe='')}&cx={quote(engine_id, safe='')}"
        f"&q={quote(query)}&num={max(1, min(max_results, 10))}"
    )
    try:
        with _client() as client:
            response = client.get(url)
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        return WebSearchResult(error=f"google_failed: {exc.__class__.__name__}")

    snippets: list[str] = []
    sources: list[dict] = []
    for item in payload.get("items", []):
        title = str(item.get("title", "")).strip() or "Web result"
        snippet = _strip_urls(str(item.get("snippet", "")).strip())
        if not snippet:
            continue
        snippets.append(f"{title}: {snippet}")
        sources.append({"title": title, "snippet": snippet, "provider": "google"})
    if not snippets:
        return WebSearchResult(error="google_empty")
    return WebSearchResult(snippets=snippets[:max_results], sources=sources[:max_results], provider="google")


def _wikipedia_search(query: str, max_results: int) -> WebSearchResult:
    """MediaWiki search + intro extracts in one request, plus direct summary fallback."""
    snippets: list[str] = []
    sources: list[dict] = []

    try:
        with _client() as client:
            # Fast path: exact / near-exact page summary
            summary_url = (
                "https://en.wikipedia.org/api/rest_v1/page/summary/"
                f"{quote(query.strip().replace(' ', '_'))}"
            )
            summary_response = client.get(summary_url)
            if summary_response.status_code == 200:
                data = summary_response.json()
                title = str(data.get("title", query)).strip()
                extract = _strip_urls(str(data.get("extract", "")).strip())
                if extract and data.get("type") != "disambiguation":
                    snippets.append(f"{title}: {extract}")
                    sources.append({"title": title, "snippet": extract, "provider": "wikipedia"})

            # Search more pages if needed
            if len(snippets) < max_results:
                search_url = (
                    "https://en.wikipedia.org/w/api.php"
                    "?action=query&generator=search"
                    f"&gsrsearch={quote(query)}&gsrlimit={max_results}"
                    "&prop=extracts&exintro=1&explaintext=1&exchars=600"
                    "&format=json"
                )
                search_response = client.get(search_url)
                search_response.raise_for_status()
                pages = (search_response.json().get("query") or {}).get("pages") or {}
                # MediaWiki returns pages keyed by id; sort by index when present
                ordered = sorted(
                    pages.values(),
                    key=lambda p: int(p.get("index", 999)),
                )
                seen = {s["title"].lower() for s in sources}
                for page in ordered:
                    title = str(page.get("title", "")).strip()
                    extract = _strip_urls(str(page.get("extract", "")).strip())
                    if not title or not extract:
                        continue
                    if title.lower() in seen:
                        continue
                    seen.add(title.lower())
                    snippets.append(f"{title}: {extract}")
                    sources.append({"title": title, "snippet": extract, "provider": "wikipedia"})
                    if len(snippets) >= max_results:
                        break
    except Exception as exc:
        if snippets:
            return WebSearchResult(
                snippets=snippets[:max_results],
                sources=sources[:max_results],
                provider="wikipedia",
                error=f"wikipedia_partial: {exc.__class__.__name__}",
            )
        return WebSearchResult(error=f"wikipedia_failed: {exc.__class__.__name__}")

    if not snippets:
        return WebSearchResult(error="wikipedia_empty")
    return WebSearchResult(
        snippets=snippets[:max_results],
        sources=sources[:max_results],
        provider="wikipedia",
    )


def _duckduckgo_search(query: str, max_results: int) -> WebSearchResult:
    url = (
        "https://api.duckduckgo.com/"
        f"?q={quote(query)}&format=json&no_html=1&skip_disambig=1"
    )
    try:
        with _client() as client:
            response = client.get(url)
            response.raise_for_status()
            data = response.json()
    except Exception as exc:
        return WebSearchResult(error=f"duckduckgo_failed: {exc.__class__.__name__}")

    snippets: list[str] = []
    sources: list[dict] = []

    abstract = _strip_urls(str(data.get("AbstractText", "")).strip())
    heading = str(data.get("Heading", "")).strip() or query
    if abstract:
        snippets.append(f"{heading}: {abstract}")
        sources.append({"title": heading, "snippet": abstract, "provider": "duckduckgo"})

    for topic in data.get("RelatedTopics") or []:
        if len(snippets) >= max_results:
            break
        if not isinstance(topic, dict):
            continue
        # Nested topic groups
        if "Topics" in topic:
            continue
        text = _strip_urls(str(topic.get("Text", "")).strip())
        if not text:
            continue
        title = text.split(" - ", 1)[0][:80]
        snippets.append(text)
        sources.append({"title": title, "snippet": text, "provider": "duckduckgo"})

    if not snippets:
        return WebSearchResult(error="duckduckgo_empty")
    return WebSearchResult(
        snippets=snippets[:max_results],
        sources=sources[:max_results],
        provider="duckduckgo",
    )


def fetch_web(query: str, max_results: int | None = None) -> WebSearchResult:
    """Try Google → Wikipedia → DuckDuckGo until we get real background text."""
    if not is_enabled():
        return WebSearchResult(error="web_search_disabled")

    limit = max_results or _MAX_RESULTS
    q = query.strip()
    if not q:
        return WebSearchResult(error="empty_query")

    errors: list[str] = []

    google = _google_search(q, limit)
    if google.snippets:
        return google
    if google.error:
        errors.append(google.error)

    wiki = _wikipedia_search(q, limit)
    if wiki.snippets:
        return wiki
    if wiki.error:
        errors.append(wiki.error)

    ddg = _duckduckgo_search(q, limit)
    if ddg.snippets:
        return ddg
    if ddg.error:
        errors.append(ddg.error)

    return WebSearchResult(error="; ".join(errors) if errors else "no_results")


def fetch_snippets(query: str, max_results: int | None = None) -> list[str]:
    """Backward-compatible helper used by older call sites."""
    return fetch_web(query, max_results).snippets


def template_paragraph(query: str, snippets: list[str], sources: list[dict] | None = None) -> str:
    if not snippets:
        return (
            f"No live web background was found for “{query}”. "
            "The search tried Wikipedia and DuckDuckGo; try a broader term "
            "(e.g. “force physics”) or set GOOGLE_SEARCH_API_KEY for richer results."
        )

    # Prefer a cohesive multi-sentence paragraph from the best extract
    primary = snippets[0]
    # Drop "Title: " prefix for the lead sentence when present
    if ": " in primary:
        lead = primary.split(": ", 1)[1]
    else:
        lead = primary

    extras: list[str] = []
    for snip in snippets[1:3]:
        body = snip.split(": ", 1)[1] if ": " in snip else snip
        if body and body not in lead:
            extras.append(body)

    parts = [lead]
    parts.extend(extras)
    joined = " ".join(parts)
    if len(joined) > 1200:
        joined = joined[:1200].rsplit(" ", 1)[0] + "…"

    labels: list[str] = []
    for src in (sources or [])[:3]:
        title = str(src.get("title", "")).strip()
        provider = str(src.get("provider", "")).strip()
        if title and provider:
            labels.append(f"{title} ({provider})")
        elif title:
            labels.append(title)
    if labels:
        joined = f"{joined}\n\nSources: {', '.join(labels)}."
    return joined
