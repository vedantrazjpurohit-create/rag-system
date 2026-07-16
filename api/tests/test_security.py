from fastapi.testclient import TestClient

from app.main import app
from app.security import redact_secrets
from conftest import tenant_headers

client = TestClient(app)


def test_config_never_exposes_secrets_or_paths():
    response = client.get("/config")
    assert response.status_code == 200
    body = response.json()
    assert "chroma_path" not in body
    assert "XAI_API_KEY" not in str(body)
    assert "auth_required" in body
    for key, value in body.items():
        assert "api_key" not in key.lower()
        if isinstance(value, str):
            assert "xai-" not in value.lower()


def test_security_headers_present():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("X-Frame-Options") == "DENY"
    assert response.headers.get("Referrer-Policy") == "no-referrer"


def test_redact_secrets():
    raw = 'Error: XAI_API_KEY=xai-supersecret123 and api_key="sk-abcdef1234567890"'
    cleaned = redact_secrets(raw)
    assert "xai-supersecret" not in cleaned
    assert "sk-abcdef" not in cleaned
    assert "REDACTED" in cleaned


def test_upload_rejects_oversized_file(monkeypatch):
    monkeypatch.setattr("app.main.max_upload_bytes", lambda: 32)
    files = {"file": ("big.txt", b"x" * 64, "text/plain")}
    response = client.post("/ingest", files=files, headers=tenant_headers())
    assert response.status_code == 413