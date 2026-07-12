import io

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_stats_empty_index():
    response = client.get("/stats")
    assert response.status_code == 200
    body = response.json()
    assert body["chunk_count"] >= 0
    assert "sources" in body


def test_ingest_and_query_roundtrip():
    payload = (
        "ArUco markers are square fiducial markers used for camera pose estimation. "
        "They encode a binary pattern that OpenCV can detect reliably."
    )
    files = {"file": ("notes.txt", io.BytesIO(payload.encode()), "text/plain")}

    ingest = client.post("/ingest", files=files)
    assert ingest.status_code == 200
    assert ingest.json()["chunks_indexed"] >= 1

    stats = client.get("/stats")
    assert stats.json()["chunk_count"] >= 1
    assert "notes.txt" in stats.json()["sources"]

    query = client.post("/query", json={"question": "What are ArUco markers used for?", "top_k": 3})
    assert query.status_code == 200
    body = query.json()
    assert body["contexts"]
    assert "timing_ms" in body
    assert query.headers.get("X-Retrieve-Ms")


def test_ingest_rejects_empty_file():
    files = {"file": ("empty.txt", io.BytesIO(b"   \n"), "text/plain")}
    response = client.post("/ingest", files=files)
    assert response.status_code == 422