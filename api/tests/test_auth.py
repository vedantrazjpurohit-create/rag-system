import io
import uuid

from fastapi.testclient import TestClient

from app import main as api_main
from app.main import app

client = TestClient(app)


def test_tenant_isolation_between_uploads(monkeypatch):
    api_main.engine.reset()
    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())
    payload = "Tenant A secret chunk about purple giraffes."

    ingest_a = client.post(
        "/ingest",
        files={"file": ("a.txt", io.BytesIO(payload.encode()), "text/plain")},
        headers={"X-Tenant-Id": tenant_a},
    )
    assert ingest_a.status_code == 200

    query_b = client.post(
        "/query",
        json={"question": "purple giraffes", "top_k": 3, "strategy": "bm25"},
        headers={"X-Tenant-Id": tenant_b},
    )
    assert query_b.status_code == 200
    assert query_b.json()["contexts"] == []


def test_api_key_and_tenant_required_when_auth_enabled(monkeypatch):
    monkeypatch.setenv("RAG_API_KEY", "test-secret-key")
    response = client.post(
        "/ingest",
        files={"file": ("x.txt", io.BytesIO(b"hello"), "text/plain")},
    )
    assert response.status_code == 401

    response = client.post(
        "/ingest",
        files={"file": ("x.txt", io.BytesIO(b"hello"), "text/plain")},
        headers={"X-API-Key": "test-secret-key"},
    )
    assert response.status_code == 400

    tenant = str(uuid.uuid4())
    response = client.post(
        "/ingest",
        files={"file": ("x.txt", io.BytesIO(b"hello world text"), "text/plain")},
        headers={"X-API-Key": "test-secret-key", "X-Tenant-Id": tenant},
    )
    assert response.status_code == 200


def test_admin_required_for_delete_when_admin_key_set(monkeypatch):
    api_main.engine.reset()
    monkeypatch.setenv("RAG_ADMIN_KEY", "admin-secret")
    tenant = str(uuid.uuid4())

    ingest = client.post(
        "/ingest",
        files={"file": ("notes.txt", io.BytesIO(b"chunk size experiment"), "text/plain")},
        headers={"X-Tenant-Id": tenant},
    )
    doc_id = ingest.json()["doc_id"]

    denied = client.delete(f"/documents/{doc_id}", headers={"X-Tenant-Id": tenant})
    assert denied.status_code == 403

    allowed = client.delete(
        f"/documents/{doc_id}",
        headers={"X-Tenant-Id": tenant, "X-Admin-Key": "admin-secret"},
    )
    assert allowed.status_code == 200


def test_query_returns_excerpts_not_full_text_by_default(monkeypatch):
    api_main.engine.reset()
    long_text = "A" * 800 + " unique marker"
    files = {"file": ("big.txt", io.BytesIO(long_text.encode()), "text/plain")}
    client.post("/ingest", files=files)

    response = client.post(
        "/query",
        json={"question": "unique marker", "top_k": 1, "strategy": "bm25"},
    )
    assert response.status_code == 200
    contexts = response.json()["contexts"]
    assert contexts
    assert "text" not in contexts[0]
    assert "excerpt" in contexts[0]
    assert len(contexts[0]["excerpt"]) < len(long_text)