from __future__ import annotations

import os
from typing import Protocol


class Embedder(Protocol):
    def encode(self, texts: list[str]) -> list[list[float]]: ...


class SentenceTransformerEmbedder:
    def __init__(self, model_name: str):
        from sentence_transformers import SentenceTransformer

        self._model = SentenceTransformer(model_name)

    def encode(self, texts: list[str]) -> list[list[float]]:
        return self._model.encode(texts, show_progress_bar=False).tolist()


class FastEmbedEmbedder:
    def __init__(self, model_name: str):
        from fastembed import TextEmbedding

        self._model = TextEmbedding(model_name=model_name)

    def encode(self, texts: list[str]) -> list[list[float]]:
        return [vec.tolist() for vec in self._model.embed(texts)]


def create_embedder(
    backend: str | None = None,
    model_name: str | None = None,
) -> Embedder:
    backend = (backend or os.environ.get("EMBEDDER_BACKEND", "sentence_transformers")).lower()
    if model_name is None:
        if backend == "fastembed":
            model_name = os.environ.get("EMBEDDER_MODEL", "BAAI/bge-small-en-v1.5")
        else:
            model_name = os.environ.get(
                "EMBEDDER_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
            )

    if backend == "fastembed":
        return FastEmbedEmbedder(model_name)
    return SentenceTransformerEmbedder(model_name)