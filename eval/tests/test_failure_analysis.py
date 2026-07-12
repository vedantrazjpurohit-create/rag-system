from src.evaluation.failure_analysis import grade_adversarial_row


def test_grade_flags_poison_top1():
    item = {
        "id": "poison",
        "gold_doc_ids": ["doc_2"],
        "forbidden_doc_ids": ["doc_1"],
        "expect_refusal": False,
    }
    hits = [{"doc_id": "doc_1", "text": "poison claims recall collapsed"}]
    answer = "Based on retrieved notes: poison claims recall collapsed [doc_doc_1]"
    graded = grade_adversarial_row(item, hits, answer, [hits[0]["text"]], k=5)

    assert not graded["passed"]
    assert "poison_top1" in graded["failures"]
    assert "wrong_top1" in graded["failures"]


def test_grade_flags_ood_answered():
    item = {
        "id": "ood",
        "gold_doc_ids": [],
        "expect_refusal": True,
    }
    hits = [{"doc_id": "doc_0", "text": "1024 token chunks"}]
    answer = "Based on retrieved notes: 1024 token chunks [doc_doc_0]"
    graded = grade_adversarial_row(item, hits, answer, [hits[0]["text"]], k=5)

    assert not graded["passed"]
    assert "ood_answered" in graded["failures"]
    assert "ood_retrieved" in graded["failures"]


def test_grade_flags_forbidden_claim():
    item = {
        "id": "premise",
        "gold_doc_ids": ["doc_0"],
        "forbidden_phrases": ["512-token"],
        "expect_refusal": False,
    }
    hits = [{"doc_id": "doc_0", "text": "1024-token baseline"}]
    answer = "The 512-token baseline was chosen first."
    graded = grade_adversarial_row(item, hits, answer, [hits[0]["text"]], k=5)

    assert not graded["passed"]
    assert "forbidden_claim" in graded["failures"]


def test_grade_passes_clean_factual():
    item = {
        "id": "ok",
        "gold_doc_ids": ["doc_0"],
        "forbidden_doc_ids": ["doc_1"],
        "expect_refusal": False,
    }
    hits = [{"doc_id": "doc_0", "text": "The initial baseline used 1024-token chunks with 128 overlap."}]
    answer = (
        "Based on retrieved notes: The initial baseline used 1024-token chunks with 128 overlap. "
        "[doc_doc_0]"
    )
    graded = grade_adversarial_row(
        item,
        hits,
        answer,
        [hits[0]["text"]],
        k=5,
        faithfulness_min=0.0,
    )

    assert graded["passed"]
    assert graded["failures"] == []