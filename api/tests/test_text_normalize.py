from app.text_normalize import normalize_engineering_text


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