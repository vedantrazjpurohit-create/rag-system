from app.engine import RagEngine


def test_chroma_persistence_across_restart(monkeypatch, tmp_path):
    chroma_dir = tmp_path / "chroma_persist"
    monkeypatch.setenv("CHROMA_PATH", str(chroma_dir))

    engine_a = RagEngine()
    engine_a.reset()
    count = engine_a.ingest_text(
        "The baseline experiment used 1024-token chunks for retrieval.",
        source="baseline.md",
    )
    assert count >= 1

    engine_b = RagEngine()
    assert engine_b.stats()["chunk_count"] >= 1
    assert "baseline.md" in engine_b.stats()["sources"]