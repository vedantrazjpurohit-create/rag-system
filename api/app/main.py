from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import os

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app import llm
from app.auth import require_admin, require_api_access
from app.contexts import public_contexts
from app.cors_config import cors_settings
from app.engine import RagEngine, SUPPORTED_STRATEGIES, _default_strategy, _low_memory_mode
from app.extract import extract_upload_text
from app.security import (
    PrivacyHeadersMiddleware,
    RateLimitMiddleware,
    SecurityHeadersMiddleware,
    max_upload_bytes,
    public_config,
)
from app.study import run_study

ROOT = Path(__file__).resolve().parents[2]
EVAL_ROOT = ROOT / "eval"
if str(EVAL_ROOT) not in sys.path:
    sys.path.insert(0, str(EVAL_ROOT))

DEFAULT_QUESTIONS_PATH = EVAL_ROOT / "data" / "questions.jsonl"
HISTORY_PATH = ROOT / "results" / "history.jsonl"

app = FastAPI(title="rag-system", version="0.4.0")


class _LazyEngine:
    _instance: RagEngine | None = None

    def _get(self) -> RagEngine:
        if _LazyEngine._instance is None:
            _LazyEngine._instance = RagEngine()
        return _LazyEngine._instance

    def __getattr__(self, name: str):
        return getattr(self._get(), name)


engine = _LazyEngine()

app.add_middleware(PrivacyHeadersMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware)

_allow_origins, _allow_origin_regex = cors_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_origin_regex=_allow_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "Authorization", "X-API-Key", "X-Admin-Key", "X-Tenant-Id"],
)


class QueryRequest(BaseModel):
    question: str = Field(min_length=3)
    top_k: int = Field(default=5, ge=1, le=20)
    strategy: str | None = None
    include_full_context: bool = False


class EvalQuestion(BaseModel):
    id: str | None = None
    category: str = "uncategorized"
    question: str = Field(min_length=3)
    gold_doc_ids: list[str] = Field(default_factory=list)
    gold_answer: str | None = None


class EvalRequest(BaseModel):
    questions: list[EvalQuestion] | None = None
    top_k: int = Field(default=5, ge=1, le=20)
    k: int = Field(default=5, ge=1, le=20)
    strategy: str = "vector"
    persist: bool = True


class StudyRequest(BaseModel):
    mode: str = Field(pattern="^(notes|define|flashcards|web)$")
    topic: str = Field(min_length=2)
    top_k: int = Field(default=8, ge=1, le=20)
    count: int = Field(default=8, ge=1, le=12)
    strategy: str | None = None
    include_full_context: bool = False


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "engine_loaded": _LazyEngine._instance is not None,
    }


@app.get("/config")
def app_config() -> dict:
    return public_config()


@app.get("/stats")
def stats(request: Request) -> dict:
    tenant = require_api_access(request)
    return engine.stats(owner_id=tenant)


@app.get("/documents")
def list_documents(request: Request) -> dict:
    tenant = require_api_access(request)
    return {"documents": engine.list_documents(owner_id=tenant)}


@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str, request: Request) -> dict:
    require_admin(request)
    tenant = require_api_access(request)
    if not engine.delete_document(doc_id, owner_id=tenant):
        raise HTTPException(status_code=404, detail=f"Document not found: {doc_id}")
    return {"deleted": doc_id, "stats": engine.stats(owner_id=tenant)}


@app.get("/benchmarks/summary")
def benchmarks_summary() -> dict:
    summary_path = EVAL_ROOT / "results" / "hybrid_by_category.json"
    if not summary_path.exists():
        raise HTTPException(status_code=404, detail="Benchmark summary artifact not found")
    return json.loads(summary_path.read_text(encoding="utf-8"))


@app.get("/adversarial/summary")
def adversarial_summary() -> dict:
    comparison_path = EVAL_ROOT / "results" / "failure_analysis_comparison.json"
    if not comparison_path.exists():
        raise HTTPException(status_code=404, detail="Adversarial comparison artifact not found")
    return json.loads(comparison_path.read_text(encoding="utf-8"))


@app.post("/demo/seed")
def seed_demo(request: Request) -> dict:
    require_admin(request)
    tenant = require_api_access(request)
    if _low_memory_mode():
        result = engine.seed_demo_corpus(owner_id=tenant)
    else:
        engine.reset()
        result = engine.seed_demo_corpus(force=True, owner_id=tenant)
    if not result["seeded"]:
        raise HTTPException(status_code=404, detail="Demo corpus files not found")
    return result


@app.post("/ingest")
async def ingest(request: Request, file: UploadFile = File(...)) -> dict:
    tenant = require_api_access(request)
    raw = await file.read()
    limit = max_upload_bytes()
    if len(raw) > limit:
        raise HTTPException(
            status_code=413,
            detail=f"Upload too large. Max size is {limit // (1024 * 1024)}MB.",
        )
    if not raw.strip():
        raise HTTPException(status_code=422, detail="Uploaded file is empty")

    source = file.filename or "upload"
    try:
        text = extract_upload_text(raw, source)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not text:
        raise HTTPException(status_code=422, detail="Uploaded file has no readable text")
    doc_id = engine.doc_id_for_source(source, owner_id=tenant)
    count = engine.ingest_text(text, source=source, doc_id=doc_id, owner_id=tenant)
    return {
        "chunks_indexed": count,
        "source": source,
        "doc_id": doc_id,
        "index_mode": "bm25" if _low_memory_mode() else "vector+bm25",
    }


@app.post("/query")
def query(payload: QueryRequest, request: Request):
    tenant = require_api_access(request)
    strategy = payload.strategy or _default_strategy()
    _validate_strategy(strategy)
    result = engine.query(
        payload.question,
        top_k=payload.top_k,
        strategy=strategy,
        owner_id=tenant,
    )
    body = {
        "answer": result.answer,
        "contexts": public_contexts(
            result.contexts,
            include_full_text=payload.include_full_context,
        ),
        "strategy": strategy,
        "answer_mode": result.answer_mode,
        "timing_ms": {
            "retrieve": round(result.retrieve_ms, 2),
            "generate": round(result.generate_ms, 2),
            "total": round(result.total_ms, 2),
        },
    }
    return JSONResponse(
        content=body,
        headers={
            "X-Retrieve-Ms": str(round(result.retrieve_ms, 2)),
            "X-Total-Ms": str(round(result.total_ms, 2)),
        },
    )


@app.post("/query/stream")
def query_stream(payload: QueryRequest, request: Request):
    tenant = require_api_access(request)
    strategy = payload.strategy or _default_strategy()
    _validate_strategy(strategy)
    started = time.perf_counter()

    t0 = time.perf_counter()
    contexts = engine.search_contexts(
        payload.question,
        top_k=payload.top_k,
        strategy=strategy,
        owner_id=tenant,
    )
    retrieve_ms = (time.perf_counter() - t0) * 1000
    public = public_contexts(contexts, include_full_text=payload.include_full_context)

    def event_stream():
        meta = {
            "type": "meta",
            "contexts": public,
            "strategy": strategy,
            "retrieve_ms": round(retrieve_ms, 2),
        }
        yield f"data: {json.dumps(meta)}\n\n"

        from app.llm import stream_answer_tokens

        answer_parts: list[str] = []
        answer_mode = "template"
        t1 = time.perf_counter()
        for token, mode in stream_answer_tokens(payload.question, contexts):
            if not answer_parts:
                answer_mode = mode
            answer_parts.append(token)
            yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"

        generate_ms = (time.perf_counter() - t1) * 1000
        total_ms = (time.perf_counter() - started) * 1000
        done = {
            "type": "done",
            "answer": "".join(answer_parts),
            "answer_mode": answer_mode,
            "timing_ms": {
                "retrieve": round(retrieve_ms, 2),
                "generate": round(generate_ms, 2),
                "total": round(total_ms, 2),
            },
        }
        yield f"data: {json.dumps(done)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/study")
def study(payload: StudyRequest, request: Request) -> dict:
    tenant = require_api_access(request)
    strategy = payload.strategy or _default_strategy()
    if payload.mode != "web":
        _validate_strategy(strategy)
    return run_study(
        engine,
        mode=payload.mode,  # type: ignore[arg-type]
        topic=payload.topic.strip(),
        owner_id=tenant,
        top_k=payload.top_k,
        count=payload.count,
        strategy=strategy,
        include_full_context=payload.include_full_context,
    )


@app.post("/eval")
def run_eval(request: Request, payload: EvalRequest | None = None) -> dict:
    require_admin(request)
    tenant = require_api_access(request)
    payload = payload or EvalRequest()
    if engine.stats(owner_id=tenant)["chunk_count"] == 0:
        raise HTTPException(status_code=422, detail="Ingest documents before running eval")
    _validate_strategy(payload.strategy)

    questions = _eval_questions(payload)
    started = time.perf_counter()
    results = evaluate_questions(
        questions=questions,
        search=lambda question, top_k: engine.search_contexts(
            question,
            top_k=top_k,
            strategy=payload.strategy,
            owner_id=tenant,
        ),
        top_k=payload.top_k,
        k=payload.k,
        config={
            "source": "live_api_index",
            "strategy": payload.strategy,
            "top_k": payload.top_k,
            "k": payload.k,
            "questions": len(questions),
        },
        started=started,
    )

    if payload.persist:
        _append_eval_history(results)

    return results


@app.post("/eval/compare")
def eval_compare(request: Request, payload: EvalRequest | None = None) -> dict:
    require_admin(request)
    tenant = require_api_access(request)
    payload = payload or EvalRequest()
    if engine.stats(owner_id=tenant)["chunk_count"] == 0:
        raise HTTPException(status_code=422, detail="Ingest documents before running eval")

    questions = _eval_questions(payload)
    comparison: dict[str, dict] = {}
    for strategy in sorted(SUPPORTED_STRATEGIES):
        _validate_strategy(strategy)
        started = time.perf_counter()
        comparison[strategy] = evaluate_questions(
            questions=questions,
            search=lambda question, top_k, s=strategy: engine.search_contexts(
                question,
                top_k=top_k,
                strategy=s,
                owner_id=tenant,
            ),
            top_k=payload.top_k,
            k=payload.k,
            config={
                "source": "live_api_index",
                "strategy": strategy,
                "top_k": payload.top_k,
                "k": payload.k,
                "questions": len(questions),
            },
            started=started,
        )

    return {
        "num_questions": len(questions),
        "strategies": comparison,
    }


@app.get("/eval/history")
def eval_history(request: Request, limit: int = 20) -> dict:
    require_admin(request)
    limit = max(1, min(limit, 100))
    if not HISTORY_PATH.exists():
        return {"runs": []}

    runs = []
    for line in HISTORY_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            runs.append(json.loads(line))
    return {"runs": runs[-limit:]}


def _eval_questions(payload: EvalRequest) -> list[dict]:
    from src.pipeline import load_questions  # noqa: E402

    if payload.questions is not None:
        return [question.model_dump(exclude_none=True) for question in payload.questions]
    return load_questions(DEFAULT_QUESTIONS_PATH)


def _append_eval_history(results: dict) -> None:
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "metrics": results["metrics"],
        "metrics_by_category": results["metrics_by_category"],
        "config": results["config"],
        "num_questions": results["num_questions"],
    }
    with HISTORY_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, sort_keys=True) + "\n")


def _validate_strategy(strategy: str) -> None:
    if strategy not in SUPPORTED_STRATEGIES:
        allowed = ", ".join(sorted(SUPPORTED_STRATEGIES))
        raise HTTPException(status_code=422, detail=f"Unsupported retrieval strategy: {strategy}. Use one of: {allowed}")


# Late import keeps evaluate_questions available to route handlers.
from src.pipeline import evaluate_questions  # noqa: E402