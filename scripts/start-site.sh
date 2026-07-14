#!/usr/bin/env sh
set -eu

API_PORT="${API_PORT:-8000}"
WEB_PORT="${PORT:-3000}"

echo "Starting API on 127.0.0.1:${API_PORT}..."
python -m uvicorn app.main:app --host 127.0.0.1 --port "${API_PORT}" &
API_PID=$!

echo "Starting web on 0.0.0.0:${WEB_PORT}..."
cd /app/web
exec npm start -- -H 0.0.0.0 -p "${WEB_PORT}"