# rag-system

**Upload docs, ask questions, and measure whether retrieval actually works** — one repo for serving, evaluating, and routing RAG.

Most RAG demos stop at a chatbot. This project runs the same index through vector search, BM25, hybrid fusion, and a query router, then scores recall, MRR, nDCG, and faithfulness so you can compare strategies on real data.

## What it does

- **Serve** — FastAPI ingest/query API with timing headers and upsert indexing
- **Evaluate** — offline or live `/eval` harness with per-category metrics
- **Route** — rule-based classifier picks vector, BM25, or hybrid per query shape
- **Compare** — committed benchmark JSON + chart across strategies

## Quick start

```powershell
cd rag-system
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt

$env:HF_HOME = "$PWD\.hf_cache"
.\.venv\Scripts\python.exe -m pytest api/tests eval/tests -q
.\.venv\Scripts\uvicorn.exe api.app.main:app --reload --app-dir api
```

| Endpoint | What it does |
|----------|--------------|
| `POST /ingest` | Upload text, chunk + index |
| `POST /query` | Retrieve + answer (defaults to `router`) |
| `POST /eval` | Run metrics on the live index |
| `GET /eval/history` | Past eval runs |

## Results (sample corpus)

![Strategy comparison](eval/results/comparison.png)

| Strategy | Recall@k | MRR | nDCG@k |
|----------|----------|-----|--------|
| vector | 1.0 | 0.75 | 0.815 |
| bm25 | 1.0 | 1.0 | 1.0 |
| hybrid | 1.0 | 0.75 | 0.815 |
| router | 1.0 | 1.0 | 1.0 |

Happy-path scores look perfect because the eval set is tiny. The adversarial suite is intentionally harsher.

## Failure-mode stress test (adversarial)

22 attack questions, a **poison doc** in the corpus (`doc_1` — contradicts real notes), and strict grading. A question fails if the system answers OOD queries, ranks poison, echoes forbidden claims, or misses multi-hop gold docs.

```powershell
$env:HF_HOME = "$PWD\.hf_cache"
.\.venv\Scripts\python.exe eval/scripts/run_failure_analysis.py
```

| Strategy | Pass rate | Break rate | Top failure modes |
|----------|-----------|------------|-------------------|
| vector | **0%** (0/22) | 100% | `ood_answered` ×7, `poison_top1` ×8, `poison_in_topk` ×16 |
| bm25 | **13.6%** (3/22) | 86.4% | Still leaks poison; best on typos/gibberish |
| hybrid | **0%** (0/22) | 100% | Same OOD + poison failures as vector |
| router | **4.5%** (1/22) | 95.5% | Routing does not fix refusal or poison |

**What actually breaks**

- **No true refusal** — template answers always stitch retrieved text; OOD queries still produce confident-sounding output when anything matches semantically.
- **Poison doc wins rank** — misleading `doc_1` appears in top-k on 14–16 questions for every strategy.
- **False premises slip through** — forbidden phrases (e.g. “512-token baseline”, “recall collapsed”) show up in answers when poison or wrong chunks surface.
- **Multi-hop fails** — comparing baseline vs 256-token experiment never retrieves both gold docs under poison pressure.

Full per-question breakdown: `eval/results/failure_analysis.json`

## Layout

| Path | Role |
|------|------|
| `api/` | FastAPI service |
| `eval/` | Benchmark harness, BM25/hybrid/router |
| `eval/results/` | Benchmark + adversarial failure artifacts |
| `eval/data/adversarial_questions.jsonl` | 22 failure-mode probes |
| `eval/data/raw_adversarial/` | Corpus + poison doc for stress tests |

Merged from [rag-api](https://github.com/vedantrazjpurohit-create/rag-api) and [rag-eval-bench](https://github.com/vedantrazjpurohit-create/rag-eval-bench).

**Stack:** Python 3.11+ · FastAPI · ChromaDB · sentence-transformers · pytest