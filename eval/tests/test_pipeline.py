from src.pipeline import evaluate_questions
from src.pipeline import build_search


def test_evaluate_questions_reports_metrics_by_category():
    questions = [
        {"id": "q1", "category": "factual_lookup", "question": "alpha?", "gold_doc_ids": ["doc_1"]},
        {"id": "q2", "category": "out_of_domain", "question": "beta?", "gold_doc_ids": ["doc_9"]},
    ]

    def search(question: str, top_k: int) -> list[dict]:
        return [{"doc_id": "doc_1", "text": "alpha answer", "score": 1.0}]

    results = evaluate_questions(
        questions=questions,
        search=search,
        top_k=1,
        k=1,
        config="test",
    )

    assert results["metrics"]["retrieval.recall_at_k"] == 0.5
    assert results["metrics_by_category"]["factual_lookup"]["metrics"]["retrieval.recall_at_k"] == 1.0
    assert results["metrics_by_category"]["out_of_domain"]["metrics"]["retrieval.recall_at_k"] == 0.0


def test_build_search_supports_router_strategy():
    chunks = [
        {"id": "c1", "doc_id": "doc_1", "source": "a.md", "text": "1024 token chunks were tested first"},
        {"id": "c2", "doc_id": "doc_2", "source": "b.md", "text": "unrelated context"},
    ]
    cfg = {
        "retrieval": {
            "embedder": "sentence-transformers/all-MiniLM-L6-v2",
            "collection_name": "test_router_strategy",
        }
    }

    search = build_search(chunks, cfg, strategy="router")
    hits = search("What chunk size was tested first?", top_k=1)

    assert hits[0].doc_id == "doc_1"
