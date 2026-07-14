from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import os

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app import llm
from app.cors_config import cors_settings
from app.engine import RagEngine, SUPPORTED_STRATEGIES
from app.extract import extract_upload_text

ROOT = Path(__file__).resolve().parents[2]
EVAL_ROOT = ROOT / "eval"
if str(EVAL_ROOT) not in sys.path:
    sys.path.insert(0, str(EVAL_ROOT))

from src.pipeline import evaluate_questions, load_questions  # noqa: E402

DEFAULT_QUESTIONS_PATH = EVAL_ROOT / "data" / "questions.jsonl"
HISTORY_PATH = ROOT / "results" / "history.jsonl"

app = FastAPI(title="rag-system", version="0.3.0")


class _LazyEngine:
    _instance: RagEngine | None = None

    def _get(self) -> RagEngine:
        if self._instance is None:
            self._instance = RagEngine()
        return self._instance

    def __getattr__(self, name: str):
        return getattr(self._get(), name)


engine = _LazyEngine()

_allow_origins, _allow_origin_regex = cors_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_origin_regex=_allow_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    question: str = Field(min_length=3)
    top_k: int = Field(default=5, ge=1, le=20)
    strategy: str | None = None


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


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "engine_loaded": _LazyEngine._instance is not None,
    }


@app.get("/config")
def app_config() -> dict:
    return {
        "llm_enabled": llm.is_enabled(),
        "llm_model": llm.model_name(),
        "strategies": sorted(SUPPORTED_STRATEGIES),
        "persistence_enabled": True,
        "chroma_path": str(engine.chroma_path),
        "embedder_backend": os.environ.get("EMBEDDER_BACKEND", "sentence_transformers"),
    }


@app.get("/stats")
def stats() -> dict:
    return engine.stats()


@app.get("/documents")
def list_documents() -> dict:
    return {"documents": engine.list_documents()}


@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str) -> dict:
    if not engine.delete_document(doc_id):
        raise HTTPException(status_code=404, detail=f"Document not found: {doc_id}")
    return {"deleted": doc_id, "stats": engine.stats()}


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
def seed_demo() -> dict:
    engine.reset()
    result = engine.seed_demo_corpus()
    if not result["seeded"]:
        raise HTTPException(status_code=404, detail="Demo corpus files not found")
    return result


@app.post("/ingest")
async def ingest(file: UploadFile = File(...)) -> dict:
    raw = await file.read()
    if not raw.strip():
        raise HTTPException(status_code=422, detail="Uploaded file is empty")

    source = file.filename or "upload"
    text = extract_upload_text(raw, source)
    if not text:
        raise HTTPException(status_code=422, detail="Uploaded file has no readable text")
    doc_id = engine.doc_id_for_source(source)
    count = engine.ingest_text(text, source=source, doc_id=doc_id)
    return {"chunks_indexed": count, "source": source, "doc_id": doc_id}


@app.post("/query")
def query(payload: QueryRequest):
    strategy = payload.strategy or "router"
    _validate_strategy(strategy)
    result = engine.query(payload.question, top_k=payload.top_k, strategy=strategy)
    body = {
        "answer": result.answer,
        "contexts": result.contexts,
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
def query_stream(payload: QueryRequest):
    strategy = payload.strategy or "router"
    _validate_strategy(strategy)
    started = time.perf_counter()

    t0 = time.perf_counter()
    contexts = engine.search_contexts(payload.question, top_k=payload.top_k, strategy=strategy)
    retrieve_ms = (time.perf_counter() - t0) * 1000

    def event_stream():
        meta = {
            "type": "meta",
            "contexts": contexts,
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


@app.post("/eval")
def run_eval(payload: EvalRequest | None = None) -> dict:
    payload = payload or EvalRequest()
    if engine.stats()["chunk_count"] == 0:
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
def eval_compare(payload: EvalRequest | None = None) -> dict:
    payload = payload or EvalRequest()
    if engine.stats()["chunk_count"] == 0:
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
def eval_history(limit: int = 20) -> dict:
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
