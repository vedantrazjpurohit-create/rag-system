import io
import json
from pathlib import Path

from fastapi.testclient import TestClient

from app import main as api_main
from app.main import app
from src.pipeline import load_questions, run_pipeline

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

    for strategy in ["vector", "bm25", "hybrid"]:
        query = client.post(
            "/query",
            json={"question": "What are ArUco markers used for?", "top_k": 3, "strategy": strategy},
        )
        assert query.status_code == 200
        body = query.json()
        assert body["strategy"] == strategy
        assert body["contexts"]
        assert "timing_ms" in body
        assert query.headers.get("X-Retrieve-Ms")

    default_query = client.post(
        "/query",
        json={"question": "What are ArUco markers used for?", "top_k": 3},
    )
    assert default_query.status_code == 200
    assert default_query.json()["strategy"] == "router"


def test_ingest_rejects_empty_file():
    files = {"file": ("empty.txt", io.BytesIO(b"   \n"), "text/plain")}
    response = client.post("/ingest", files=files)
    assert response.status_code == 422


def test_eval_endpoint_matches_standalone_pipeline(monkeypatch, tmp_path):
    api_main.engine.reset()
    monkeypatch.setattr(api_main, "HISTORY_PATH", tmp_path / "history.jsonl")

    corpus_path = Path("eval/data/raw/sample_corpus.md")
    corpus = corpus_path.read_text(encoding="utf-8")
    files = {"file": ("sample_corpus.md", io.BytesIO(corpus.encode()), "text/plain")}
    ingest = client.post("/ingest", files=files)
    assert ingest.status_code == 200
    assert ingest.json()["doc_id"] == "doc_0"

    baseline = run_pipeline("eval/configs/default.yaml")
    questions = load_questions("eval/data/questions.jsonl")
    response = client.post("/eval", json={"questions": questions, "top_k": 5, "k": 5})

    assert response.status_code == 200
    body = response.json()
    score_keys = [
        "retrieval.recall_at_k",
        "retrieval.mrr",
        "retrieval.ndcg_at_k",
        "gen.faithfulness",
        "gen.citation_coverage",
    ]
    for key in score_keys:
        assert body["metrics"][key] == baseline["metrics"][key]
    for category, expected in baseline["metrics_by_category"].items():
        actual_metrics = body["metrics_by_category"][category]["metrics"]
        for key in score_keys:
            assert actual_metrics[key] == expected["metrics"][key]

    history_lines = api_main.HISTORY_PATH.read_text(encoding="utf-8").splitlines()
    assert len(history_lines) == 1
    history_record = json.loads(history_lines[0])
    assert history_record["metrics"]["retrieval.recall_at_k"] == baseline["metrics"]["retrieval.recall_at_k"]
    for category, expected in baseline["metrics_by_category"].items():
        actual_metrics = history_record["metrics_by_category"][category]["metrics"]
        for key in score_keys:
            assert actual_metrics[key] == expected["metrics"][key]

    history = client.get("/eval/history")
    assert history.status_code == 200
    assert history.json()["runs"][0]["metrics"] == history_record["metrics"]


def test_query_rejects_unknown_strategy():
    response = client.post(
        "/query",
        json={"question": "What are ArUco markers used for?", "top_k": 3, "strategy": "unknown"},
    )
    assert response.status_code == 422
