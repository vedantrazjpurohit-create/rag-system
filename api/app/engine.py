from __future__ import annotations

import hashlib
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import chromadb
from sentence_transformers import SentenceTransformer

EVAL_ROOT = Path(__file__).resolve().parents[2] / "eval"
if str(EVAL_ROOT) not in sys.path:
    sys.path.insert(0, str(EVAL_ROOT))

from src.retrieval.bm25 import BM25Index  # noqa: E402
from src.retrieval.hybrid import HybridRetriever  # noqa: E402
from src.retrieval.index import SearchResult  # noqa: E402

SUPPORTED_STRATEGIES = {"vector", "bm25", "hybrid"}


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
        self._chunks_by_id: dict[str, dict] = {}
        self._bm25 = BM25Index()

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
            self._chunks_by_id[chunk_id] = {
                "id": chunk_id,
                "doc_id": doc_id,
                "source": source,
                "text": chunk,
            }

        self.collection.upsert(ids=ids, documents=docs, embeddings=embeddings, metadatas=metas)
        self._bm25.index_chunks(list(self._chunks_by_id.values()))
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
        self._chunks_by_id.clear()
        self._bm25.index_chunks([])

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

    def query(self, question: str, top_k: int = 5, strategy: str = "vector") -> QueryResult:
        started = time.perf_counter()

        t0 = time.perf_counter()
        contexts = self.search_contexts(question, top_k=top_k, strategy=strategy)
        retrieve_ms = (time.perf_counter() - t0) * 1000

        if not contexts:
            answer = "No indexed context found. Ingest a document first."
        else:
            lead = contexts[0]["text"].replace("\n", " ")[:220]
            answer = f"Top match suggests: {lead}"

        total_ms = (time.perf_counter() - started) * 1000
        return QueryResult(answer=answer, contexts=contexts, retrieve_ms=retrieve_ms, total_ms=total_ms)

    def search_contexts(self, question: str, top_k: int = 5, strategy: str = "vector") -> list[dict]:
        if strategy not in SUPPORTED_STRATEGIES:
            raise ValueError(f"Unsupported retrieval strategy: {strategy}")

        if strategy == "vector":
            return [_result_to_context(hit) for hit in self._search_vector(question, top_k)]
        if strategy == "bm25":
            return [_result_to_context(hit) for hit in self._bm25.search(question, top_k)]

        hybrid = HybridRetriever(
            vector_search=self._search_vector,
            bm25_search=self._bm25.search,
        )
        return [_result_to_context(hit) for hit in hybrid.search(question, top_k)]

    def _search_vector(self, question: str, top_k: int = 5) -> list[SearchResult]:
        count = self.collection.count()
        if count == 0:
            return []

        query_vec = self.model.encode([question], show_progress_bar=False).tolist()
        hits = self.collection.query(query_embeddings=query_vec, n_results=min(top_k, count))

        hits_out: list[SearchResult] = []
        for i, doc in enumerate(hits["documents"][0]):
            metadata = hits["metadatas"][0][i]
            hits_out.append(
                SearchResult(
                    chunk_id=hits["ids"][0][i],
                    doc_id=metadata.get("doc_id", metadata.get("source", "")),
                    text=doc,
                    score=1.0 - hits["distances"][0][i],
                    source=metadata["source"],
                )
            )
        return hits_out


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


def _result_to_context(hit: SearchResult) -> dict:
    return {
        "chunk_id": hit.chunk_id,
        "doc_id": hit.doc_id,
        "text": hit.text,
        "source": hit.source,
        "score": hit.score,
    }
