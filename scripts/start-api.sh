#!/usr/bin/env sh
set -eu
PORT="${PORT:-8000}"
exec python -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --no-access-log --log-level warning