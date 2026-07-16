from __future__ import annotations

import os
import re


def cors_settings() -> tuple[list[str], str | None]:
    """Build allowed origins and optional preview regex for production deploys."""
    origins: list[str] = []
    default_local = "http://localhost:3000,http://127.0.0.1:3000"
    raw = os.environ.get("CORS_ORIGINS", default_local)
    origins.extend(origin.strip() for origin in raw.split(",") if origin.strip())

    frontend = os.environ.get("FRONTEND_URL", "").strip()
    if frontend and frontend not in origins:
        origins.append(frontend)

    regex = None
    if os.environ.get("ALLOW_VERCEL_PREVIEWS", "false").lower() in {"1", "true", "yes"}:
        project = os.environ.get("VERCEL_PREVIEW_PROJECT", "").strip()
        if project:
            escaped = re.escape(project)
            regex = rf"https://{escaped}(?:-[a-z0-9-]+)?\.vercel\.app"
        else:
            regex = r"https://.*\.vercel\.app"

    return origins, regex