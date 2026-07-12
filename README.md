# rag-system

**Upload docs, ask questions, and measure whether retrieval actually works** — one repo for serving, evaluating, and routing RAG.

Most RAG demos stop at a chatbot. This project runs the same index through vector search, BM25, hybrid fusion, and a query router, then scores recall, MRR, nDCG, and faithfulness so you can compare strategies on real data.

## What it does

- **Serve** — FastAPI ingest/query API with timing headers and upsert indexing
- **Evaluate** — offline or live `/eval` harness with per-category metrics
- **Route** — rule-based classifier picks vector, BM25, or hybrid per query shape
- **Guard** — OOD refusal, poison-doc filtering, unseen-numeric rejection
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

22 attack questions, a **poison doc** in the corpus (`doc_1` — contradicts real notes), and strict grading. We ran this twice: **before guardrails** (raw retrieval) and **after** (OOD + poison fixes).

```powershell
$env:HF_HOME = "$PWD\.hf_cache"
.\.venv\Scripts\python.exe eval/scripts/run_failure_analysis.py --both
```

### Before guardrails (baseline)

| Strategy | Pass rate | Top failures |
|----------|-----------|--------------|
| vector | **0%** (0/22) | `ood_answered` ×7, `poison_top1` ×8, `poison_in_topk` ×16 |
| bm25 | **13.6%** (3/22) | Poison still ranks; answers OOD queries |
| hybrid | **0%** (0/22) | Same OOD + poison leaks |
| router | **4.5%** (1/22) | Routing alone does not refuse or filter poison |

### After guardrails (fixed)

| Strategy | Pass rate | Δ vs baseline | Remaining gaps |
|----------|-----------|---------------|----------------|
| vector | **36.4%** (8/22) | +36.4pp | `low_faithfulness`, retrieval misses on hard paraphrase |
| bm25 | **81.8%** (18/22) | +68.2pp | 1 OOD slip, 1 forbidden claim, 2 retrieval misses |
| hybrid | **31.8%** (7/22) | +31.8pp | Faithfulness on guarded hits |
| router | **68.2%** (15/22) | +63.7pp | Best balanced; still 7 failures on multi-hop + faithfulness |

**Poison and OOD failures drop to zero** for vector/hybrid/router on `poison_in_topk` and almost all `ood_answered` cases. BM25 goes from 13.6% → 81.8%.

### How we fixed it

Implemented in `eval/src/retrieval/guard.py` (API + eval harness):

1. **Trust tiers at ingest** — filenames matching `poison` / `misleading` / `superseded` → `trust_tier: superseded`; hard-filtered from retrieval.
2. **OOD gate** — router `out_of_domain` classification → return no hits → template refusal (`No supporting context retrieved.`).
3. **Unseen-numeric guard** — questions citing numbers not in trusted corpus (e.g. “2048-token”) → refuse instead of hallucinating.
4. **Score floor** — drop low-confidence hits (vector &lt; 0.38, BM25 &lt; 0.45) so gibberish/OOD cannot sneak through semantic similarity.

### What still breaks (honest)

- Template answers score low on **faithfulness** for hard paraphrases even when retrieval is correct.
- **Multi-hop** (need 2 gold docs) still fails 1 question — small corpus + strict guard.
- No LLM-based answer verification yet — guardrails are retrieval-layer only.

Artifacts: `eval/results/failure_analysis_baseline.json` · `failure_analysis_guarded.json` · `failure_analysis_comparison.json`

Full write-up (methodology, errors we hit, remaining gaps): **[eval/ADVERSARIAL_EVAL.md](eval/ADVERSARIAL_EVAL.md)**

## Layout

| Path | Role |
|------|------|
| `api/` | FastAPI service |
| `eval/` | Benchmark harness, BM25/hybrid/router |
| `eval/results/` | Benchmark + adversarial failure artifacts |
| `eval/data/adversarial_questions.jsonl` | 22 failure-mode probes |
| `eval/data/raw_adversarial/` | Corpus + poison doc for stress tests |
| `eval/src/retrieval/guard.py` | Trust tiers + OOD/poison guardrails |

Merged from [rag-api](https://github.com/vedantrazjpurohit-create/rag-api) and [rag-eval-bench](https://github.com/vedantrazjpurohit-create/rag-eval-bench).

**Stack:** Python 3.11+ · FastAPI · ChromaDB · sentence-transformers · pytest