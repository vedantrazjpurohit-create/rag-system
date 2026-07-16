const STORAGE_KEY = "rag_tenant_id";

let memoryTenant: string | null = null;

export class TenantUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantUnavailableError";
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function createTenantId(): string {
  if (typeof crypto === "undefined") {
    throw new TenantUnavailableError("Secure session id is not available in this environment.");
  }

  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto.getRandomValues !== "function") {
    throw new TenantUnavailableError(
      "This browser cannot create a private session id. Enable storage access or try another browser.",
    );
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function persistTenant(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    memoryTenant = id;
  }
}

/**
 * Stable per-browser tenant id for API data isolation (sent as X-Tenant-Id).
 * Never returns shared fallbacks like "default" — throws if a UUID cannot be created.
 */
export function getTenantId(): string {
  if (typeof window === "undefined") {
    throw new TenantUnavailableError("Tenant id is only available in the browser.");
  }

  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && isUuid(existing)) {
      return existing;
    }
  } catch {
    if (memoryTenant && isUuid(memoryTenant)) {
      return memoryTenant;
    }
  }

  const created = createTenantId();
  persistTenant(created);
  return created;
}