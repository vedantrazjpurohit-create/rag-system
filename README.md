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
```

### Full-stack (API + web UI)

Terminal 1 — backend:

```powershell
.\.venv\Scripts\uvicorn.exe api.app.main:app --reload --app-dir api
```

Terminal 2 — frontend:

```powershell
cd web
copy .env.local.example .env.local
npm install
npm run dev
```

Open **http://localhost:3000** — upload docs, query with strategy selector, view retrieved chunks.

| Tab | Features |
|-----|----------|
| **Demo** | Upload, chat, retrieved contexts |
| **Eval** | Strategy comparison charts, live eval, history |
| **Safety Lab** | Adversarial before/after pass rates |

### Optional: Grok LLM answers

Set `XAI_API_KEY` (from https://console.x.ai) to switch from template answers to Grok:

```powershell
$env:XAI_API_KEY = "your-key"
.\.venv\Scripts\uvicorn.exe api.app.main:app --reload --app-dir api
```

### Docker (API + web)

```powershell
docker compose up --build
```

## Deploy (live demo)

**Stack:** Render (API) + Vercel (web). Free tier works for demos; upgrade Render to Starter ($7/mo) if the embedder OOMs on 512MB.

### 1. Deploy API on Render

1. Go to [render.com](https://render.com) → **New** → **Blueprint**
2. Connect `vedantrazjpurohit-create/rag-system`
3. Render reads `render.yaml` and creates `rag-system-api`
4. After deploy, copy the URL (e.g. `https://rag-system-api.onrender.com`)
5. In Render **Environment**, set:
   - `FRONTEND_URL` = your Vercel URL (after step 2)
   - `XAI_API_KEY` = optional, for Grok answers

Health check: `GET /health`

### 2. Deploy web on Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New** → **Project**
2. Import `vedantrazjpurohit-create/rag-system`
3. Set **Root Directory** = `web`
4. Add environment variable:
   - `NEXT_PUBLIC_API_URL` = your Render API URL
5. Deploy → copy your Vercel URL (e.g. `https://rag-system.vercel.app`)

### 3. Link them

Back in Render, set `FRONTEND_URL` to your Vercel URL and redeploy. CORS also allows `*.vercel.app` previews automatically.

### Verify

| Check | URL |
|-------|-----|
| API health | `https://<api>/health` |
| Live site | `https://<vercel>/` |
| Safety Lab | adversarial charts load from API |
| Eval tab | benchmarks + live eval |

Add both URLs to your GitHub README and LinkedIn.

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
| `web/` | Next.js frontend (chat, upload, Safety Lab) |
| `render.yaml` | Render Blueprint for API deploy |
| `web/vercel.json` | Vercel build config (root dir = `web`) |
| `eval/` | Benchmark harness, BM25/hybrid/router |
| `eval/results/` | Benchmark + adversarial failure artifacts |
| `eval/data/adversarial_questions.jsonl` | 22 failure-mode probes |
| `eval/data/raw_adversarial/` | Corpus + poison doc for stress tests |
| `eval/src/retrieval/guard.py` | Trust tiers + OOD/poison guardrails |

Merged from [rag-api](https://github.com/vedantrazjpurohit-create/rag-api) and [rag-eval-bench](https://github.com/vedantrazjpurohit-create/rag-eval-bench).

**Stack:** Python 3.11+ · FastAPI · ChromaDB · sentence-transformers · pytest