from src.evaluation.metrics import citation_coverage, faithfulness, mrr, ndcg_at_k, recall_at_k


def test_recall_at_k():
    retrieved = ["doc_1", "doc_2", "doc_3"]
    gold = ["doc_2", "doc_9"]
    assert recall_at_k(retrieved, gold, k=3) == 0.5


def test_mrr_first_hit():
    retrieved = ["doc_x", "doc_target", "doc_y"]
    assert mrr(retrieved, ["doc_target"]) == 0.5


def test_ndcg_at_k_perfect_ranking():
    retrieved = ["doc_a", "doc_b", "doc_c"]
    gold = ["doc_a", "doc_b"]
    assert ndcg_at_k(retrieved, gold, k=3) == 1.0


def test_ndcg_at_k_partial_credit():
    retrieved = ["doc_x", "doc_a", "doc_b"]
    gold = ["doc_a", "doc_b"]
    score = ndcg_at_k(retrieved, gold, k=3)
    assert 0.0 < score < 1.0


def test_faithfulness_supported_claim():
    answer = "Smaller chunks improved recall on the test set."
    contexts = ["When chunk size was reduced to 256 tokens, recall improved on the test question set."]
    score = faithfulness(answer, contexts)
    assert score > 0.4


def test_citation_coverage_with_tags():
    answer = "Recall improved [doc_doc_1] after chunking changes [doc_doc_1]."
    score = citation_coverage(answer, ["ctx1", "ctx2"])
    assert score > 0.0