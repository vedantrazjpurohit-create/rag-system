import type {
  AdversarialComparison,
  AppConfig,
  BenchmarkComparison,
  DocumentInfo,
  IngestResponse,
  QueryResponse,
  Stats,
  Strategy,
  StudyMode,
  StudyResponse,
} from "./types";
import { TenantUnavailableError, getTenantId } from "./tenant";

/** Browser uses same-origin /api-proxy (keys stay on the server). Local SSR hits the API directly. */
const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ??
  (typeof window !== "undefined"
    ? "/api-proxy"
    : (process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8000").replace(/\/+$/, ""));

function tenantHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (typeof window !== "undefined") {
    try {
      headers.set("X-Tenant-Id", getTenantId());
    } catch (err) {
      if (err instanceof TenantUnavailableError) {
        throw err;
      }
      throw new TenantUnavailableError("Could not initialize a private session id.");
    }
  }
  return headers;
}

function parseDetail(detail: string): string {
  const trimmed = detail.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as { detail?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (Array.isArray(parsed.detail)) {
      return parsed.detail
        .map((item) => (typeof item === "object" && item && "msg" in item ? String(item.msg) : String(item)))
        .join("; ");
    }
  } catch {
    /* plain text error */
  }
  return trimmed;
}

function formatError(status: number, detail: string): string {
  const message = parseDetail(detail);
  if (status === 401) {
    return message || "Unauthorized — API key missing or invalid on the server.";
  }
  if (status === 400) {
    return message || "Bad request — check file type and size (max 5MB).";
  }
  if (status === 403) {
    return message || "Forbidden — this action requires admin access.";
  }
  if (status === 413) {
    return message || "File too large — max 5MB on this server.";
  }
  if (status === 422) {
    return message || "Could not read this file — try a smaller PDF or plain text.";
  }
  if (status === 429) {
    return message || "Too many uploads — wait a minute and try again.";
  }
  if (status === 502 || status === 503) {
    return "Server overloaded (502). On Render free tier, use BM25 strategy and smaller files, or upgrade RAM.";
  }
  return message || `Request failed: ${status}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: tenantHeaders(init?.headers),
    });
  } catch {
    throw new Error(
      "Server unreachable — it may have restarted under memory pressure. Wait ~30s and try again.",
    );
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(formatError(response.status, detail));
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
  form.append("file", file, file.name);
  const headers = tenantHeaders();
  return request("/ingest", { method: "POST", headers, body: form });
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
    headers: tenantHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ question, strategy, top_k: topK }),
  });

  if (!response.ok || !response.body) {
    handlers.onError(formatError(response.status, await response.text()));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatchEvent = (part: string) => {
    const line = part.trim();
    if (!line.startsWith("data: ")) return;
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
  };

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
    }
    const parts = buffer.split("\n\n");
    if (done) {
      for (const part of parts) dispatchEvent(part);
      break;
    }
    buffer = parts.pop() ?? "";
    for (const part of parts) dispatchEvent(part);
  }
}

export function runStudy(payload: {
  mode: StudyMode;
  topic: string;
  top_k?: number;
  count?: number;
  strategy?: Strategy;
}): Promise<StudyResponse> {
  return request("/study", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: payload.mode,
      topic: payload.topic,
      top_k: payload.top_k ?? 8,
      count: payload.count ?? 8,
      strategy: payload.strategy,
    }),
  });
}

export { API_BASE };