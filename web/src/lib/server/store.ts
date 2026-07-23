import { createHash, randomUUID } from "crypto";

import { BM25Index } from "./bm25";
import { normalizeEngineeringText } from "./normalize";
import {
  RETRIEVAL,
  isMultiDocumentQuery,
  selectDiverseContexts,
} from "./retrieve";
import type { Chunk, DocumentInfo, SearchHit } from "./types";

type GlobalStore = {
  chunksById: Map<string, Chunk>;
  sourceDocIds: Map<string, string>;
};

function globalStore(): GlobalStore {
  const g = globalThis as typeof globalThis & { __contextiqStore?: GlobalStore };
  if (!g.__contextiqStore) {
    g.__contextiqStore = {
      chunksById: new Map(),
      sourceDocIds: new Map(),
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

function ensureStore(): GlobalStore {
  return globalStore();
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
  preferredDocId?: string,
): Promise<{ chunks_indexed: number; doc_id: string; source: string; index_mode: string; text: string }> {
  const store = ensureStore();
  const cleaned = normalizeEngineeringText(text);
  const pieces = chunkText(cleaned).map((c) => normalizeEngineeringText(c)).filter(Boolean);
  if (!pieces.length) {
    return { chunks_indexed: 0, doc_id: "", source, index_mode: "bm25", text: cleaned };
  }

  for (const [id, chunk] of [...store.chunksById.entries()]) {
    if (chunk.owner_id === ownerId && chunk.source === source) {
      store.chunksById.delete(id);
    }
  }

  // Prefer client doc_id so UI Remove targets the same id as IndexedDB
  let docId =
    preferredDocId && preferredDocId.trim()
      ? preferredDocId.trim()
      : docIdForSource(store, source, ownerId);
  store.sourceDocIds.set(sourceKey(source, ownerId), docId);

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

  return {
    chunks_indexed: pieces.length,
    doc_id: docId,
    source,
    index_mode: "bm25",
    text: cleaned,
  };
}

export async function listDocuments(ownerId: string): Promise<DocumentInfo[]> {
  const store = ensureStore();
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

export async function deleteDocument(
  docId: string,
  ownerId: string,
  source?: string,
): Promise<boolean> {
  const store = ensureStore();
  let removed = false;
  for (const [id, chunk] of [...store.chunksById.entries()]) {
    if (chunk.owner_id !== ownerId) continue;
    if (chunk.doc_id === docId || (source && chunk.source === source)) {
      store.chunksById.delete(id);
      removed = true;
    }
  }
  for (const [key, value] of [...store.sourceDocIds.entries()]) {
    if (!key.startsWith(`${ownerId}::`)) continue;
    if (value === docId || (source && key === sourceKey(source, ownerId))) {
      store.sourceDocIds.delete(key);
    }
  }
  return removed;
}

function tenantChunks(ownerId: string): Chunk[] {
  const store = ensureStore();
  return [...store.chunksById.values()].filter((c) => c.owner_id === ownerId);
}

function toHit(chunk: Chunk, score: number): SearchHit {
  return {
    chunk_id: chunk.id,
    doc_id: chunk.doc_id,
    source: chunk.source,
    text: chunk.text,
    score,
    excerpt: chunk.text.length > 320 ? `${chunk.text.slice(0, 320).trim()}…` : chunk.text,
  };
}

export type SearchOutcome = {
  hits: SearchHit[];
  /** True when nothing scored; optional broad passages are not answer-grade matches. */
  weak_match: boolean;
  broad_passages: SearchHit[];
  multi_doc?: boolean;
  fetch_k?: number;
};

/**
 * Multi-stage retrieval:
 *  1) BM25 over all tenant chunks → large candidate pool (fetch_k)
 *  2) Keyword fallback if BM25 is empty
 *  3) MMR + per-document quotas so comparison queries span multiple PDFs
 *
 * Single-doc questions keep high λ (relevance-first); multi-doc questions
 * lower λ and seed one/two hits per source before filling.
 */
export async function search(
  question: string,
  ownerId: string,
  topK?: number,
): Promise<SearchOutcome> {
  const chunks = tenantChunks(ownerId);
  if (!chunks.length) {
    return { hits: [], weak_match: true, broad_passages: [] };
  }

  const multiDoc = isMultiDocumentQuery(question);
  const desiredK = topK ?? (multiDoc ? RETRIEVAL.topKMulti : RETRIEVAL.topKSingle);
  const fetchK = multiDoc ? RETRIEVAL.fetchKMulti : RETRIEVAL.fetchKSingle;

  const index = new BM25Index();
  index.indexChunks(chunks);

  // Large candidate pool — pure topK here is what caused single-PDF dominance
  let candidates = index.scoreAll(question).slice(0, fetchK);

  // Keyword contains fallback (short queries / weak BM25)
  if (!candidates.length) {
    const terms = (question.toLowerCase().match(/[a-z0-9]{3,}/g) || []).slice(0, 12);
    if (terms.length) {
      const ranked = chunks
        .map((chunk) => {
          const lower = chunk.text.toLowerCase();
          let score = 0;
          for (const t of terms) {
            if (lower.includes(t)) score += 1 + (lower.split(t).length - 1) * 0.1;
          }
          return { chunk, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, fetchK);
      candidates = ranked.map((x) => toHit(x.chunk, x.score));
    }
  }

  if (!candidates.length) {
    const broad_passages = chunks
      .slice(0, Math.min(3, desiredK))
      .map((c, i) => toHit(c, 0.001 / (i + 1)));
    return { hits: [], weak_match: true, broad_passages, multi_doc: multiDoc, fetch_k: fetchK };
  }

  const { hits, multiDoc: multi, fetchK: usedFetch } = selectDiverseContexts(
    candidates,
    question,
    desiredK,
  );

  return {
    hits,
    weak_match: false,
    broad_passages: [],
    multi_doc: multi,
    fetch_k: usedFetch,
  };
}

export async function stats(ownerId: string) {
  const docs = await listDocuments(ownerId);
  const chunks = tenantChunks(ownerId);
  return {
    chunk_count: chunks.length,
    source_count: docs.length,
    sources: docs.map((d) => d.source).sort(),
    doc_ids: docs.map((d) => d.doc_id).sort(),
  };
}

/** Load client-sent documents into this request's store (same instance as search). */
export async function syncDocuments(
  ownerId: string,
  documents: { source: string; text: string; doc_id?: string }[],
): Promise<{ synced: number; documents: DocumentInfo[]; chunk_count: number }> {
  let synced = 0;
  for (const doc of documents) {
    const text = (doc.text || "").trim();
    const source = (doc.source || "upload").trim();
    if (!text || !source) continue;
    const result = await ingestText(text, source, ownerId, doc.doc_id);
    if (result.chunks_indexed > 0) synced += 1;
  }
  const docs = await listDocuments(ownerId);
  const chunk_count = tenantChunks(ownerId).length;
  return { synced, documents: docs, chunk_count };
}
