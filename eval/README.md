# eval/

Offline benchmark harness for **rag-system** — metrics, BM25/hybrid/router, adversarial failure-mode eval.

## Quick runs

```powershell
$env:HF_HOME = "$PWD\..\.hf_cache"

# Happy-path benchmark (2 questions, trusted corpus)
.\.venv\Scripts\python.exe eval/scripts/run_eval.py --config eval/configs/default.yaml --strategy hybrid

# Adversarial before/after (OOD + poison guardrails)
.\.venv\Scripts\python.exe eval/scripts/run_failure_analysis.py --both
```

## Adversarial eval (OOD + poison)

See **[ADVERSARIAL_EVAL.md](ADVERSARIAL_EVAL.md)** for the full story: baseline 0% pass rates, guardrail fixes, before/after tables, and remaining gaps.

| Path | Role |
|------|------|
| `data/adversarial_questions.jsonl` | 22 failure-mode probes |
| `data/raw_adversarial/` | Corpus + poison doc |
| `configs/adversarial.yaml` | Adversarial eval config |
| `src/retrieval/guard.py` | Trust tiers + OOD/poison guardrails |
| `results/failure_analysis_*.json` | Committed before/after artifacts |

Root [README](../README.md) has the summary tables for recruiters and CI.