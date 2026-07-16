from __future__ import annotations

import hashlib
import os
import sys
import time
import uuid
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
from app.text_normalize import normalize_engineering_text

SUPPORTED_STRATEGIES = {"vector", "bm25", "hybrid", "router"}


def _low_memory_mode() -> bool:
    return os.environ.get("LOW_MEMORY_MODE", "").lower() in {"1", "true", "yes"}


def _default_strategy() -> str:
    return os.environ.get("DEFAULT_STRATEGY", "router")


def _resolve_strategy(strategy: str) -> str:
    if strategy not in SUPPORTED_STRATEGIES:
        raise ValueError(f"Unsupported retrieval strategy: {strategy}")
    if _low_memory_mode() and strategy in {"vector", "hybrid", "router"}:
        return "bm25"
    return strategy


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
        self._embedder_name = embedder
        self._model = None
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

    @property
    def model(self):
        if self._model is None:
            self._model = create_embedder(model_name=self._embedder_name)
        return self._model

    def _hydrate_from_collection(self) -> None:
        count = self.collection.count()
        if not count:
            return

        batch = self.collection.get(include=["documents", "metadatas"])
        for idx, chunk_id in enumerate(batch["ids"]):
            meta = batch["metadatas"][idx] or {}
            text = normalize_engineering_text(batch["documents"][idx])
            source = str(meta.get("source", ""))
            doc_id = str(meta.get("doc_id", ""))
            owner_id = str(meta.get("owner_id", "default"))
            self._chunks_by_id[chunk_id] = {
                "id": chunk_id,
                "doc_id": doc_id,
                "source": source,
                "text": text,
                "trust_tier": trust_tier_for_source(source),
                "owner_id": owner_id,
            }
            if source and doc_id:
                self._source_doc_ids[self._source_key(source, owner_id)] = doc_id
        self._bm25.index_chunks(list(self._chunks_by_id.values()))

    @staticmethod
    def _source_key(source: str, owner_id: str) -> str:
        return f"{owner_id}::{source}"

    def _tenant_chunks(self, owner_id: str) -> list[dict]:
        return [chunk for chunk in self._chunks_by_id.values() if str(chunk.get("owner_id", "default")) == owner_id]

    def ingest_text(
        self,
        text: str,
        source: str,
        doc_id: str | None = None,
        *,
        owner_id: str = "default",
    ) -> int:
        chunks = [normalize_engineering_text(c) for c in _chunk(text, 512, 64)]
        if not chunks:
            return 0

        doc_id = doc_id or self.doc_id_for_source(source, owner_id=owner_id)
        trust_tier = trust_tier_for_source(source)
        ids: list[str] = []
        docs: list[str] = []
        metas: list[dict] = []

        for idx, chunk in enumerate(chunks):
            chunk_id = _stable_id(owner_id, source, idx, chunk)
            ids.append(chunk_id)
            docs.append(chunk)
            metas.append(
                {
                    "source": source,
                    "chunk_index": idx,
                    "doc_id": doc_id,
                    "owner_id": owner_id,
                }
            )
            self._chunks_by_id[chunk_id] = {
                "id": chunk_id,
                "doc_id": doc_id,
                "source": source,
                "text": chunk,
                "trust_tier": trust_tier,
                "owner_id": owner_id,
            }

        if _low_memory_mode():
            self._bm25.index_chunks(self._tenant_chunks(owner_id))
            return len(chunks)

        embeddings = self.model.encode(chunks)
        self.collection.upsert(ids=ids, documents=docs, embeddings=embeddings, metadatas=metas)
        self._bm25.index_chunks(self._tenant_chunks(owner_id))
        return len(chunks)

    def doc_id_for_source(self, source: str, *, owner_id: str = "default") -> str:
        key = self._source_key(source, owner_id)
        if key in self._source_doc_ids:
            return self._source_doc_ids[key]

        for chunk in self._tenant_chunks(owner_id):
            if str(chunk.get("source")) == source:
                doc_id = str(chunk["doc_id"])
                self._source_doc_ids[key] = doc_id
                return doc_id

        doc_id = str(uuid.uuid4())
        self._source_doc_ids[key] = doc_id
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

    def stats(self, *, owner_id: str = "default") -> dict:
        chunks = self._tenant_chunks(owner_id)
        documents = self.list_documents(owner_id=owner_id)
        return {
            "chunk_count": len(chunks),
            "source_count": len(documents),
            "sources": sorted(doc["source"] for doc in documents),
            "doc_ids": sorted(doc["doc_id"] for doc in documents),
        }

    def list_documents(self, *, owner_id: str = "default") -> list[dict]:
        grouped: dict[str, dict] = {}
        for chunk in self._tenant_chunks(owner_id):
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

    def seed_demo_corpus(self, *, force: bool = False, owner_id: str = "default") -> dict:
        if not force and self._tenant_chunks(owner_id):
            return self._seed_status(already_seeded=True, owner_id=owner_id)

        raw_dir = EVAL_ROOT / "data" / "raw"
        seeded = []
        total_chunks = 0
        for filename in ("baseline_chunks.md", "smaller_chunks_experiment.md"):
            path = raw_dir / filename
            if not path.exists():
                continue
            text = path.read_text(encoding="utf-8")
            doc_id = self.doc_id_for_source(filename, owner_id=owner_id)
            count = self.ingest_text(text, source=filename, doc_id=doc_id, owner_id=owner_id)
            total_chunks += count
            seeded.append({"source": filename, "doc_id": doc_id, "chunks_indexed": count})
        return {"seeded": seeded, "total_chunks": total_chunks, "already_seeded": False}

    def _seed_status(self, *, already_seeded: bool, owner_id: str = "default") -> dict:
        seeded = [
            {
                "source": doc["source"],
                "doc_id": doc["doc_id"],
                "chunks_indexed": doc["chunk_count"],
            }
            for doc in self.list_documents(owner_id=owner_id)
        ]
        return {
            "seeded": seeded,
            "total_chunks": len(self._tenant_chunks(owner_id)),
            "already_seeded": already_seeded,
        }

    def delete_document(self, doc_id: str, *, owner_id: str = "default") -> bool:
        chunk_ids = [
            cid
            for cid, chunk in self._chunks_by_id.items()
            if str(chunk["doc_id"]) == doc_id and str(chunk.get("owner_id", "default")) == owner_id
        ]
        if not chunk_ids:
            return False

        source = str(self._chunks_by_id[chunk_ids[0]]["source"])
        try:
            self.collection.delete(ids=chunk_ids)
        except Exception:
            pass
        for chunk_id in chunk_ids:
            self._chunks_by_id.pop(chunk_id, None)
        self._source_doc_ids.pop(self._source_key(source, owner_id), None)
        self._bm25.index_chunks(self._tenant_chunks(owner_id))
        return True

    def query(
        self,
        question: str,
        top_k: int = 5,
        strategy: str = "vector",
        *,
        owner_id: str = "default",
    ) -> QueryResult:
        started = time.perf_counter()

        t0 = time.perf_counter()
        contexts = self.search_contexts(question, top_k=top_k, strategy=strategy, owner_id=owner_id)
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

    def search_contexts(
        self,
        question: str,
        top_k: int = 5,
        strategy: str = "vector",
        *,
        owner_id: str = "default",
    ) -> list[dict]:
        strategy = _resolve_strategy(strategy)
        chunks = self._tenant_chunks(owner_id)
        if not chunks:
            return []
        self._bm25.index_chunks(chunks)
        route = self._router.classify(question)

        if strategy == "vector":
            raw = self._search_vector(question, top_k, owner_id=owner_id)
        elif strategy == "bm25":
            raw = self._bm25.search(question, top_k)
        elif strategy == "router":
            selected = self._router.pick_strategy(question)
            return self.search_contexts(question, top_k=top_k, strategy=selected, owner_id=owner_id)
        else:
            hybrid = HybridRetriever(
                vector_search=lambda q, k: self._search_vector(q, k, owner_id=owner_id),
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

    def _search_vector(self, question: str, top_k: int = 5, *, owner_id: str = "default") -> list[SearchResult]:
        tenant_chunks = self._tenant_chunks(owner_id)
        if not tenant_chunks:
            return []

        allowed_ids = {str(chunk["id"]) for chunk in tenant_chunks}
        count = self.collection.count()
        if count == 0:
            return []

        query_vec = self.model.encode([question])
        hits = self.collection.query(
            query_embeddings=query_vec,
            n_results=min(top_k * 4, count),
        )

        hits_out: list[SearchResult] = []
        for i, doc in enumerate(hits["documents"][0]):
            chunk_id = hits["ids"][0][i]
            if chunk_id not in allowed_ids:
                continue
            metadata = hits["metadatas"][0][i]
            hits_out.append(
                SearchResult(
                    chunk_id=chunk_id,
                    doc_id=metadata.get("doc_id", metadata.get("source", "")),
                    text=doc,
                    score=1.0 - hits["distances"][0][i],
                    source=metadata["source"],
                )
            )
            if len(hits_out) >= top_k:
                break
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


def _stable_id(owner_id: str, source: str, idx: int, chunk: str) -> str:
    digest = hashlib.sha1(f"{owner_id}:{source}:{idx}:{chunk[:40]}".encode()).hexdigest()[:10]
    return f"{digest}_{idx}"


def _result_to_context(hit: SearchResult) -> dict:
    return {
        "chunk_id": hit.chunk_id,
        "doc_id": hit.doc_id,
        "text": normalize_engineering_text(hit.text),
        "source": hit.source,
        "score": hit.score,
    }
