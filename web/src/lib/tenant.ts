const STORAGE_KEY = "rag_tenant_id";

/** Stable per-browser tenant id for API data isolation (sent as X-Tenant-Id). */
export function getTenantId(): string {
  if (typeof window === "undefined") {
    return "default";
  }
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) {
      return existing;
    }
    const created = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    return "default";
  }
}