from __future__ import annotations

import os
import re
import secrets
import uuid

from fastapi import HTTPException, Request

_TENANT_RE = re.compile(r"^[a-zA-Z0-9_-]{8,64}$")
_RESERVED_TENANT_IDS = frozenset(
    {
        "default",
        "ssr-tenant-01",
        "ssr-default00",
        "anonymous",
        "public",
        "null",
        "undefined",
    }
)


def auth_enabled() -> bool:
    return bool(os.environ.get("RAG_API_KEY", "").strip())


def admin_auth_enabled() -> bool:
    return bool(os.environ.get("RAG_ADMIN_KEY", "").strip())


def strict_tenant_uuid_required() -> bool:
    """Production posture: UUID-only tenant ids (enabled when API auth is on)."""
    if os.environ.get("STRICT_TENANT_UUID", "").lower() in {"1", "true", "yes"}:
        return True
    return auth_enabled()


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


def _is_reserved_tenant(value: str) -> bool:
    return value.lower() in _RESERVED_TENANT_IDS


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


def _valid_tenant_id(value: str, *, strict_uuid: bool) -> bool:
    if not value or _is_reserved_tenant(value):
        return False
    if strict_uuid:
        return _is_uuid(value)
    return _is_uuid(value) or bool(_TENANT_RE.match(value))


def resolve_tenant_id(request: Request) -> str:
    """
    Session partition id from X-Tenant-Id — client-controlled, not proof of identity.
    Backend scopes every ingest/query/list/delete/eval path via owner_id == tenant.
    """
    strict = strict_tenant_uuid_required()
    tenant = _header_key(request, "X-Tenant-Id")

    if auth_enabled():
        provided = _api_key_from_request(request)
        expected = os.environ["RAG_API_KEY"].strip()
        if not provided or not secrets.compare_digest(provided, expected):
            raise HTTPException(status_code=401, detail="Invalid or missing API key")

    if not _valid_tenant_id(tenant, strict_uuid=strict):
        if not tenant:
            detail = (
                "X-Tenant-Id header required (UUID)"
                if strict
                else "X-Tenant-Id header required (UUID or 8–64 char id)"
            )
        elif _is_reserved_tenant(tenant):
            detail = "Reserved X-Tenant-Id value is not allowed"
        elif strict:
            detail = "X-Tenant-Id must be a UUID in production"
        else:
            detail = "Invalid X-Tenant-Id format"
        raise HTTPException(status_code=400, detail=detail)

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