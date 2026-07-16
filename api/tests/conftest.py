import pytest


@pytest.fixture(autouse=True)
def _stable_test_env(monkeypatch):
    """Keep PDF parsing in-process for CI; auth stays off unless a test enables it."""
    monkeypatch.setenv("PDF_PARSE_IN_PROCESS", "true")
    monkeypatch.delenv("RAG_API_KEY", raising=False)
    monkeypatch.delenv("RAG_ADMIN_KEY", raising=False)