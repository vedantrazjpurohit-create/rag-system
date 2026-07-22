import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";

const RESERVED = new Set([
  "default",
  "ssr-tenant-01",
  "ssr-default00",
  "anonymous",
  "public",
  "null",
  "undefined",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function providedApiKey(request: NextRequest): string {
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return bearer || (request.headers.get("x-api-key") || "").trim();
}

export function authEnabled(): boolean {
  return Boolean(process.env.RAG_API_KEY?.trim());
}

/**
 * Public demo access model (intentional):
 * - Browser same-origin clients send X-Tenant-Id (UUID) for data isolation only.
 * - That is NOT login identity — anyone can mint a UUID.
 * - Set REQUIRE_API_KEY=true to require RAG_API_KEY on every mutating/read API call
 *   (then inject the key only from a trusted server layer, not the browser).
 */
export function requireApiAccess(request: NextRequest): string {
  const apiKey = process.env.RAG_API_KEY?.trim();
  const provided = providedApiKey(request);
  const requireKey =
    process.env.REQUIRE_API_KEY === "true" ||
    process.env.REQUIRE_API_KEY === "1";

  if (apiKey) {
    if (requireKey) {
      if (!provided || !safeEqual(provided, apiKey)) {
        throw new AuthError(401, "Invalid or missing API key");
      }
    } else if (provided && !safeEqual(provided, apiKey)) {
      throw new AuthError(401, "Invalid API key");
    }
  }

  const tenant = (request.headers.get("x-tenant-id") || "").trim();
  const strict =
    process.env.STRICT_TENANT_UUID === "true" ||
    process.env.STRICT_TENANT_UUID === "1" ||
    Boolean(process.env.VERCEL);

  if (!tenant) {
    throw new AuthError(400, "X-Tenant-Id header required (UUID)");
  }
  if (RESERVED.has(tenant.toLowerCase())) {
    throw new AuthError(400, "Reserved X-Tenant-Id value is not allowed");
  }
  if (strict && !UUID_RE.test(tenant)) {
    throw new AuthError(400, "X-Tenant-Id must be a UUID");
  }
  return tenant;
}

/** Admin routes: when RAG_ADMIN_KEY is set, a matching key is required (missing → 403). */
export function requireAdmin(request: NextRequest): void {
  const adminKey = process.env.RAG_ADMIN_KEY?.trim();
  if (!adminKey) {
    throw new AuthError(403, "Admin operations are disabled (RAG_ADMIN_KEY not configured)");
  }
  const provided =
    (request.headers.get("x-admin-key") || "").trim() || providedApiKey(request);
  if (!provided || !safeEqual(provided, adminKey)) {
    throw new AuthError(403, "Admin key required");
  }
}

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
