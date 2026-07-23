import { getTenantId } from "./tenant";

const DB_NAME = "contextiq-corpus-v1";
const STORE = "documents";

export type LocalDocument = {
  doc_id: string;
  source: string;
  text: string;
  tenant_id: string;
  chunks_indexed: number;
  updated_at: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "doc_id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB request failed"));
  });
}

function waitTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}

export async function saveLocalDocument(
  doc: Omit<LocalDocument, "tenant_id" | "updated_at">,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const tenant_id = getTenantId();
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  // Drop any older row with the same filename for this tenant (prevents id drift)
  const all = (await idbRequest(store.getAll())) as LocalDocument[];
  for (const existing of all) {
    if (
      existing.tenant_id === tenant_id &&
      existing.source === doc.source &&
      existing.doc_id !== doc.doc_id
    ) {
      store.delete(existing.doc_id);
    }
  }
  store.put({
    ...doc,
    tenant_id,
    updated_at: new Date().toISOString(),
  } satisfies LocalDocument);
  await waitTx(tx);
  db.close();
}

export async function listLocalDocuments(): Promise<LocalDocument[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const tenant_id = getTenantId();
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const all = await idbRequest(tx.objectStore(STORE).getAll());
    db.close();
    return (all as LocalDocument[]).filter((d) => d.tenant_id === tenant_id);
  } catch {
    return [];
  }
}

/** Remove by doc_id and/or filename so Remove always clears the library. */
export async function removeLocalDocument(docId: string, source?: string): Promise<number> {
  if (typeof indexedDB === "undefined") return 0;
  try {
    const tenant_id = getTenantId();
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const all = (await idbRequest(store.getAll())) as LocalDocument[];
    let removed = 0;
    for (const doc of all) {
      if (doc.tenant_id !== tenant_id) continue;
      const idMatch = doc.doc_id === docId;
      const sourceMatch = source ? doc.source === source : false;
      if (idMatch || sourceMatch) {
        store.delete(doc.doc_id);
        removed += 1;
      }
    }
    await waitTx(tx);
    db.close();
    return removed;
  } catch {
    return 0;
  }
}

export async function clearLocalDocuments(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const docs = await listLocalDocuments();
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const doc of docs) {
      store.delete(doc.doc_id);
    }
    await waitTx(tx);
    db.close();
  } catch {
    /* ignore */
  }
}
