from __future__ import annotations

import hashlib
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import chromadb

from app.embedder import create_embedder

EVAL_ROOT = Path(__file__).resolve().parents[2] / "eval"
if str(EVAL_ROOT) not in sys.path:
    sys.path.insert(0, str(EVAL_ROOT))

from src.retrieval.bm25 import BM25Index  # noqa: E402
from src.retrieval.guard import (  # noqa: E402
    GuardConfig,
    REFUSAL_ANSWER,
    apply_retrieval_guard,
    build_doc_trust_map,
    build_trusted_corpus_blob,
    guard_config_for_corpus,
    trust_tier_for_source,
)
from src.retrieval.hybrid import HybridRetriever  # noqa: E402
from src.retrieval.types import SearchResult  # noqa: E402
from src.retrieval.router import AdaptiveQueryRouter  # noqa: E402

from app.llm import generate_answer  # noqa: E402

SUPPORTED_STRATEGIES = {"vector", "bm25", "hybrid", "router"}


@dataclass
class QueryResult:
    answer: str
    contexts: list[dict]
    retrieve_ms: float
    generate_ms: float
    total_ms: float
    answer_mode: str


class RagEngine:
    def __init__(self, embedder: str | None = None):
        self.collection_name = "rag_api"
        self.model = create_embedder(model_name=embedder)
        self.chroma_path = Path(
            os.environ.get("CHROMA_PATH", str(EVAL_ROOT.parent / "data" / "chroma"))
        )
        self.chroma_path.mkdir(parents=True, exist_ok=True)
        self.client = chromadb.PersistentClient(path=str(self.chroma_path))
        self.collection = self.client.get_or_create_collection(self.collection_name)
        self._source_doc_ids: dict[str, str] = {}
        self._chunks_by_id: dict[str, dict] = {}
        self._bm25 = BM25Index()
        self._router = AdaptiveQueryRouter()
        self._guard = GuardConfig()
        self._hydrate_from_collection()

    def _hydrate_from_collection(self) -> None:
        count = self.collection.count()
        if not count:
            return

        batch = self.collection.get(include=["documents", "metadatas"])
        for idx, chunk_id in enumerate(batch["ids"]):
            meta = batch["metadatas"][idx] or {}
            text = batch["documents"][idx]
            source = str(meta.get("source", ""))
            doc_id = str(meta.get("doc_id", ""))
            self._chunks_by_id[chunk_id] = {
                "id": chunk_id,
                "doc_id": doc_id,
                "source": source,
                "text": text,
                "trust_tier": trust_tier_for_source(source),
            }
            if source and doc_id:
                self._source_doc_ids[source] = doc_id
        self._bm25.index_chunks(list(self._chunks_by_id.values()))

    def ingest_text(self, text: str, source: str, doc_id: str | None = None) -> int:
        chunks = _chunk(text, 512, 64)
        if not chunks:
            return 0

        doc_id = doc_id or self.doc_id_for_source(source)
        trust_tier = trust_tier_for_source(source)
        ids = []
        docs = []
        metas = []
        embeddings = self.model.encode(chunks)

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
                "trust_tier": trust_tier,
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
        documents = self.list_documents()
        return {
            "chunk_count": count,
            "source_count": len(documents),
            "sources": sorted(doc["source"] for doc in documents),
            "doc_ids": sorted(doc["doc_id"] for doc in documents),
        }

    def list_documents(self) -> list[dict]:
        grouped: dict[str, dict] = {}
        for chunk in self._chunks_by_id.values():
            doc_id = str(chunk["doc_id"])
            source = str(chunk["source"])
            if doc_id not in grouped:
                grouped[doc_id] = {
                    "doc_id": doc_id,
                    "source": source,
                    "chunk_count": 0,
                    "trust_tier": str(chunk.get("trust_tier", "trusted")),
                }
            grouped[doc_id]["chunk_count"] += 1
        return sorted(grouped.values(), key=lambda doc: doc["source"])

    def seed_demo_corpus(self) -> dict:
        raw_dir = EVAL_ROOT / "data" / "raw"
        seeded = []
        total_chunks = 0
        for filename in ("baseline_chunks.md", "smaller_chunks_experiment.md"):
            path = raw_dir / filename
            if not path.exists():
                continue
            text = path.read_text(encoding="utf-8")
            doc_id = self.doc_id_for_source(filename)
            count = self.ingest_text(text, source=filename, doc_id=doc_id)
            total_chunks += count
            seeded.append({"source": filename, "doc_id": doc_id, "chunks_indexed": count})
        return {"seeded": seeded, "total_chunks": total_chunks}

    def delete_document(self, doc_id: str) -> bool:
        chunk_ids = [cid for cid, chunk in self._chunks_by_id.items() if str(chunk["doc_id"]) == doc_id]
        if not chunk_ids:
            return False

        source = str(self._chunks_by_id[chunk_ids[0]]["source"])
        self.collection.delete(ids=chunk_ids)
        for chunk_id in chunk_ids:
            self._chunks_by_id.pop(chunk_id, None)
        self._source_doc_ids.pop(source, None)
        self._bm25.index_chunks(list(self._chunks_by_id.values()))
        return True

    def query(self, question: str, top_k: int = 5, strategy: str = "vector") -> QueryResult:
        started = time.perf_counter()

        t0 = time.perf_counter()
        contexts = self.search_contexts(question, top_k=top_k, strategy=strategy)
        retrieve_ms = (time.perf_counter() - t0) * 1000

        if not contexts and not self.collection.count():
            answer = "No indexed context found. Ingest a document first."
            answer_mode = "template"
            generate_ms = 0.0
        else:
            t1 = time.perf_counter()
            answer, answer_mode = generate_answer(question, contexts)
            generate_ms = (time.perf_counter() - t1) * 1000

        total_ms = (time.perf_counter() - started) * 1000
        return QueryResult(
            answer=answer,
            contexts=contexts,
            retrieve_ms=retrieve_ms,
            generate_ms=generate_ms,
            total_ms=total_ms,
            answer_mode=answer_mode,
        )

    def search_contexts(self, question: str, top_k: int = 5, strategy: str = "vector") -> list[dict]:
        if strategy not in SUPPORTED_STRATEGIES:
            raise ValueError(f"Unsupported retrieval strategy: {strategy}")

        chunks = list(self._chunks_by_id.values())
        route = self._router.classify(question)

        if strategy == "vector":
            raw = self._search_vector(question, top_k)
        elif strategy == "bm25":
            raw = self._bm25.search(question, top_k)
        elif strategy == "router":
            selected = self._router.pick_strategy(question)
            return self.search_contexts(question, top_k=top_k, strategy=selected)
        else:
            hybrid = HybridRetriever(
                vector_search=self._search_vector,
                bm25_search=self._bm25.search,
            )
            raw = hybrid.search(question, top_k)

        effective_guard = guard_config_for_corpus(chunks, self._guard)
        if not effective_guard.enabled:
            return [_result_to_context(hit) for hit in raw]
        guarded = apply_retrieval_guard(
            question,
            raw,
            strategy=strategy,
            route=route,
            doc_trust=build_doc_trust_map(chunks),
            trusted_corpus_blob=build_trusted_corpus_blob(chunks),
            cfg=effective_guard,
        )
        return [_result_to_context(hit) for hit in guarded]

    def _search_vector(self, question: str, top_k: int = 5) -> list[SearchResult]:
        count = self.collection.count()
        if count == 0:
            return []

        query_vec = self.model.encode([question])
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
