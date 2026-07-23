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

export async function saveLocalDocument(doc: Omit<LocalDocument, "tenant_id" | "updated_at">): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const tenant_id = getTenantId();
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const record: LocalDocument = {
    ...doc,
    tenant_id,
    updated_at: new Date().toISOString(),
  };
  await idbRequest(store.put(record));
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

export async function removeLocalDocument(docId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(docId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB delete aborted"));
    });
    db.close();
  } catch {
    /* ignore */
  }
}

export async function clearLocalDocuments(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const tenant_id = getTenantId();
    const docs = await listLocalDocuments();
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const doc of docs) {
      if (doc.tenant_id === tenant_id) await idbRequest(store.delete(doc.doc_id));
    }
    db.close();
  } catch {
    /* ignore */
  }
}
