from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import os

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.engine import RagEngine, SUPPORTED_STRATEGIES

ROOT = Path(__file__).resolve().parents[2]
EVAL_ROOT = ROOT / "eval"
if str(EVAL_ROOT) not in sys.path:
    sys.path.insert(0, str(EVAL_ROOT))

from src.pipeline import evaluate_questions, load_questions  # noqa: E402

DEFAULT_QUESTIONS_PATH = EVAL_ROOT / "data" / "questions.jsonl"
HISTORY_PATH = ROOT / "results" / "history.jsonl"

app = FastAPI(title="rag-system", version="0.3.0")
engine = RagEngine()

_cors_origins = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000",
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in _cors_origins if origin.strip()],
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
    return {"status": "ok"}


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


@app.get("/adversarial/summary")
def adversarial_summary() -> dict:
    comparison_path = EVAL_ROOT / "results" / "failure_analysis_comparison.json"
    if not comparison_path.exists():
        raise HTTPException(status_code=404, detail="Adversarial comparison artifact not found")
    return json.loads(comparison_path.read_text(encoding="utf-8"))


@app.post("/ingest")
async def ingest(file: UploadFile = File(...)) -> dict:
    raw = await file.read()
    if not raw.strip():
        raise HTTPException(status_code=422, detail="Uploaded file is empty")

    text = raw.decode("utf-8", errors="ignore").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Uploaded file has no readable text")

    source = file.filename or "upload"
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
        "timing_ms": {
            "retrieve": round(result.retrieve_ms, 2),
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
