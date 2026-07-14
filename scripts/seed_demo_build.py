"""Bake the demo corpus into the image at build time (unlimited build RAM)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "api"), str(ROOT / "eval")]

os.environ.setdefault("CHROMA_PATH", str(ROOT / "data" / "chroma"))
os.environ.setdefault("EMBEDDER_BACKEND", "fastembed")
os.environ.setdefault("EMBEDDER_MODEL", "BAAI/bge-small-en-v1.5")

from app.engine import RagEngine  # noqa: E402

engine = RagEngine()
if engine.collection.count() == 0:
    result = engine.seed_demo_corpus()
    if not result["seeded"]:
        raise SystemExit("Demo corpus files missing during Docker build")
    print(f"Build-time seed OK: {result['total_chunks']} chunks")
else:
    print(f"Build-time seed skipped: {engine.collection.count()} chunks already present")