#!/usr/bin/env sh
set -eu

API_PORT="${API_PORT:-8000}"
WEB_PORT="${PORT:-10000}"

echo "Preflight: importing FastAPI app..."
python -c "from app.main import app; print('API import OK')"

echo "Starting API on 127.0.0.1:${API_PORT}..."
python -m uvicorn app.main:app --host 127.0.0.1 --port "${API_PORT}" &
API_PID=$!

echo "Waiting for API health..."
TRIES=45
while [ "$TRIES" -gt 0 ]; do
  if curl -sf "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
    echo "API healthy"
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "API process exited during startup"
    wait "$API_PID" || true
    exit 1
  fi
  TRIES=$((TRIES - 1))
  sleep 1
done

if [ "$TRIES" -eq 0 ]; then
  echo "API failed to become healthy in time"
  exit 1
fi

echo "Starting Next.js on 0.0.0.0:${WEB_PORT}..."
cd /app/web
exec npx next start -H 0.0.0.0 -p "${WEB_PORT}"