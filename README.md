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

Set `XAI_API_KEY` in a local `.env` file only (never commit — copy from `.env.example`):

```powershell
Copy-Item .env.example .env
.\launch.ps1
```

### Docker (API + web)

```powershell
docker compose up --build
```

## Deploy (live demo) — Vercel only

The production app is a **single Next.js project** on Vercel. Upload, search, notes, and web background all run in Next.js API routes (`/api-proxy/*`). No Render required.

### Deploy

1. [vercel.com](https://vercel.com) → **Add New** → **Project**
2. Import `vedantrazjpurohit-create/rag-system`
3. **Root Directory** = **`web`**
4. Framework = **Next.js**
5. Environment variables:

| Key | Required? | Purpose |
|-----|-----------|---------|
| `XAI_API_KEY` | Optional | Grok answers from [console.x.ai](https://console.x.ai) |
| `XAI_MODEL` | Optional | Default `grok-4.5` |
| `RAG_ADMIN_KEY` | Optional | **Set this** if you want `/eval`, `/demo/seed`, or other admin routes usable. Without it, admin routes stay **safely disabled** (403). |
| `RAG_API_KEY` | Optional | Shared secret for API callers |
| `REQUIRE_API_KEY` | Optional | Set `true` if this is more than a public demo — every API call must send a valid `RAG_API_KEY` (use a trusted server layer; do not put the key in browser JS). |
| `FRONTEND_URL` | Optional | Canonical site origin for CORS (e.g. `https://your-app.vercel.app`) |
| `CORS_ORIGINS` | Optional | Extra allowed origins (comma-separated) |
| `ALLOW_VERCEL_PREVIEWS` | Optional | `true` to allow `*.vercel.app` preview origins |
| `ALLOW_FULL_CONTEXT` | Optional | `true` to allow full chunk `text` in API responses when requested |

Do **not** set `NEXT_PUBLIC_API_URL` or `API_PROXY_TARGET` — the app uses same-origin `/api-proxy`.

6. Deploy → open `https://your-app.vercel.app`

### Verify

| Check | URL |
|-------|-----|
| Site | `https://<vercel>/` |
| Health | `https://<vercel>/api-proxy/health` |

### Local checks

```powershell
cd web
npm ci
npm run lint
npm run build
```

### Notes

- Retrieval is **BM25** (keyword) in-process — fast, no Chroma/embedder bundle.
- Browser caches extracted PDF text and re-sends it with each query (survives serverless instance hops).
- Max upload ~4.5MB on Vercel Hobby.
- Local Python FastAPI (`api/`) still works for full eval/hybrid experiments via `.\launch.ps1`.

#### If you see `No FastAPI entrypoint found…`

Set **Root Directory** = `web` and **Framework** = **Next.js**, then redeploy.

## Security model

This section describes how the **live Vercel** app treats identity, data, and secrets. Treat it as a **public demo** unless you tighten the knobs below.

### Public demo auth (default)

- The browser does **not** log in with a password or OAuth.
- Each browser session gets a random **UUID** stored in `localStorage` and sent as `X-Tenant-Id`.
- That UUID **isolates data between sessions** (your uploads are not mixed with another visitor’s under a different id).
- UUIDs are **not identity**. Anyone can invent a UUID. Do not rely on this for private or regulated data.
- If the product becomes more than a public demo: set `REQUIRE_API_KEY=true` and only call the API from a trusted backend that injects `RAG_API_KEY`, **or** add real login (session/JWT) and map users to tenants server-side.

### Tenant isolation

- Ingest, list, delete, query, and study all scope work by `X-Tenant-Id`.
- Reserved ids (`default`, `public`, etc.) are rejected.
- On Vercel, tenant ids must be UUIDs.
- Deleting a document only removes that tenant’s copy.

### Secrets and uploads

- **Never** put API keys in `NEXT_PUBLIC_*` variables or client-side code.
- `XAI_API_KEY`, `RAG_API_KEY`, and `RAG_ADMIN_KEY` are **server-only** env vars on Vercel.
- Uploaded PDFs/text are processed for search; do not upload passwords, keys, or confidential documents to a public demo.
- Full chunk text is **not** returned in query contexts by default (excerpts only). Full text requires `include_full_context: true` plus admin/`ALLOW_FULL_CONTEXT`.

### Admin env vars

| Variable | Effect |
|----------|--------|
| `RAG_ADMIN_KEY` unset | Admin routes (`/eval`, `/demo/seed`, `/eval/history`) are **disabled** (403). Safe default. |
| `RAG_ADMIN_KEY` set | Admin routes require a matching `X-Admin-Key` (or Bearer) — missing key is rejected. |
| `REQUIRE_API_KEY=true` | All API access requires a valid `RAG_API_KEY` (breaks pure browser-only demos unless you add a BFF). |

### CORS

- Preflight does **not** use `Access-Control-Allow-Origin: *`.
- Allowed origins: `FRONTEND_URL`, `VERCEL_URL` / production host, `http://localhost:3000`, `http://127.0.0.1:3000`, plus `CORS_ORIGINS`.
- Optional: `ALLOW_VERCEL_PREVIEWS=true` for `https://*.vercel.app` previews.

### Weak retrieval / broad passages

- If nothing strongly matches a query, the answer is a soft refusal, not a confident dump of random pages.
- Optional **broad passages** (unrelated excerpts) are only shown in the UI when the user clicks **Show broad passages**.

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

### Security

- API keys live in **environment variables** (`.env` locally, Render/Vercel dashboards in prod) — never in git.
- CI runs **Gitleaks** on every push to block accidental secret commits.
- API responses omit internal paths; access logs disable client IP logging (`--no-access-log`).
- Rate limits and upload size caps on sensitive endpoints. Rotate any key that was ever pasted in chat or committed.