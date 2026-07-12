from pathlib import Path

import fitz


def load_documents(raw_dir: str | Path) -> list[dict]:
    """Load markdown and PDF files from a directory."""
    root = Path(raw_dir)
    if not root.exists():
        raise FileNotFoundError(f"Raw data directory not found: {root}")

    docs: list[dict] = []
    for path in sorted(root.rglob("*")):
        if path.suffix.lower() == ".md":
            text = path.read_text(encoding="utf-8")
            docs.append({"id": f"doc_{len(docs)}", "source": str(path), "text": text})
        elif path.suffix.lower() == ".pdf":
            text = _read_pdf(path)
            if text.strip():
                docs.append({"id": f"doc_{len(docs)}", "source": str(path), "text": text})

    if not docs:
        raise ValueError(f"No supported documents found in {root}")

    return docs


def _read_pdf(path: Path) -> str:
    with fitz.open(path) as doc:
        return "\n".join(page.get_text() for page in doc)