from app.web_search import template_paragraph


def test_template_paragraph_includes_sources():
    snippets = [
        "Force: In physics, a force is an action that can change motion.",
        "Newton: Newton formulated three laws of motion.",
    ]
    sources = [
        {"title": "Force", "snippet": snippets[0], "provider": "wikipedia"},
        {"title": "Newton", "snippet": snippets[1], "provider": "wikipedia"},
    ]
    text = template_paragraph("force", snippets, sources)
    assert "change motion" in text.lower() or "physics" in text.lower()
    assert "Sources:" in text
    assert "wikipedia" in text.lower()


def test_template_paragraph_empty_explains_failure():
    text = template_paragraph("xyzzy-unknown-topic", [], [])
    assert "No live web background" in text
