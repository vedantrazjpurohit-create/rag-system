# eval/

Offline benchmark harness for **rag-system** — metrics, BM25/hybrid/router, sample corpus.

See the root [README](../README.md) for setup. Run standalone eval with:

```powershell
$env:HF_HOME = "$PWD\..\.hf_cache"
.\.venv\Scripts\python.exe eval/scripts/run_eval.py --config eval/configs/default.yaml --strategy hybrid
```