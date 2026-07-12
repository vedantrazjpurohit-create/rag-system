from __future__ import annotations

import hashlib
from dataclasses import dataclass

import chromadb
from sentence_transformers import SentenceTransformer


@dataclass
class SearchResult:
    chunk_id: str
    doc_id: str
    text: str
    score: float


class RetrievalIndex:
    def __init__(self, embedder_name: str, collection_name: str):
        self.model = SentenceTransformer(embedder_name)
        self.client = chromadb.Client()
        self.collection = self.client.get_or_create_collection(name=collection_name)

    def index_chunks(self, chunks: list[dict]) -> None:
        if not chunks:
            return

        texts = [c["text"] for c in chunks]
        embeddings = self.model.encode(texts, show_progress_bar=False).tolist()

        self.collection.add(
            ids=[c["id"] for c in chunks],
            documents=texts,
            embeddings=embeddings,
            metadatas=[{"doc_id": c["doc_id"], "source": c["source"]} for c in chunks],
        )

    def search(self, query: str, top_k: int) -> list[SearchResult]:
        query_embedding = self.model.encode([query], show_progress_bar=False).tolist()
        results = self.collection.query(query_embeddings=query_embedding, n_results=top_k)

        hits: list[SearchResult] = []
        for idx, chunk_id in enumerate(results["ids"][0]):
            distance = results["distances"][0][idx]
            metadata = results["metadatas"][0][idx]
            hits.append(
                SearchResult(
                    chunk_id=chunk_id,
                    doc_id=metadata["doc_id"],
                    text=results["documents"][0][idx],
                    score=1.0 - distance,
                )
            )
        return hits


def stable_chunk_id(doc_id: str, text: str) -> str:
    digest = hashlib.sha1(f"{doc_id}:{text}".encode("utf-8")).hexdigest()[:12]
    return f"{doc_id}_{digest}"