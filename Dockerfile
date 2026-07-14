# Production site: FastAPI (internal) + Next.js (public PORT)
FROM node:24-alpine AS frontend-build
WORKDIR /app/web
COPY web/package-lock.json web/package.json ./
RUN npm ci
COPY web .
ENV NEXT_PUBLIC_API_URL=/api-proxy
ENV API_PROXY_TARGET=http://127.0.0.1:8000
RUN npm run build

FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl ca-certificates gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api api
COPY eval eval
COPY results results
COPY scripts scripts
COPY --from=frontend-build /app/web /app/web

ENV HF_HOME=/app/.hf_cache
ENV PYTHONPATH=/app/api:/app/eval
ENV CHROMA_PATH=/app/data/chroma
ENV API_PROXY_TARGET=http://127.0.0.1:8000
ENV ALLOW_VERCEL_PREVIEWS=true

RUN mkdir -p /app/.hf_cache /app/data/chroma \
    && python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')" \
    && chmod +x /app/scripts/start-site.sh

EXPOSE 10000

CMD ["/app/scripts/start-site.sh"]