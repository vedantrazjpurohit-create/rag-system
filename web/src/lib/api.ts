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
import { listLocalDocuments, removeLocalDocument, saveLocalDocument } from "./localCorpus";
import { TenantUnavailableError, getTenantId } from "./tenant";

/**
 * Default: same-origin /api-proxy (full stack on Vercel Next.js).
 * Override with NEXT_PUBLIC_API_URL only for local Python API (http://127.0.0.1:8000).
 */
const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ??
  (typeof window !== "undefined" ? "/api-proxy" : "/api-proxy");

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
      "Server unreachable — wait ~30s for Render free tier to wake, then try again.",
    );
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(formatError(response.status, detail));
  }
  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `API returned non-JSON for ${path}. Check Vercel API_PROXY_TARGET (use …/api-proxy if Render is still the monorepo app).`,
    );
  }
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
  if (file.size <= 0) {
    throw new Error("File is empty.");
  }
  // Vercel serverless request body limit is ~4.5MB on Hobby.
  if (file.size > 4.5 * 1024 * 1024) {
    throw new Error("File is too large for upload through Vercel (max ~4.5MB). Use a smaller PDF.");
  }
  const form = new FormData();
  form.append("file", file, file.name);
  // Only tenant header — never set Content-Type; browser must set multipart boundary.
  const headers = tenantHeaders();
  const result = await request<IngestResponse>("/ingest", { method: "POST", headers, body: form });
  if (!result?.chunks_indexed) {
    throw new Error(
      "Upload indexed 0 chunks — the file may have no extractable text (scanned PDF). Try a text PDF or .txt/.md.",
    );
  }
  if (!result.text?.trim()) {
    throw new Error("Upload succeeded but no text was returned for browser cache. Try again.");
  }
  // Required for Vercel: every later query attaches this text in the same HTTP request
  try {
    await saveLocalDocument({
      doc_id: result.doc_id || crypto.randomUUID(),
      source: result.source || file.name,
      text: result.text,
      chunks_indexed: result.chunks_indexed ?? 0,
    });
  } catch {
    throw new Error(
      "Could not save the file in this browser (storage blocked or full). Allow site data / try another browser.",
    );
  }
  return result;
}

/** Browser-cached PDFs to attach on the same request as query/study (required on Vercel). */
async function localDocumentsPayload(): Promise<{ source: string; text: string; doc_id: string }[]> {
  try {
    const local = await listLocalDocuments();
    const out: { source: string; text: string; doc_id: string }[] = [];
    let total = 0;
    for (const d of local) {
      if (!d.text?.trim()) continue;
      if (out.length >= 8) break;
      // Stay under Vercel ~4.5MB request body
      const room = 3_500_000 - total;
      if (room < 2000) break;
      const text = d.text.slice(0, Math.min(400_000, room));
      total += text.length;
      out.push({ source: d.source, text, doc_id: d.doc_id });
    }
    return out;
  } catch {
    return [];
  }
}

/** Optional warm-up; library list may still be empty on a cold instance until query carries docs. */
export async function syncLocalCorpus(): Promise<{ synced: number; documents: DocumentInfo[] }> {
  const documents = await localDocumentsPayload();
  if (!documents.length) {
    try {
      const remote = await listDocuments();
      return { synced: 0, documents: remote.documents ?? [] };
    } catch {
      return { synced: 0, documents: [] };
    }
  }
  const result = await request<{ synced: number; documents: DocumentInfo[] }>("/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documents }),
  });
  return {
    synced: result.synced ?? 0,
    documents: result.documents ?? [],
  };
}

export async function queryDocuments(
  question: string,
  strategy: Strategy,
  topK = 5,
): Promise<QueryResponse> {
  const documents = await localDocumentsPayload();
  return request("/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, strategy, top_k: topK, documents }),
  });
}

export async function deleteDocument(docId: string): Promise<{ deleted: string; stats: Stats }> {
  const result = await request<{ deleted: string; stats: Stats }>(
    `/documents/${encodeURIComponent(docId)}`,
    { method: "DELETE" },
  );
  await removeLocalDocument(docId);
  return result;
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
  const documents = await localDocumentsPayload();
  if (!documents.length) {
    handlers.onError(
      "No PDF text is cached in this browser. Upload your file again on Workspace, then ask.",
    );
    return;
  }
  const response = await fetch(`${API_BASE}/query/stream`, {
    method: "POST",
    headers: tenantHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ question, strategy, top_k: topK, documents }),
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

export async function runStudy(payload: {
  mode: StudyMode;
  topic: string;
  top_k?: number;
  count?: number;
  strategy?: Strategy;
}): Promise<StudyResponse> {
  const documents = payload.mode === "web" ? [] : await localDocumentsPayload();
  return request("/study", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: payload.mode,
      topic: payload.topic,
      top_k: payload.top_k ?? 8,
      count: payload.count ?? 8,
      strategy: payload.strategy,
      documents,
    }),
  });
}

export { API_BASE };