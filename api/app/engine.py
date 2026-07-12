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
        self.collection_name = "rag_api"
        self.model = SentenceTransformer(embedder)
        self.client = chromadb.Client()
        self.collection = self.client.get_or_create_collection(self.collection_name)
        self._source_doc_ids: dict[str, str] = {}

    def ingest_text(self, text: str, source: str, doc_id: str | None = None) -> int:
        chunks = _chunk(text, 512, 64)
        if not chunks:
            return 0

        doc_id = doc_id or self.doc_id_for_source(source)
        ids = []
        docs = []
        metas = []
        embeddings = self.model.encode(chunks, show_progress_bar=False).tolist()

        for idx, chunk in enumerate(chunks):
            chunk_id = _stable_id(source, idx, chunk)
            ids.append(chunk_id)
            docs.append(chunk)
            metas.append({"source": source, "chunk_index": idx, "doc_id": doc_id})

        self.collection.upsert(ids=ids, documents=docs, embeddings=embeddings, metadatas=metas)
        return len(chunks)

    def doc_id_for_source(self, source: str) -> str:
        if source in self._source_doc_ids:
            return self._source_doc_ids[source]

        existing_doc_ids: set[str] = set()
        existing_sources: set[str] = set()
        if self.collection.count():
            batch = self.collection.get(include=["metadatas"])
            for meta in batch.get("metadatas") or []:
                if not meta:
                    continue
                existing_source = str(meta.get("source", ""))
                existing_doc_id = str(meta.get("doc_id", ""))
                if existing_source:
                    existing_sources.add(existing_source)
                if existing_source == source and existing_doc_id:
                    self._source_doc_ids[source] = existing_doc_id
                    return existing_doc_id
                if existing_doc_id:
                    existing_doc_ids.add(existing_doc_id)

        next_index = len(existing_doc_ids) if existing_doc_ids else len(existing_sources)
        doc_id = f"doc_{next_index}"
        self._source_doc_ids[source] = doc_id
        return doc_id

    def reset(self) -> None:
        try:
            self.client.delete_collection(self.collection_name)
        except Exception:
            pass
        self.collection = self.client.get_or_create_collection(self.collection_name)
        self._source_doc_ids.clear()

    def stats(self) -> dict:
        count = self.collection.count()
        sources: set[str] = set()
        doc_ids: set[str] = set()
        if count:
            batch = self.collection.get(include=["metadatas"])
            for meta in batch.get("metadatas") or []:
                if not meta:
                    continue
                if "source" in meta:
                    sources.add(str(meta["source"]))
                if "doc_id" in meta:
                    doc_ids.add(str(meta["doc_id"]))
        return {
            "chunk_count": count,
            "source_count": len(sources),
            "sources": sorted(sources),
            "doc_ids": sorted(doc_ids),
        }

    def query(self, question: str, top_k: int = 5) -> QueryResult:
        started = time.perf_counter()

        t0 = time.perf_counter()
        contexts = self.search_contexts(question, top_k=top_k)
        retrieve_ms = (time.perf_counter() - t0) * 1000

        if not contexts:
            answer = "No indexed context found. Ingest a document first."
        else:
            lead = contexts[0]["text"].replace("\n", " ")[:220]
            answer = f"Top match suggests: {lead}"

        total_ms = (time.perf_counter() - started) * 1000
        return QueryResult(answer=answer, contexts=contexts, retrieve_ms=retrieve_ms, total_ms=total_ms)

    def search_contexts(self, question: str, top_k: int = 5) -> list[dict]:
        count = self.collection.count()
        if count == 0:
            return []

        query_vec = self.model.encode([question], show_progress_bar=False).tolist()
        hits = self.collection.query(query_embeddings=query_vec, n_results=min(top_k, count))

        contexts: list[dict] = []
        for i, doc in enumerate(hits["documents"][0]):
            metadata = hits["metadatas"][0][i]
            contexts.append(
                {
                    "chunk_id": hits["ids"][0][i],
                    "doc_id": metadata.get("doc_id", metadata.get("source", "")),
                    "text": doc,
                    "source": metadata["source"],
                    "score": 1.0 - hits["distances"][0][i],
                }
            )
        return contexts


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
