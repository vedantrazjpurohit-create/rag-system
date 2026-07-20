import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { tmpdir } from "os";

import { BM25Index } from "./bm25";
import { normalizeEngineeringText } from "./normalize";
import type { Chunk, DocumentInfo, SearchHit } from "./types";

const STORE_PATH = path.join(tmpdir(), "contextiq-rag-store.json");

type StoreData = {
  chunks: Chunk[];
  sourceDocIds: Record<string, string>;
};

type GlobalStore = {
  chunksById: Map<string, Chunk>;
  sourceDocIds: Map<string, string>;
  bm25: BM25Index;
  loaded: boolean;
  loadPromise: Promise<void> | null;
};

function globalStore(): GlobalStore {
  const g = globalThis as typeof globalThis & { __contextiqStore?: GlobalStore };
  if (!g.__contextiqStore) {
    g.__contextiqStore = {
      chunksById: new Map(),
      sourceDocIds: new Map(),
      bm25: new BM25Index(),
      loaded: false,
      loadPromise: null,
    };
  }
  return g.__contextiqStore;
}

function sourceKey(source: string, ownerId: string): string {
  return `${ownerId}::${source}`;
}

function stableId(ownerId: string, source: string, idx: number, chunk: string): string {
  const digest = createHash("sha1")
    .update(`${ownerId}:${source}:${idx}:${chunk.slice(0, 40)}`)
    .digest("hex")
    .slice(0, 10);
  return `${digest}_${idx}`;
}

function chunkText(text: string, size = 512, overlap = 64): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    const piece = text.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= text.length) break;
    start = end - overlap;
  }
  return chunks;
}

function reindexBm25(store: GlobalStore): void {
  store.bm25.indexChunks([...store.chunksById.values()]);
}

async function persist(store: GlobalStore): Promise<void> {
  const data: StoreData = {
    chunks: [...store.chunksById.values()],
    sourceDocIds: Object.fromEntries(store.sourceDocIds),
  };
  try {
    await fs.writeFile(STORE_PATH, JSON.stringify(data), "utf8");
  } catch {
    /* /tmp may be unavailable in some edge runtimes */
  }
}

async function hydrate(store: GlobalStore): Promise<void> {
  if (store.loaded) return;
  if (store.loadPromise) return store.loadPromise;

  store.loadPromise = (async () => {
    try {
      const raw = await fs.readFile(STORE_PATH, "utf8");
      const data = JSON.parse(raw) as StoreData;
      store.chunksById.clear();
      for (const chunk of data.chunks || []) {
        store.chunksById.set(chunk.id, chunk);
      }
      store.sourceDocIds = new Map(Object.entries(data.sourceDocIds || {}));
      reindexBm25(store);
    } catch {
      /* first boot */
    } finally {
      store.loaded = true;
    }
  })();

  return store.loadPromise;
}

export async function ensureStore(): Promise<GlobalStore> {
  const store = globalStore();
  await hydrate(store);
  return store;
}

export function docIdForSource(store: GlobalStore, source: string, ownerId: string): string {
  const key = sourceKey(source, ownerId);
  const existing = store.sourceDocIds.get(key);
  if (existing) return existing;
  for (const chunk of store.chunksById.values()) {
    if (chunk.owner_id === ownerId && chunk.source === source) {
      store.sourceDocIds.set(key, chunk.doc_id);
      return chunk.doc_id;
    }
  }
  const docId = randomUUID();
  store.sourceDocIds.set(key, docId);
  return docId;
}

export async function ingestText(
  text: string,
  source: string,
  ownerId: string,
): Promise<{ chunks_indexed: number; doc_id: string; source: string; index_mode: string }> {
  const store = await ensureStore();
  const cleaned = normalizeEngineeringText(text);
  const pieces = chunkText(cleaned).map((c) => normalizeEngineeringText(c));
  if (!pieces.length) {
    return { chunks_indexed: 0, doc_id: "", source, index_mode: "bm25" };
  }

  // Replace existing source for this tenant
  for (const [id, chunk] of [...store.chunksById.entries()]) {
    if (chunk.owner_id === ownerId && chunk.source === source) {
      store.chunksById.delete(id);
    }
  }

  const docId = docIdForSource(store, source, ownerId);
  for (let idx = 0; idx < pieces.length; idx++) {
    const piece = pieces[idx];
    const id = stableId(ownerId, source, idx, piece);
    store.chunksById.set(id, {
      id,
      doc_id: docId,
      source,
      text: piece,
      owner_id: ownerId,
      trust_tier: "trusted",
    });
  }

  reindexBm25(store);
  await persist(store);
  return {
    chunks_indexed: pieces.length,
    doc_id: docId,
    source,
    index_mode: "bm25",
  };
}

export async function listDocuments(ownerId: string): Promise<DocumentInfo[]> {
  const store = await ensureStore();
  const grouped = new Map<string, DocumentInfo>();
  for (const chunk of store.chunksById.values()) {
    if (chunk.owner_id !== ownerId) continue;
    const existing = grouped.get(chunk.doc_id);
    if (!existing) {
      grouped.set(chunk.doc_id, {
        doc_id: chunk.doc_id,
        source: chunk.source,
        chunk_count: 1,
        trust_tier: chunk.trust_tier,
      });
    } else {
      existing.chunk_count += 1;
    }
  }
  return [...grouped.values()].sort((a, b) => a.source.localeCompare(b.source));
}

export async function deleteDocument(docId: string, ownerId: string): Promise<boolean> {
  const store = await ensureStore();
  let removed = false;
  for (const [id, chunk] of [...store.chunksById.entries()]) {
    if (chunk.doc_id === docId && chunk.owner_id === ownerId) {
      store.chunksById.delete(id);
      removed = true;
    }
  }
  if (!removed) return false;
  for (const [key, value] of [...store.sourceDocIds.entries()]) {
    if (value === docId && key.startsWith(`${ownerId}::`)) {
      store.sourceDocIds.delete(key);
    }
  }
  reindexBm25(store);
  await persist(store);
  return true;
}

export async function search(
  question: string,
  ownerId: string,
  topK = 5,
): Promise<SearchHit[]> {
  const store = await ensureStore();
  const tenantChunks = [...store.chunksById.values()].filter((c) => c.owner_id === ownerId);
  // Rebuild BM25 over tenant only for isolation
  const tenantIndex = new BM25Index();
  tenantIndex.indexChunks(tenantChunks);
  const hits = tenantIndex.search(question, topK);
  return hits.map((hit) => ({
    ...hit,
    excerpt: hit.text.length > 320 ? `${hit.text.slice(0, 320).trim()}…` : hit.text,
  }));
}

export async function stats(ownerId: string) {
  const docs = await listDocuments(ownerId);
  const store = await ensureStore();
  const chunks = [...store.chunksById.values()].filter((c) => c.owner_id === ownerId);
  return {
    chunk_count: chunks.length,
    source_count: docs.length,
    sources: docs.map((d) => d.source).sort(),
    doc_ids: docs.map((d) => d.doc_id).sort(),
  };
}
