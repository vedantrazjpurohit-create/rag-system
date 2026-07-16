from __future__ import annotations

import re

# PDF symbol fonts often map Latin subscripts into Indic Unicode blocks.
_ORIYA_TO_LATIN: dict[str, str] = {
    "\u0b05": "a",
    "\u0b06": "a",
    "\u0b07": "i",
    "\u0b08": "i",
    "\u0b09": "u",
    "\u0b0a": "u",
    "\u0b0b": "r",
    "\u0b0c": "l",
    "\u0b0f": "e",
    "\u0b10": "e",
    "\u0b13": "o",
    "\u0b14": "o",
    "\u0b15": "k",
    "\u0b16": "k",
    "\u0b17": "g",
    "\u0b18": "g",
    "\u0b19": "n",
    "\u0b1a": "c",
    "\u0b1b": "c",
    "\u0b1c": "j",
    "\u0b1d": "j",
    "\u0b1e": "n",
    "\u0b1f": "t",
    "\u0b20": "t",
    "\u0b21": "d",
    "\u0b22": "d",
    "\u0b23": "n",
    "\u0b24": "t",
    "\u0b25": "t",
    "\u0b26": "d",
    "\u0b27": "d",
    "\u0b28": "n",
    "\u0b2a": "p",
    "\u0b2b": "f",
    "\u0b2c": "b",
    "\u0b2d": "b",
    "\u0b2e": "m",
    "\u0b2f": "y",
    "\u0b30": "r",
    "\u0b32": "l",
    "\u0b33": "l",
    "\u0b35": "v",
    "\u0b36": "s",
    "\u0b37": "s",
    "\u0b38": "s",
    "\u0b39": "h",
    "\u0b3e": "a",
    "\u0b3f": "i",
    "\u0b40": "i",
    "\u0b41": "u",
    "\u0b42": "u",
    "\u0b47": "e",
    "\u0b48": "e",
    "\u0b4b": "o",
    "\u0b4c": "o",
    "\u0b4d": "",
    "\u0b45": "A",
    "\u0b46": "A",
    "\u0b49": "E",
    "\u0b4a": "O",
    "\u0b54": "F",
    "\u0b55": "B",
    "\u0b56": "R",
    "\u0b57": "",
    "\u0b76": "",
}

_ORIYA_BLOCK = re.compile(r"[\u0b00-\u0b7f]+")
_INDIC_GARBAGE = re.compile(r"[\u0b00-\u0b7f\u0900-\u097f\u0c00-\u0c7f\u0c80-\u0cff]+")
_LATIN_ORIYA = re.compile(
    r"([A-Za-z])\s*((?:[\u0b00-\u0b7f]+\s*)+)([A-Za-z]{0,4})?"
)
_COMBINING_NOISE = re.compile(r"[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\ufe20-\ufe2f]+")
_SYMBOL_HEAVY = re.compile(r"^[^A-Za-z0-9\s]{3,}")


def _order_subscript(sub: str) -> str:
    letters = "".join(c for c in sub if c.isalpha())
    if "O" in letters and "A" in letters and len(letters) <= 4:
        rest = "".join(c for c in letters if c not in {"O", "A"})
        return f"OA{rest}"
    return sub


def _decode_oriya_run(run: str) -> str:
    parts: list[str] = []
    for char in run:
        mapped = _ORIYA_TO_LATIN.get(char)
        if mapped is None and "\u0b00" <= char <= "\u0b7f":
            mapped = ""
        if mapped:
            parts.append(mapped)
    return _order_subscript("".join(parts))


def has_remaining_garbage(text: str) -> bool:
    return bool(_INDIC_GARBAGE.search(text))


def normalize_engineering_text(text: str) -> str:
    """Repair common PDF symbol-font garbage so force/moment notation stays readable."""
    if not text:
        return text

    cleaned = _COMBINING_NOISE.sub("", text)

    def _subscript(match: re.Match[str]) -> str:
        base = match.group(1)
        oriya = re.sub(r"\s+", "", match.group(2))
        suffix = match.group(3) or ""
        sub = _decode_oriya_run(oriya) + suffix
        return f"{base}_{sub}" if sub else base

    cleaned = _LATIN_ORIYA.sub(_subscript, cleaned)
    cleaned = _INDIC_GARBAGE.sub("", cleaned)
    cleaned = cleaned.replace("∑", "∑ ")
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned.strip()


def prose_ratio(text: str) -> float:
    if not text:
        return 0.0
    good = sum(1 for c in text if c.isalnum() or c.isspace() or c in ".,;:-()[]")
    return good / len(text)


def is_formula_heavy(text: str) -> bool:
    """True when text looks like a symbol equation dump, not readable prose."""
    if not text:
        return False
    if has_remaining_garbage(text):
        return True
    words = re.findall(r"[A-Za-z]{3,}", text)
    content_words = [
        w
        for w in words
        if w.lower() not in {"sum", "the", "and", "for", "from", "with", "that", "this"}
    ]
    if len(content_words) >= 4 and prose_ratio(text) >= 0.7:
        return False
    if "∑" in text or text.count("_") >= 2:
        return True
    symbol_hits = sum(1 for c in text if c in "∑_=+-")
    return symbol_hits >= 3 and len(content_words) < 2


def best_prose_sentence(text: str, term: str | None) -> str | None:
    if not term:
        return None
    term_l = term.lower().strip()
    if not term_l:
        return None

    candidates: list[str] = []
    for part in re.split(r"(?<=[.!?])\s+|\n+", text):
        line = part.strip()
        if len(line) < 28:
            continue
        if has_remaining_garbage(line):
            continue
        if prose_ratio(line) < 0.72:
            continue
        if _SYMBOL_HEAVY.match(line):
            continue
        candidates.append(line)

    for line in candidates:
        if term_l in line.lower():
            return line

    for line in candidates:
        if term_l[: min(5, len(term_l))] in line.lower():
            return line

    return candidates[0] if candidates else None