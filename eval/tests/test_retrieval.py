from src.retrieval.bm25 import BM25Index
from src.retrieval.hybrid import reciprocal_rank_fusion
from src.retrieval.index import SearchResult
from src.retrieval.router import AdaptiveQueryRouter


def test_bm25_returns_keyword_match_first():
    chunks = [
        {"id": "c1", "doc_id": "doc_1", "source": "a.md", "text": "ArUco marker pose estimation"},
        {"id": "c2", "doc_id": "doc_2", "source": "b.md", "text": "RAG evaluation metrics"},
    ]
    index = BM25Index()
    index.index_chunks(chunks)

    hits = index.search("aruco pose", top_k=2)

    assert hits[0].chunk_id == "c1"
    assert hits[0].doc_id == "doc_1"


def test_rrf_hybrid_fuses_vector_and_bm25_ranks():
    vector_hits = [
        SearchResult(chunk_id="c1", doc_id="doc_1", text="alpha", score=0.9),
        SearchResult(chunk_id="c2", doc_id="doc_2", text="beta", score=0.8),
    ]
    bm25_hits = [
        SearchResult(chunk_id="c2", doc_id="doc_2", text="beta", score=3.0),
        SearchResult(chunk_id="c3", doc_id="doc_3", text="gamma", score=2.0),
    ]

    fused = reciprocal_rank_fusion(vector_hits, bm25_hits, top_k=3)

    assert [hit.chunk_id for hit in fused] == ["c2", "c1", "c3"]


def test_router_classifies_query_and_picks_strategy():
    router = AdaptiveQueryRouter()

    route = router.classify("What happened when chunk size was reduced to 256?")

    assert route.category == "paraphrased_factual"
    assert route.strategy == "bm25"
