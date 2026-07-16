from __future__ import annotations

import os
import re
import secrets
import uuid

from fastapi import HTTPException, Request

_TENANT_RE = re.compile(r"^[a-zA-Z0-9_-]{8,64}$")


def auth_enabled() -> bool:
    return bool(os.environ.get("RAG_API_KEY", "").strip())


def admin_auth_enabled() -> bool:
    return bool(os.environ.get("RAG_ADMIN_KEY", "").strip())


def _header_key(request: Request, name: str) -> str:
    return (request.headers.get(name) or "").strip()


def _bearer_token(request: Request) -> str:
    auth = _header_key(request, "Authorization")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return ""


def _api_key_from_request(request: Request) -> str:
    return _bearer_token(request) or _header_key(request, "X-API-Key")


def _admin_key_from_request(request: Request) -> str:
    return _header_key(request, "X-Admin-Key") or _bearer_token(request)


def _valid_tenant_id(value: str) -> bool:
    if not value:
        return False
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return bool(_TENANT_RE.match(value))


def resolve_tenant_id(request: Request) -> str:
    """Return tenant id for data isolation. Dev mode uses 'default' when auth is off."""
    if not auth_enabled():
        tenant = _header_key(request, "X-Tenant-Id") or "default"
        return tenant if _valid_tenant_id(tenant) else "default"

    provided = _api_key_from_request(request)
    expected = os.environ["RAG_API_KEY"].strip()
    if not provided or not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")

    tenant = _header_key(request, "X-Tenant-Id")
    if not _valid_tenant_id(tenant):
        raise HTTPException(
            status_code=400,
            detail="X-Tenant-Id header required (UUID or 8–64 char id)",
        )
    return tenant


def require_admin(request: Request) -> None:
    """Destructive / expensive ops: seed, eval, delete (when admin key configured)."""
    if not admin_auth_enabled():
        return
    provided = _admin_key_from_request(request)
    expected = os.environ["RAG_ADMIN_KEY"].strip()
    if not provided or not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=403, detail="Admin key required for this operation")


def require_api_access(request: Request) -> str:
    return resolve_tenant_id(request)