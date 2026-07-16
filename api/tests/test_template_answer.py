from app.llm import _template_answer


def test_definition_question_skips_garbled_formula_dump():
    contexts = [
        {
            "source": "mechanics.pdf",
            "doc_id": "d1",
            "text": (
                "∑M୅ ୊= M୅ ୔+ M୅ ୕. "
                "A force is a vector quantity that describes an interaction that changes motion."
            ),
        }
    ]
    answer = _template_answer(contexts, "what is force")
    assert "୅" not in answer
    assert "force is a vector" in answer.lower() or "didn't extract cleanly" in answer.lower()


def test_definition_finds_prose_in_second_context():
    contexts = [
        {
            "source": "equations.pdf",
            "doc_id": "d1",
            "text": "∑M୅ ୊= M୅ ୔+ M୅ ୕",
        },
        {
            "source": "mechanics.pdf",
            "doc_id": "d2",
            "text": "A force is a vector quantity that describes an interaction that changes motion.",
        },
    ]
    answer = _template_answer(contexts, "what is force")
    assert "force is a vector" in answer.lower()
    assert "mechanics.pdf" in answer