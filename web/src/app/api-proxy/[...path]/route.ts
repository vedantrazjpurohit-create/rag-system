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
} from "@/lib/server/llm";
import {
  deleteDocument,
  ingestText,
  listDocuments,
  search,
  stats,
  syncDocuments,
} from "@/lib/server/store";
import { fetchWeb, templateWebParagraph } from "@/lib/server/webSearch";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_BYTES || 4.5 * 1024 * 1024);

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function err(status: number, detail: string) {
  return json({ detail }, status);
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
        strategies: ["bm25", "router", "vector", "hybrid"],
        persistence_enabled: true,
        embedder_backend: "none",
        low_memory_mode: true,
        default_strategy: "bm25",
        auth_required: Boolean(process.env.RAG_API_KEY?.trim()),
        admin_auth_required: Boolean(process.env.RAG_ADMIN_KEY?.trim()),
        tenant_header_required: true,
        tenant_uuid_required: true,
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
      requireAdmin(request);
      const tenant = requireApiAccess(request);
      const docId = decodeURIComponent(path.slice("/documents/".length));
      const ok = await deleteDocument(docId, tenant);
      if (!ok) return err(404, `Document not found: ${docId}`);
      return json({ deleted: docId, stats: await stats(tenant) });
    }

    if (method === "POST" && path === "/sync") {
      const tenant = requireApiAccess(request);
      const body = (await request.json()) as {
        documents?: { source: string; text: string; doc_id?: string }[];
      };
      const docs = Array.isArray(body.documents) ? body.documents : [];
      // Cap payload size for safety
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
      const body = (await request.json()) as {
        question?: string;
        top_k?: number;
        strategy?: string;
        documents?: { source: string; text: string; doc_id?: string }[];
      };
      const question = (body.question || "").trim();
      if (question.length < 3) return err(422, "Question too short");
      // Same-request corpus: never trust a prior /sync on another Vercel instance
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
      const topK = Math.min(20, Math.max(1, body.top_k || 5));
      const t0 = performance.now();
      const hits = await search(question, tenant, topK);
      const retrieveMs = performance.now() - t0;
      const contexts = hits.map((h) => ({
        chunk_id: h.chunk_id,
        doc_id: h.doc_id,
        source: h.source,
        score: h.score,
        excerpt: h.excerpt || h.text.slice(0, 320),
        text: h.text,
      }));

      if (path === "/query/stream") {
        const t1 = performance.now();
        const { answer, mode } = await generateAnswer(question, hits);
        const generateMs = performance.now() - t1;
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const meta = {
              type: "meta",
              contexts,
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
      const { answer, mode } = await generateAnswer(question, hits);
      const generateMs = performance.now() - t1;
      return json({
        answer,
        contexts,
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
      const body = (await request.json()) as {
        mode?: string;
        topic?: string;
        top_k?: number;
        count?: number;
        documents?: { source: string; text: string; doc_id?: string }[];
      };
      const mode = body.mode || "notes";
      const topic = (body.topic || "").trim();
      if (topic.length < 2) return err(422, "Topic too short");
      const started = performance.now();

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

      const topK = Math.min(20, Math.max(1, body.top_k || 8));
      const t0 = performance.now();
      let hits = await search(topic, tenant, topK);
      if (!hits.length && topic.includes(" ")) {
        hits = await search(topic.split(/\s+/).slice(0, 3).join(" "), tenant, topK);
      }
      const retrieveMs = performance.now() - t0;
      const contexts = hits.map((h) => ({
        chunk_id: h.chunk_id,
        doc_id: h.doc_id,
        source: h.source,
        score: h.score,
        excerpt: h.excerpt || h.text.slice(0, 320),
      }));

      if (mode === "notes") {
        const notes = await generateStudyNotes(topic, hits);
        return json({
          mode,
          topic,
          notes,
          contexts,
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
          back: h.text.slice(0, 220),
          source: h.source,
        }));
        if (!cards.length) {
          cards.push({
            front: `Define “${topic}” from your uploaded notes`,
            back: "Upload PDFs that mention this topic, then regenerate flashcards.",
            source: "Index",
          });
        }
        return json({
          mode,
          topic,
          cards,
          contexts,
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
    console.error("api-proxy error", e);
    return err(500, e instanceof Error ? e.message : "Internal server error");
  }
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return handle(request, path);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return handle(request, path);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return handle(request, path);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Accept, Authorization, X-API-Key, X-Admin-Key, X-Tenant-Id",
    },
  });
}
