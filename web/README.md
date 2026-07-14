# web/

Next.js frontend for **rag-system**.

## Dev

```powershell
# from repo root — start API first
.\.venv\Scripts\uvicorn.exe api.app.main:app --reload --app-dir api

# then frontend
cd web
copy .env.local.example .env.local
npm install
npm run dev
```

Open http://localhost:3000

## Pages

| Tab | Features |
|-----|----------|
| **Demo** | File upload, document list, chat with strategy selector, retrieved context panel |
| **Safety Lab** | Adversarial before/after pass rates from `/adversarial/summary` |

## Env

| Variable | Default |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:8000` |