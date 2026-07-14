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

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

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

export { API_BASE };