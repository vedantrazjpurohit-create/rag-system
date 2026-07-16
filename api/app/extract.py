from __future__ import annotations

import os
from concurrent.futures import ProcessPoolExecutor, TimeoutError as FuturesTimeoutError

_DEFAULT_MAX_PDF_PAGES = 200
_DEFAULT_MAX_EXTRACTED_CHARS = 500_000
_DEFAULT_PDF_TIMEOUT_S = 30


def _max_pdf_pages() -> int:
    try:
        return max(1, int(os.environ.get("MAX_PDF_PAGES", str(_DEFAULT_MAX_PDF_PAGES))))
    except ValueError:
        return _DEFAULT_MAX_PDF_PAGES


def _max_extracted_chars() -> int:
    try:
        return max(1000, int(os.environ.get("MAX_EXTRACTED_CHARS", str(_DEFAULT_MAX_EXTRACTED_CHARS))))
    except ValueError:
        return _DEFAULT_MAX_EXTRACTED_CHARS


def _pdf_timeout_s() -> int:
    try:
        return max(5, int(os.environ.get("PDF_PARSE_TIMEOUT_S", str(_DEFAULT_PDF_TIMEOUT_S))))
    except ValueError:
        return _DEFAULT_PDF_TIMEOUT_S


def extract_upload_text(raw: bytes, filename: str) -> str:
    name = (filename or "upload").lower()
    if name.endswith(".pdf"):
        if not raw.startswith(b"%PDF-"):
            raise ValueError("File does not look like a valid PDF")
        return _extract_pdf(raw)
    text = raw.decode("utf-8", errors="ignore").strip()
    return _clip_text(text)


def _clip_text(text: str) -> str:
    limit = _max_extracted_chars()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip()


def _parse_pdf_worker(raw: bytes, max_pages: int, max_chars: int) -> str:
    import fitz

    with fitz.open(stream=raw, filetype="pdf") as doc:
        if doc.page_count > max_pages:
            raise ValueError(f"PDF has too many pages (max {max_pages})")
        pages = [page.get_text() for page in doc]
    text = "\n".join(pages).strip()
    if len(text) > max_chars:
        text = text[:max_chars].rstrip()
    return text


def _extract_pdf(raw: bytes) -> str:
    max_pages = _max_pdf_pages()
    max_chars = _max_extracted_chars()
    timeout = _pdf_timeout_s()
    in_process = os.environ.get("PDF_PARSE_IN_PROCESS", "").lower() in {"1", "true", "yes"}

    if in_process:
        return _parse_pdf_worker(raw, max_pages, max_chars)

    try:
        with ProcessPoolExecutor(max_workers=1) as pool:
            future = pool.submit(_parse_pdf_worker, raw, max_pages, max_chars)
            try:
                return future.result(timeout=timeout)
            except FuturesTimeoutError as exc:
                raise ValueError(f"PDF parsing timed out after {timeout}s") from exc
    except ValueError:
        raise
    except Exception:
        return _parse_pdf_worker(raw, max_pages, max_chars)