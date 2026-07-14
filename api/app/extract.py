from __future__ import annotations


def extract_upload_text(raw: bytes, filename: str) -> str:
    name = (filename or "upload").lower()
    if name.endswith(".pdf"):
        return _extract_pdf(raw)
    return raw.decode("utf-8", errors="ignore").strip()


def _extract_pdf(raw: bytes) -> str:
    import fitz

    with fitz.open(stream=raw, filetype="pdf") as doc:
        pages = [page.get_text() for page in doc]
    return "\n".join(pages).strip()