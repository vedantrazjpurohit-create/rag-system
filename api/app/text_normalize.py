from __future__ import annotations

import re

# PDFs with embedded symbol fonts often map Latin subscripts into the Oriya Unicode block.
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
    "\u0b47": "E",
    "\u0b48": "E",
    "\u0b49": "E",
    "\u0b4a": "O",
    "\u0b4b": "O",
    "\u0b4c": "O",
    "\u0b54": "F",
    "\u0b55": "B",
    "\u0b56": "R",
    "\u0b57": "",
    "\u0b76": "",
}

_ORIYA_BLOCK = re.compile(r"[\u0b00-\u0b7f]+")
_LATIN_ORIYA = re.compile(
    r"([A-Za-z])\s*((?:[\u0b00-\u0b7f]+\s*)+)([A-Za-z]{0,4})?"
)
_COMBINING_NOISE = re.compile(r"[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\ufe20-\ufe2f]+")


def _decode_oriya_run(run: str) -> str:
    parts: list[str] = []
    for char in run:
        mapped = _ORIYA_TO_LATIN.get(char)
        if mapped is None and "\u0b00" <= char <= "\u0b7f":
            mapped = ""
        if mapped:
            parts.append(mapped)
    return "".join(parts)


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
    cleaned = _ORIYA_BLOCK.sub("", cleaned)
    cleaned = cleaned.replace("∑ ", "∑").replace("= ", "=")
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned.strip()