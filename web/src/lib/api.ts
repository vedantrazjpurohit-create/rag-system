import type {
  AdversarialComparison,
  AppConfig,
  BenchmarkComparison,
  DocumentInfo,
  IngestResponse,
  QueryResponse,
  Stats,
  Strategy,
} from "./types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ??
  (typeof window !== "undefined" ? "/api-proxy" : "http://127.0.0.1:8000");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function getHealth(): Promise<{ status: string }> {
  return request("/health");
}

export function getStats(): Promise<Stats> {
  return request("/stats");
}

export function listDocuments(): Promise<{ documents: DocumentInfo[] }> {
  return request("/documents");
}

export async function ingestFile(file: File): Promise<IngestResponse> {
  const form = new FormData();
  form.append("file", file);
  return request("/ingest", { method: "POST", body: form });
}

export function queryDocuments(
  question: string,
  strategy: Strategy,
  topK = 5,
): Promise<QueryResponse> {
  return request("/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, strategy, top_k: topK }),
  });
}

export function deleteDocument(docId: string): Promise<{ deleted: string; stats: Stats }> {
  return request(`/documents/${encodeURIComponent(docId)}`, { method: "DELETE" });
}

export function getAdversarialSummary(): Promise<AdversarialComparison> {
  return request("/adversarial/summary");
}

export function getAppConfig(): Promise<AppConfig> {
  return request("/config");
}

export function getBenchmarksSummary(): Promise<BenchmarkComparison> {
  return request("/benchmarks/summary");
}

export function runEvalCompare(): Promise<{
  num_questions: number;
  strategies: BenchmarkComparison;
}> {
  return request("/eval/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persist: true }),
  });
}

export function getEvalHistory(limit = 20): Promise<{ runs: import("./types").EvalHistoryRun[] }> {
  return request(`/eval/history?limit=${limit}`);
}

export function seedDemo(): Promise<{
  seeded: { source: string; doc_id: string; chunks_indexed: number }[];
  total_chunks: number;
}> {
  return request("/demo/seed", { method: "POST" });
}

export async function queryStream(
  question: string,
  strategy: Strategy,
  handlers: {
    onMeta: (data: { contexts: QueryResponse["contexts"]; strategy: Strategy; retrieve_ms: number }) => void;
    onToken: (token: string) => void;
    onDone: (data: Pick<QueryResponse, "answer" | "answer_mode" | "timing_ms" | "strategy">) => void;
    onError: (message: string) => void;
  },
  topK = 5,
): Promise<void> {
  const response = await fetch(`${API_BASE}/query/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, strategy, top_k: topK }),
  });

  if (!response.ok || !response.body) {
    handlers.onError(await response.text());
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data: ")) continue;
      const payload = JSON.parse(line.slice(6)) as Record<string, unknown>;
      if (payload.type === "meta") {
        handlers.onMeta({
          contexts: payload.contexts as QueryResponse["contexts"],
          strategy: payload.strategy as Strategy,
          retrieve_ms: payload.retrieve_ms as number,
        });
      } else if (payload.type === "token") {
        handlers.onToken(String(payload.content ?? ""));
      } else if (payload.type === "done") {
        handlers.onDone({
          answer: String(payload.answer ?? ""),
          answer_mode: String(payload.answer_mode ?? "template"),
          strategy,
          timing_ms: payload.timing_ms as QueryResponse["timing_ms"],
        });
      }
    }
  }
}

export { API_BASE };