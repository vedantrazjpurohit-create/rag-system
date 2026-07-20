import { NextRequest, NextResponse } from "next/server";

// Direct API root (http://127.0.0.1:8000) or monorepo path
// (https://your-render-app.onrender.com/api-proxy) both work.
const API_ORIGIN = (process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8000").replace(
  /\/+$/,
  "",
);

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

function targetUrl(pathSegments: string[], search: string): string {
  const suffix = pathSegments.length ? `/${pathSegments.join("/")}` : "/";
  return new URL(`${API_ORIGIN}${suffix}${search || ""}`).toString();
}

function needsAdminKey(method: string, path: string): boolean {
  if (method === "DELETE" && path.startsWith("/documents/")) {
    return true;
  }
  if (method === "POST" && (path === "/demo/seed" || path.startsWith("/eval"))) {
    return true;
  }
  if (method === "GET" && path.startsWith("/eval/history")) {
    return true;
  }
  return false;
}

function buildProxyHeaders(request: NextRequest, path: string): Headers {
  const headers = new Headers();

  const tenant = request.headers.get("x-tenant-id");
  if (tenant) {
    headers.set("X-Tenant-Id", tenant);
  }

  const apiKey = process.env.RAG_API_KEY?.trim();
  if (apiKey) {
    headers.set("X-API-Key", apiKey);
  }

  const adminKey = process.env.RAG_ADMIN_KEY?.trim();
  if (adminKey && needsAdminKey(request.method, path)) {
    headers.set("X-Admin-Key", adminKey);
  }

  const accept = request.headers.get("accept");
  if (accept) {
    headers.set("Accept", accept);
  }

  return headers;
}

/** Rebuild FormData so file blobs survive Vercel → upstream Node fetch. */
async function rebuildFormData(request: NextRequest): Promise<FormData> {
  const incoming = await request.formData();
  const outbound = new FormData();

  for (const [key, value] of incoming.entries()) {
    if (typeof value === "string") {
      outbound.append(key, value);
      continue;
    }
    const file = value as File;
    const bytes = await file.arrayBuffer();
    const blob = new Blob([bytes], {
      type: file.type || "application/octet-stream",
    });
    outbound.append(key, blob, file.name || "upload");
  }

  return outbound;
}

function proxyError(status: number, detail: string): NextResponse {
  return NextResponse.json({ detail }, { status });
}

async function proxy(request: NextRequest, pathSegments: string[]): Promise<NextResponse> {
  if (!process.env.API_PROXY_TARGET?.trim() && process.env.VERCEL) {
    return proxyError(
      503,
      "API_PROXY_TARGET is not set on Vercel. Set it to your Render URL (include /api-proxy if the API is still the monorepo app).",
    );
  }

  const path = pathSegments.length ? `/${pathSegments.join("/")}` : "/";
  const url = targetUrl(pathSegments, request.nextUrl.search);
  const headers = buildProxyHeaders(request, path);
  const contentType = request.headers.get("content-type") || "";

  try {
    let upstream: Response;

    // Multipart must be re-built — streaming the raw body breaks boundaries on Vercel.
    if (request.method === "POST" && contentType.includes("multipart/form-data")) {
      const formData = await rebuildFormData(request);
      // Do not set Content-Type — fetch will add the correct multipart boundary.
      upstream = await fetch(url, {
        method: "POST",
        headers,
        body: formData,
        cache: "no-store",
      });
    } else {
      const hasBody = request.method !== "GET" && request.method !== "HEAD";
      if (hasBody && contentType && !contentType.includes("multipart/form-data")) {
        headers.set("Content-Type", contentType);
      }
      upstream = await fetch(url, {
        method: request.method,
        headers,
        body: hasBody ? await request.arrayBuffer() : undefined,
        cache: "no-store",
      });
    }

    // Upstream Next.js 404 HTML when API_PROXY_TARGET points at the wrong path
    const upstreamType = upstream.headers.get("content-type") || "";
    if (
      upstream.status === 404 &&
      upstreamType.includes("text/html") &&
      (path === "/ingest" || path === "/health" || path === "/documents")
    ) {
      return proxyError(
        502,
        `API path ${path} not found at ${API_ORIGIN}. On monorepo Render, set API_PROXY_TARGET to https://YOUR-SERVICE.onrender.com/api-proxy`,
      );
    }

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("transfer-encoding");
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");

    return new NextResponse(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Proxy request failed";
    return proxyError(
      502,
      `Cannot reach API at ${API_ORIGIN}: ${message}. Check API_PROXY_TARGET and that Render is awake.`,
    );
  }
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function OPTIONS(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxy(request, path);
}
