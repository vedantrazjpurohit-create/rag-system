# api/

FastAPI service for **rag-system** — ingest, query, stats, eval, and eval history.

See the root [README](../README.md) for setup and endpoints. Run with:

```powershell
$env:HF_HOME = "$PWD\..\.hf_cache"
.\.venv\Scripts\uvicorn.exe api.app.main:app --reload --app-dir api
```