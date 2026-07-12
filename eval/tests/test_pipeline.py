from src.pipeline import evaluate_questions


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
