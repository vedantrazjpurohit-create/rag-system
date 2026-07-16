import { NextRequest, NextResponse } from "next/server";

const API_ORIGIN = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8000";

function targetUrl(pathSegments: string[], search: string): string {
  const path = pathSegments.length ? `/${pathSegments.join("/")}` : "/";
  const url = new URL(path, API_ORIGIN);
  url.search = search;
  return url.toString();
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

  const contentType = request.headers.get("content-type");
  if (contentType && !contentType.includes("multipart/form-data")) {
    headers.set("Content-Type", contentType);
  }

  const accept = request.headers.get("accept");
  if (accept) {
    headers.set("Accept", accept);
  }

  return headers;
}

async function proxy(request: NextRequest, pathSegments: string[]): Promise<NextResponse> {
  const path = pathSegments.length ? `/${pathSegments.join("/")}` : "/";
  const url = targetUrl(pathSegments, request.nextUrl.search);
  const headers = buildProxyHeaders(request, path);
  const contentType = request.headers.get("content-type") || "";

  // Multipart must be re-sent as FormData — streaming the raw body breaks boundaries.
  if (request.method === "POST" && contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const upstream = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
      cache: "no-store",
    });

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("transfer-encoding");

    return new NextResponse(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(url, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    // @ts-expect-error — required when forwarding a streaming request body
    duplex: hasBody ? "half" : undefined,
    cache: "no-store",
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("transfer-encoding");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export const maxDuration = 120;

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