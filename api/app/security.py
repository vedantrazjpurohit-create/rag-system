from __future__ import annotations

import hashlib
import os
import re
import time
from collections import defaultdict, deque
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

_SECRET_PATTERNS = (
    re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*['\"]?([^\s'\",]+)"),
    re.compile(r"(?i)\b(xai-[a-z0-9_-]{8,})\b"),
    re.compile(r"(?i)\b(sk-[a-z0-9]{16,})\b"),
    re.compile(r"(?i)\b(ghp_[a-zA-Z0-9]{20,})\b"),
)

_SENSITIVE_HEADERS = frozenset(
    {
        "authorization",
        "cookie",
        "set-cookie",
        "x-api-key",
        "x-forwarded-for",
        "x-real-ip",
        "cf-connecting-ip",
        "true-client-ip",
    }
)

_RATE_LIMITS: dict[str, tuple[int, int]] = {
    "/ingest": (10, 60),
    "/query": (30, 60),
    "/query/stream": (30, 60),
    "/study": (20, 60),
    "/eval": (5, 300),
    "/eval/compare": (3, 300),
}
_DEFAULT_RATE_LIMIT = 30
_DEFAULT_RATE_WINDOW_S = 60
_DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024


def redact_secrets(text: str) -> str:
    redacted = text
    for pattern in _SECRET_PATTERNS:
        redacted = pattern.sub("[REDACTED]", redacted)
    return redacted


def _rate_limit_salt() -> str:
    return os.environ.get("RATE_LIMIT_SALT", os.environ.get("CHROMA_PATH", "rag-system"))


def _trust_proxy_headers() -> bool:
    return os.environ.get("TRUST_PROXY_HEADERS", "").lower() in {"1", "true", "yes"}


def _client_host(request: Request) -> str:
    if _trust_proxy_headers():
        forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "anon"


def _client_bucket(request: Request) -> str:
    """One-way bucket id — never log or persist the raw IP or API key."""
    api_key = (request.headers.get("x-api-key") or "").strip()
    auth = (request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        api_key = api_key or auth[7:].strip()
    tenant = (request.headers.get("x-tenant-id") or "").strip()
    host = _client_host(request)
    material = f"{_rate_limit_salt()}:{tenant}:{api_key}:{host}:{request.url.path}"
    digest = hashlib.sha256(material.encode()).hexdigest()
    return digest[:24]


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Cross-Origin-Resource-Policy"] = "same-site"
        if os.environ.get("ENABLE_HSTS", "").lower() in {"1", "true", "yes"}:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


class PrivacyHeadersMiddleware(BaseHTTPMiddleware):
    """Strip client-identifying proxy headers from outbound responses."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        for header in _SENSITIVE_HEADERS:
            if header in response.headers:
                del response.headers[header]
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._limit = int(os.environ.get("RATE_LIMIT_PER_MINUTE", str(_DEFAULT_RATE_LIMIT)))
        self._window = int(os.environ.get("RATE_LIMIT_WINDOW_S", str(_DEFAULT_RATE_WINDOW_S)))

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path
        if path not in _RATE_LIMITS:
            return await call_next(request)

        limit, window_s = _RATE_LIMITS[path]
        bucket = f"{path}:{_client_bucket(request)}"
        now = time.monotonic()
        window = self._hits[bucket]
        while window and now - window[0] > window_s:
            window.popleft()
        if len(window) >= limit:
            return Response(
                content='{"detail":"Rate limit exceeded. Try again shortly."}',
                status_code=429,
                media_type="application/json",
                headers={"Retry-After": str(window_s)},
            )
        window.append(now)
        return await call_next(request)


def max_upload_bytes() -> int:
    raw = os.environ.get("MAX_UPLOAD_BYTES", str(_DEFAULT_MAX_UPLOAD_BYTES))
    try:
        return max(1024, int(raw))
    except ValueError:
        return _DEFAULT_MAX_UPLOAD_BYTES


def public_config() -> dict:
    """Safe subset of runtime config — never expose paths, keys, or host details."""
    from app.auth import admin_auth_enabled, auth_enabled, strict_tenant_uuid_required
    from app.engine import SUPPORTED_STRATEGIES, _default_strategy, _low_memory_mode
    from app import llm, web_search

    return {
        "llm_enabled": llm.is_enabled(),
        "web_search_enabled": web_search.is_enabled(),
        "llm_model": llm.model_name(),
        "strategies": sorted(SUPPORTED_STRATEGIES),
        "persistence_enabled": True,
        "embedder_backend": os.environ.get("EMBEDDER_BACKEND", "sentence_transformers"),
        "low_memory_mode": _low_memory_mode(),
        "default_strategy": _default_strategy(),
        "auth_required": auth_enabled(),
        "admin_auth_required": admin_auth_enabled(),
        "tenant_header_required": True,
        "tenant_uuid_required": strict_tenant_uuid_required(),
    }