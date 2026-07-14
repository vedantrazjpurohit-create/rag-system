import os

from app.cors_config import cors_settings


def test_cors_includes_frontend_url(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:3000")
    monkeypatch.setenv("FRONTEND_URL", "https://rag-system.vercel.app")
    monkeypatch.setenv("ALLOW_VERCEL_PREVIEWS", "false")
    origins, regex = cors_settings()
    assert "http://localhost:3000" in origins
    assert "https://rag-system.vercel.app" in origins
    assert regex is None


def test_cors_vercel_preview_regex(monkeypatch):
    monkeypatch.delenv("FRONTEND_URL", raising=False)
    monkeypatch.setenv("ALLOW_VERCEL_PREVIEWS", "true")
    origins, regex = cors_settings()
    assert regex == r"https://.*\.vercel\.app"