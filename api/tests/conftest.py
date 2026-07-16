import pytest

TEST_TENANT_ID = "11111111-1111-4111-8111-111111111111"


def tenant_headers(**extra: str) -> dict[str, str]:
    headers = {"X-Tenant-Id": TEST_TENANT_ID}
    headers.update(extra)
    return headers


@pytest.fixture(autouse=True)
def _stable_test_env(monkeypatch):
    """Keep PDF parsing in-process for CI; auth stays off unless a test enables it."""
    monkeypatch.setenv("PDF_PARSE_IN_PROCESS", "true")
    monkeypatch.delenv("RAG_API_KEY", raising=False)
    monkeypatch.delenv("RAG_ADMIN_KEY", raising=False)
    monkeypatch.delenv("STRICT_TENANT_UUID", raising=False)