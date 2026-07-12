from src.retrieval.guard import (
    GuardConfig,
    apply_retrieval_guard,
    build_doc_trust_map,
    filter_superseded_hits,
    guard_config_for_corpus,
    query_has_unseen_numerics,
    trust_tier_for_source,
    wrap_guarded_search,
)
from src.retrieval.router import AdaptiveQueryRouter


def test_trust_tier_detects_poison_filename():
    assert trust_tier_for_source("data/raw_adversarial/poison_misleading_chunks.md") == "superseded"
    assert trust_tier_for_source("data/raw/baseline_chunks.md") == "trusted"


def test_filter_superseded_hits():
    hits = [
        {"doc_id": "doc_1", "text": "poison", "score": 9.0},
        {"doc_id": "doc_0", "text": "truth", "score": 1.0},
    ]
    trust = {"doc_0": "trusted", "doc_1": "superseded"}
    filtered = filter_superseded_hits(hits, trust)
    assert [hit["doc_id"] for hit in filtered] == ["doc_0"]


def test_apply_guard_refuses_out_of_domain():
    router = AdaptiveQueryRouter()
    route = router.classify("What is NVIDIA stock price right now?")
    hits = [{"doc_id": "doc_0", "text": "1024 chunks", "score": 0.9}]
    guarded = apply_retrieval_guard(
        "What is NVIDIA stock price right now?",
        hits,
        strategy="vector",
        route=route,
        doc_trust={"doc_0": "trusted"},
        trusted_corpus_blob="1024 chunks",
        cfg=GuardConfig(),
    )
    assert guarded == []


def test_apply_guard_rejects_unseen_numeric():
    router = AdaptiveQueryRouter()
    route = router.classify("Why did the 2048-token chunk experiment fail?")
    hits = [{"doc_id": "doc_0", "text": "1024 baseline", "score": 0.9}]
    guarded = apply_retrieval_guard(
        "Why did the 2048-token chunk experiment fail?",
        hits,
        strategy="vector",
        route=route,
        doc_trust={"doc_0": "trusted"},
        trusted_corpus_blob="1024 baseline 256",
        cfg=GuardConfig(reject_unseen_numerics=True),
    )
    assert guarded == []
    assert query_has_unseen_numerics("Why did the 2048-token chunk experiment fail?", "1024 baseline 256")


def test_guard_config_disabled_without_superseded_docs():
    chunks = [{"doc_id": "doc_0", "trust_tier": "trusted", "text": "ok"}]
    effective = guard_config_for_corpus(chunks, GuardConfig())
    assert effective.enabled is False


def test_wrap_guarded_search_filters_poison():
    chunks = [
        {"id": "c0", "doc_id": "doc_0", "source": "a.md", "text": "truth", "trust_tier": "trusted"},
        {"id": "c1", "doc_id": "doc_1", "source": "poison.md", "text": "poison", "trust_tier": "superseded"},
    ]
    trust = build_doc_trust_map(chunks)

    def fake_search(query: str, top_k: int):
        return [
            {"doc_id": "doc_1", "text": "poison", "score": 0.95},
            {"doc_id": "doc_0", "text": "truth", "score": 0.4},
        ]

    guarded = wrap_guarded_search(
        fake_search,
        strategy="vector",
        chunks=chunks,
        cfg=GuardConfig(min_vector_score=0.35),
    )
    hits = guarded("What chunk size was tested first?", top_k=2)
    assert hits
    assert hits[0]["doc_id"] == "doc_0"
    assert trust["doc_1"] == "superseded"