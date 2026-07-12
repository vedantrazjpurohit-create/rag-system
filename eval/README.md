# rag-eval-bench

Small RAG evaluation harness I built while trying to answer one question: **does my retrieval actually help, or am I just paying for embeddings?**

Most tutorials stop at "build a chatbot." This repo measures what matters — retrieval precision, answer faithfulness, and latency — on a fixed corpus so you can compare chunk sizes, embedding models, and rerankers without guessing.

## Why I built this

I kept shipping RAG demos that *felt* smart in a notebook and fell apart on real PDFs (tables, headers, duplicated sections). Instead of another LangChain wrapper, I wanted a reproducible bench I could rerun after every change.

**What surprised me:** shrinking chunks from 1024 → 256 tokens improved recall@5 on my test set, but hallucination rate went up unless I added a strict citation check. Trade-offs are the whole game.

## What it does

- Ingests PDFs / markdown with configurable chunking
- Runs retrieval with pluggable embedders (local `sentence-transformers` or API)
- Scores answers with:
  - **Retrieval:** recall@k, MRR, nDCG
  - **Generation:** faithfulness (claim-level), citation coverage
  - **Ops:** p50/p95 latency per stage
- Outputs a single `results/run_<timestamp>.json` you can diff in PRs

## Quick start

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt

# add docs to data/raw/, then:
python scripts/run_eval.py --config configs/default.yaml
```

Sample output (`results/sample_run.json`):

```json
{
  "metrics": {
    "retrieval.recall_at_k": 0.5,
    "retrieval.mrr": 0.5,
    "gen.faithfulness": 0.8,
    "gen.citation_coverage": 1.0,
    "latency.p95_ms": 16.8
  }
}
```

## Project layout

```
src/
  ingestion/     # loaders + chunkers
  retrieval/     # embed, index, search
  evaluation/    # metrics + judges
  pipeline.py    # end-to-end runner
configs/         # experiment configs (YAML)
scripts/         # CLI entrypoints
tests/           # unit tests for metrics
```

## Design notes

- **Configs over code** — every experiment is a YAML diff, not a fork.
- **Deterministic seeds** — same data + config → same metrics (modulo API variance).
- **No hidden prompts** — judge prompts live in `configs/judges/` and are versioned.
- **Fails loud** — empty retrieval returns explicit errors, not silent GPT improvisation.

## Roadmap

- [ ] BM25 + hybrid fusion baseline
- [ ] Async batch eval for 1k+ questions
- [ ] Export to Weights & Biases

## Stack

Python 3.11 · ChromaDB · sentence-transformers · PyMuPDF · pydantic · pytest

## Related repos

- [rag-api](https://github.com/vedantrazjpurohit-create/rag-api) — deployable FastAPI wrapper
- [aruco-localizer](https://github.com/vedantrazjpurohit-create/aruco-localizer) — vision / pose for robotics
- [student-crud-c](https://github.com/vedantrazjpurohit-create/student-crud-c) — C systems fundamentals

---

If you're hiring for applied LLM / retrieval work, the commit history here is intentionally boring — small PRs, measured changes, notes on what didn't work. That's the point.