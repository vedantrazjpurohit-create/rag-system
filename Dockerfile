FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api api
COPY eval eval
COPY results results
COPY scripts/start-api.sh scripts/start-api.sh

ENV HF_HOME=/app/.hf_cache
ENV PYTHONPATH=/app/api:/app/eval
ENV CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
ENV ALLOW_VERCEL_PREVIEWS=true

# Pre-cache embedder at build time (faster cold starts on Render)
RUN mkdir -p /app/.hf_cache && python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

RUN chmod +x /app/scripts/start-api.sh

EXPOSE 8000

CMD ["/app/scripts/start-api.sh"]