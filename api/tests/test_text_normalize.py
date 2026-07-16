from app.text_normalize import best_prose_sentence, normalize_engineering_text


def test_repairs_oriya_subscripts_in_moment_equation():
    raw = "∑M୅ ୊= M୅ ୔+ M୅ ୕ ∑M୅ ୊= P୶OA + Q୶OA ∑M୅ ୊= R୶OA"
    cleaned = normalize_engineering_text(raw)
    assert "୅" not in cleaned
    assert "୊" not in cleaned
    assert "M_OA" in cleaned
    assert "M_OF" in cleaned
    assert "M_OB" in cleaned
    assert "P_OA" in cleaned
    assert "R_OA" in cleaned


def test_leaves_normal_text_untouched():
    text = "Force is a vector quantity with magnitude and direction."
    assert normalize_engineering_text(text) == text


def test_best_prose_prefers_readable_sentence():
    text = (
        "∑ M_OA = M_OF + M_OB. "
        "A force is an interaction that, when unopposed, changes the motion of a body."
    )
    sentence = best_prose_sentence(normalize_engineering_text(text), "force")
    assert sentence is not None
    assert "force is an interaction" in sentence.lower()