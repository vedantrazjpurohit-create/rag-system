from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass

import chromadb
from sentence_transformers import SentenceTransformer


@dataclass
class QueryResult:
    answer: str
    contexts: list[dict]
    retrieve_ms: float
    total_ms: float


class RagEngine:
    def __init__(self, embedder: str = "sentence-transformers/all-MiniLM-L6-v2"):
        self.model = SentenceTransformer(embedder)
        self.client = chromadb.Client()
        self.collection = self.client.get_or_create_collection("rag_api")

    def ingest_text(self, text: str, source: str) -> int:
        chunks = _chunk(text, 512, 64)
        if not chunks:
            return 0

        ids = []
        docs = []
        metas = []
        embeddings = self.model.encode(chunks, show_progress_bar=False).tolist()

        for idx, chunk in enumerate(chunks):
            chunk_id = _stable_id(source, idx, chunk)
            ids.append(chunk_id)
            docs.append(chunk)
            metas.append({"source": source, "chunk_index": idx})

        self.collection.upsert(ids=ids, documents=docs, embeddings=embeddings, metadatas=metas)
        return len(chunks)

    def stats(self) -> dict:
        count = self.collection.count()
        sources: set[str] = set()
        if count:
            batch = self.collection.get(include=["metadatas"])
            for meta in batch.get("metadatas") or []:
                if meta and "source" in meta:
                    sources.add(str(meta["source"]))
        return {"chunk_count": count, "source_count": len(sources), "sources": sorted(sources)}

    def query(self, question: str, top_k: int = 5) -> QueryResult:
        started = time.perf_counter()

        t0 = time.perf_counter()
        query_vec = self.model.encode([question], show_progress_bar=False).tolist()
        hits = self.collection.query(query_embeddings=query_vec, n_results=top_k)
        retrieve_ms = (time.perf_counter() - t0) * 1000

        contexts: list[dict] = []
        for i, doc in enumerate(hits["documents"][0]):
            contexts.append(
                {
                    "text": doc,
                    "source": hits["metadatas"][0][i]["source"],
                    "score": 1.0 - hits["distances"][0][i],
                }
            )

        if not contexts:
            answer = "No indexed context found. Ingest a document first."
        else:
            lead = contexts[0]["text"].replace("\n", " ")[:220]
            answer = f"Top match suggests: {lead}"

        total_ms = (time.perf_counter() - started) * 1000
        return QueryResult(answer=answer, contexts=contexts, retrieve_ms=retrieve_ms, total_ms=total_ms)


def _chunk(text: str, size: int, overlap: int) -> list[str]:
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end == len(text):
            break
        start = end - overlap
    return chunks


def _stable_id(source: str, idx: int, chunk: str) -> str:
    digest = hashlib.sha1(f"{source}:{idx}:{chunk[:40]}".encode()).hexdigest()[:10]
    return f"{digest}_{idx}"