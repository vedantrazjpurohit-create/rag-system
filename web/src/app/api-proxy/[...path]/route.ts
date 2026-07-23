import { NextRequest, NextResponse } from "next/server";

import { AuthError, requireAdmin, requireApiAccess } from "@/lib/server/auth";
import { extractUploadText } from "@/lib/server/extract";
import {
  generateAnswer,
  generateDefinition,
  generateStudyNotes,
  generateWebSummary,
  llmEnabled,
  llmModel,
  llmProviderName,
} from "@/lib/server/llm";
import {
  deleteDocument,
  ingestText,
  listDocuments,
  search,
  stats,
  syncDocuments,
  type SearchOutcome,
} from "@/lib/server/store";
import type { SearchHit } from "@/lib/server/types";
import { fetchWeb, templateWebParagraph } from "@/lib/server/webSearch";

export const runtime = "nodejs";
// OCR on scanned PDFs is slower; keep within Vercel Hobby max (60s)
// Long lecture PDFs (up to 500 pages) + OCR. Pro plan needed for full 300s on Vercel.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_BYTES || 150 * 1024 * 1024);

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function err(status: number, detail: string) {
  return json({ detail }, status);
}

function allowFullContext(request: NextRequest, bodyFlag?: boolean): boolean {
  if (bodyFlag !== true) return false;
  // Only trusted callers: admin key or explicit debug env
  if (process.env.ALLOW_FULL_CONTEXT === "true" || process.env.ALLOW_FULL_CONTEXT === "1") {
    return true;
  }
  try {
    requireAdmin(request);
    return true;
  } catch {
    return false;
  }
}

function publicContexts(hits: SearchHit[], includeFull: boolean) {
  return hits.map((h) => ({
    chunk_id: h.chunk_id,
    doc_id: h.doc_id,
    source: h.source,
    score: h.score,
    // Preserve page for accurate multi-PDF citations in the UI
    ...(h.page !== undefined ? { page: h.page } : {}),
    excerpt: h.excerpt || h.text.slice(0, 320),
    ...(includeFull ? { text: h.text } : {}),
  }));
}

async function parseJsonBody<T>(request: NextRequest): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new ClientError(400, "Malformed JSON body");
    }
    const msg = e instanceof Error ? e.message : "Invalid request body";
    if (/json|unexpected|parse/i.test(msg)) {
      throw new ClientError(400, "Malformed JSON body");
    }
    throw new ClientError(400, "Invalid request body");
  }
}

class ClientError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function corsOrigin(request: NextRequest): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  const allowed = new Set<string>();
  const frontend = process.env.FRONTEND_URL?.trim().replace(/\/+$/, "");
  if (frontend) allowed.add(frontend);

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    allowed.add(vercel.startsWith("http") ? vercel.replace(/\/+$/, "") : `https://${vercel}`);
  }
  const project = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (project) {
    allowed.add(project.startsWith("http") ? project.replace(/\/+$/, "") : `https://${project}`);
  }

  allowed.add("http://localhost:3000");
  allowed.add("http://127.0.0.1:3000");

  const extra = process.env.CORS_ORIGINS?.split(",") || [];
  for (const item of extra) {
    const o = item.trim().replace(/\/+$/, "");
    if (o) allowed.add(o);
  }

  if (allowed.has(origin)) return origin;

  // Preview deployments: https://*-team.vercel.app
  if (
    (process.env.ALLOW_VERCEL_PREVIEWS === "true" || process.env.ALLOW_VERCEL_PREVIEWS === "1") &&
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)
  ) {
    return origin;
  }

  return null;
}

function withCors(request: NextRequest, response: NextResponse): NextResponse {
  const origin = corsOrigin(request);
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
    response.headers.set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Accept, Authorization, X-API-Key, X-Admin-Key, X-Tenant-Id",
    );
  }
  return response;
}

async function handle(
  request: NextRequest,
  pathSegments: string[],
): Promise<NextResponse> {
  const path = pathSegments.length ? `/${pathSegments.join("/")}` : "/";
  const method = request.method.toUpperCase();

  try {
    if (method === "GET" && path === "/health") {
      return json({ status: "ok", engine_loaded: true, host: "vercel" });
    }

    if (method === "GET" && path === "/config") {
      return json({
        llm_enabled: llmEnabled(),
        web_search_enabled: process.env.WEB_SEARCH_ENABLED !== "false",
        llm_model: llmModel(),
        llm_provider: llmProviderName(),
        strategies: ["bm25", "router", "vector", "hybrid"],
        persistence_enabled: true,
        embedder_backend: "none",
        low_memory_mode: true,
        default_strategy: "bm25",
        auth_required:
          Boolean(process.env.RAG_API_KEY?.trim()) &&
          (process.env.REQUIRE_API_KEY === "true" || process.env.REQUIRE_API_KEY === "1"),
        admin_auth_required: Boolean(process.env.RAG_ADMIN_KEY?.trim()),
        tenant_header_required: true,
        tenant_uuid_required: true,
        public_demo_auth:
          !(process.env.REQUIRE_API_KEY === "true" || process.env.REQUIRE_API_KEY === "1"),
        serverless: true,
      });
    }

    if (method === "GET" && path === "/benchmarks/summary") {
      return json({});
    }

    if (method === "GET" && path === "/adversarial/summary") {
      return json({ baseline: {}, guarded: {}, delta_pass_rate: {} });
    }

    if (method === "GET" && path === "/eval/history") {
      requireAdmin(request);
      return json({ runs: [] });
    }

    if (method === "GET" && path === "/stats") {
      const tenant = requireApiAccess(request);
      return json(await stats(tenant));
    }

    if (method === "GET" && path === "/documents") {
      const tenant = requireApiAccess(request);
      return json({ documents: await listDocuments(tenant) });
    }

    if (method === "DELETE" && path.startsWith("/documents/")) {
      // Tenant-scoped delete of own docs. Idempotent: missing doc is still success.
      const tenant = requireApiAccess(request);
      const docId = decodeURIComponent(path.slice("/documents/".length));
      const source = request.nextUrl.searchParams.get("source") || undefined;
      await deleteDocument(docId, tenant, source || undefined);
      return json({ deleted: docId, stats: await stats(tenant) });
    }

    if (method === "POST" && path === "/sync") {
      const tenant = requireApiAccess(request);
      const body = await parseJsonBody<{
        documents?: { source: string; text: string; doc_id?: string }[];
      }>(request);
      const docs = Array.isArray(body.documents) ? body.documents : [];
      const limited = docs
        .slice(0, 20)
        .map((d) => ({
          source: String(d.source || "upload").slice(0, 200),
          text: String(d.text || "").slice(0, 500_000),
          doc_id: d.doc_id,
        }))
        .filter((d) => d.text.trim());
      const result = await syncDocuments(tenant, limited);
      return json(result);
    }

    if (method === "POST" && path === "/ingest") {
      const tenant = requireApiAccess(request);
      const form = await request.formData();
      const file = form.get("file");
      if (!file || !(file instanceof File)) {
        return err(422, "Missing file field");
      }
      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.length > MAX_UPLOAD) {
        return err(413, `Upload too large. Max size is ${Math.floor(MAX_UPLOAD / (1024 * 1024))}MB.`);
      }
      if (buf.length === 0) return err(422, "Uploaded file is empty");

      let text: string;
      try {
        text = await extractUploadText(buf, file.name || "upload");
      } catch (e) {
        return err(422, e instanceof Error ? e.message : "Could not read file");
      }
      if (!text.trim()) return err(422, "Uploaded file has no readable text");

      const result = await ingestText(text, file.name || "upload", tenant);
      return json(result);
    }

    if (method === "POST" && (path === "/query" || path === "/query/stream")) {
      const tenant = requireApiAccess(request);
      const body = await parseJsonBody<{
        question?: string;
        top_k?: number;
        strategy?: string;
        documents?: { source: string; text: string; doc_id?: string }[];
        include_full_context?: boolean;
      }>(request);
      const question = (body.question || "").trim();
      if (question.length < 3) return err(422, "Question too short");
      if (Array.isArray(body.documents) && body.documents.length) {
        await syncDocuments(
          tenant,
          body.documents.slice(0, 20).map((d) => ({
            source: String(d.source || "upload").slice(0, 200),
            text: String(d.text || "").slice(0, 500_000),
            doc_id: d.doc_id,
          })),
        );
      }
      // Higher default k — multi-doc search raises further inside retrieve.ts
      const topK = body.top_k !== undefined ? Math.min(20, Math.max(1, body.top_k)) : undefined;
      const includeFull = allowFullContext(request, body.include_full_context);
      const t0 = performance.now();
      const outcome: SearchOutcome = await search(question, tenant, topK);
      const retrieveMs = performance.now() - t0;
      const contexts = publicContexts(outcome.hits, includeFull);
      const broad = publicContexts(outcome.broad_passages, false);

      const corpusStats = await stats(tenant);
      const hasCorpus = corpusStats.chunk_count > 0;

      if (path === "/query/stream") {
        const t1 = performance.now();
        const { answer, mode } = await generateAnswer(question, outcome.hits, {
          weakMatch: outcome.weak_match,
          hasCorpus,
        });
        const generateMs = performance.now() - t1;
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const meta = {
              type: "meta",
              contexts,
              broad_passages: broad,
              weak_match: outcome.weak_match,
              strategy: "bm25",
              retrieve_ms: Math.round(retrieveMs * 100) / 100,
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(meta)}\n\n`));
            const words = answer.split(" ");
            words.forEach((word, idx) => {
              const token = idx === 0 ? word : ` ${word}`;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "token", content: token })}\n\n`),
              );
            });
            const done = {
              type: "done",
              answer,
              answer_mode: mode,
              strategy: "bm25",
              weak_match: outcome.weak_match,
              timing_ms: {
                retrieve: Math.round(retrieveMs * 100) / 100,
                generate: Math.round(generateMs * 100) / 100,
                total: Math.round((retrieveMs + generateMs) * 100) / 100,
              },
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(done)}\n\n`));
            controller.close();
          },
        });
        return new NextResponse(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      const t1 = performance.now();
      const { answer, mode } = await generateAnswer(question, outcome.hits, {
        weakMatch: outcome.weak_match,
        hasCorpus,
      });
      const generateMs = performance.now() - t1;
      return json({
        answer,
        contexts,
        broad_passages: broad,
        weak_match: outcome.weak_match,
        strategy: "bm25",
        answer_mode: mode,
        timing_ms: {
          retrieve: Math.round(retrieveMs * 100) / 100,
          generate: Math.round(generateMs * 100) / 100,
          total: Math.round((retrieveMs + generateMs) * 100) / 100,
        },
      });
    }

    if (method === "POST" && path === "/study") {
      const tenant = requireApiAccess(request);
      const body = await parseJsonBody<{
        mode?: string;
        topic?: string;
        top_k?: number;
        count?: number;
        documents?: { source: string; text: string; doc_id?: string }[];
        include_full_context?: boolean;
      }>(request);
      const mode = body.mode || "notes";
      const topic = (body.topic || "").trim();
      if (topic.length < 2) return err(422, "Topic too short");
      const started = performance.now();
      const includeFull = allowFullContext(request, body.include_full_context);

      if (mode === "web") {
        const web = await fetchWeb(topic);
        const summary = llmEnabled()
          ? await generateWebSummary(topic, web.snippets)
          : templateWebParagraph(topic, web);
        return json({
          mode: "web",
          topic,
          summary,
          sources: web.sources,
          provider: web.provider,
          search_error: web.error || null,
          answer_mode: llmEnabled() && web.snippets.length ? "llm" : "template",
          timing_ms: { total: Math.round((performance.now() - started) * 100) / 100 },
        });
      }

      if (Array.isArray(body.documents) && body.documents.length) {
        await syncDocuments(
          tenant,
          body.documents.slice(0, 20).map((d) => ({
            source: String(d.source || "upload").slice(0, 200),
            text: String(d.text || "").slice(0, 500_000),
            doc_id: d.doc_id,
          })),
        );
      }

      const topK = body.top_k !== undefined ? Math.min(20, Math.max(1, body.top_k)) : undefined;
      const t0 = performance.now();
      let outcome = await search(topic, tenant, topK);
      if (!outcome.hits.length && topic.includes(" ")) {
        outcome = await search(topic.split(/\s+/).slice(0, 3).join(" "), tenant, topK);
      }
      const retrieveMs = performance.now() - t0;
      const hits = outcome.hits;
      const contexts = publicContexts(hits, includeFull);
      const broad = publicContexts(outcome.broad_passages, false);

      if (mode === "notes") {
        const notes = await generateStudyNotes(topic, hits);
        return json({
          mode,
          topic,
          notes: outcome.weak_match && !hits.length
            ? `${notes}${broad.length ? "\n\nNo strong match — try different keywords." : ""}`
            : notes,
          contexts,
          broad_passages: broad,
          weak_match: outcome.weak_match,
          strategy: "bm25",
          answer_mode: llmEnabled() && hits.length ? "llm" : "template",
          matched_passages: hits.length,
          timing_ms: {
            retrieve: Math.round(retrieveMs * 100) / 100,
            generate: Math.round((performance.now() - started - retrieveMs) * 100) / 100,
            total: Math.round((performance.now() - started) * 100) / 100,
          },
        });
      }

      if (mode === "define") {
        const term = topic.replace(/^(?:define|what is|what's|meaning of)\s+/i, "").trim() || topic;
        const definition = await generateDefinition(term, hits);
        return json({
          mode,
          topic,
          term,
          definition,
          contexts,
          broad_passages: broad,
          weak_match: outcome.weak_match,
          strategy: "bm25",
          answer_mode: llmEnabled() && hits.length ? "llm" : "template",
          matched_passages: hits.length,
          timing_ms: {
            retrieve: Math.round(retrieveMs * 100) / 100,
            generate: Math.round((performance.now() - started - retrieveMs) * 100) / 100,
            total: Math.round((performance.now() - started) * 100) / 100,
          },
        });
      }

      if (mode === "flashcards") {
        const count = Math.min(12, Math.max(1, body.count || 8));
        const cards = hits.slice(0, count).map((h) => ({
          front: `What does your material say about “${topic}” in ${h.source}?`,
          back: (h.excerpt || h.text).slice(0, 220),
          source: h.source,
        }));
        if (!cards.length) {
          cards.push({
            front: `Define “${topic}” from your uploaded notes`,
            back: outcome.weak_match
              ? "No strong match for that topic. Try different keywords or re-upload a clearer PDF."
              : "Upload PDFs that mention this topic, then regenerate flashcards.",
            source: "Index",
          });
        }
        return json({
          mode,
          topic,
          cards,
          contexts,
          broad_passages: broad,
          weak_match: outcome.weak_match,
          strategy: "bm25",
          answer_mode: "template",
          matched_passages: hits.length,
          timing_ms: {
            retrieve: Math.round(retrieveMs * 100) / 100,
            generate: 0,
            total: Math.round((performance.now() - started) * 100) / 100,
          },
        });
      }

      return err(422, `Unsupported study mode: ${mode}`);
    }

    if (method === "POST" && path === "/demo/seed") {
      requireAdmin(request);
      return err(404, "Demo seed is not available on the Vercel serverless build");
    }

    if (method === "POST" && (path === "/eval" || path === "/eval/compare")) {
      requireAdmin(request);
      return err(501, "Eval endpoints run from the Python API / local harness, not serverless.");
    }

    return err(404, `Not found: ${method} ${path}`);
  } catch (e) {
    if (e instanceof AuthError) return err(e.status, e.message);
    if (e instanceof ClientError) return err(e.status, e.message);
    console.error("api-proxy error", e);
    return err(500, e instanceof Error ? e.message : "Internal server error");
  }
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return withCors(request, await handle(request, path));
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return withCors(request, await handle(request, path));
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return withCors(request, await handle(request, path));
}

export async function OPTIONS(request: NextRequest) {
  const origin = corsOrigin(request);
  if (!origin) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Accept, Authorization, X-API-Key, X-Admin-Key, X-Tenant-Id",
      "Access-Control-Max-Age": "86400",
    },
  });
}
