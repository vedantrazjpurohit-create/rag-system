from app.study import _template_notes


def test_template_notes_empty_corpus_message():
    text = _template_notes("force", [])
    assert "No notes" in text
    assert "force" in text


def test_template_notes_lists_passages():
    contexts = [
        {
            "source": "mechanics.pdf",
            "doc_id": "d1",
            "text": "A force is a vector quantity that can change the motion of a body when applied.",
        }
    ]
    text = _template_notes("force", contexts)
    assert "Study notes: force" in text
    assert "mechanics.pdf" in text
    assert "vector quantity" in text.lower()
