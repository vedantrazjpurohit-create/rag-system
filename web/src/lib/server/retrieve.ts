/**
 * Multi-document retrieval helpers.
 *
 * Pure BM25 top-k tends to return several near-duplicate chunks from the single
 * highest-scoring PDF. Comparison questions need diversity across sources.
 * This module:
 *  1. Detects multi-document / comparison intent
 *  2. Fetches a larger candidate pool (fetch_k)
 *  3. Applies document-aware quotas + MMR so the final k spans multiple PDFs
 *  4. Leaves single-document questions mostly relevance-ranked (high λ MMR)
 */

import type { SearchHit } from "./types";

/** Tunable defaults — env can override at call site if needed. */
export const RETRIEVAL = {
  /** Final contexts for normal Q&A */
  topKSingle: 6,
  /** Final contexts when comparing across PDFs */
  topKMulti: 12,
  /** Candidate pool before diversity (fetch_k) */
  fetchKSingle: 36,
  fetchKMulti: 72,
  /** MMR relevance weight (higher = stick closer to pure BM25) */
  mmrLambdaSingle: 0.88,
  mmrLambdaMulti: 0.55,
  /** Soft cap of chunks per PDF in multi-doc mode */
  maxPerDocMulti: 3,
  /** Soft cap in single-doc mode (still allow more from one file) */
  maxPerDocSingle: 6,
} as const;

const MULTI_DOC_RE =
  /\b(compare|comparison|contrast|difference|differences|differ|vs\.?|versus|both|across|between|among|amongst|each (of )?(the )?(docs?|documents?|pdfs?|files?|notes?)|all (of )?(the )?(docs?|documents?|pdfs?|files?|notes?)|multiple|several|which (document|file|pdf|source)|from (each|both|all)|side[- ]by[- ]side|relate|relationship between)\b/i;

/**
 * True when the user is likely asking for multi-PDF synthesis.
 * Improves multi-doc retrieval without hurting simple "what is X" questions.
 */
export function isMultiDocumentQuery(question: string): boolean {
  return MULTI_DOC_RE.test(question.trim());
}

function tokenize(text: string): Set<string> {
  const terms = text.toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  return new Set(terms);
}

/** Jaccard similarity of token sets — used as redundancy penalty in MMR. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function normalizeScores(hits: SearchHit[]): Map<string, number> {
  const max = Math.max(...hits.map((h) => h.score), 1e-9);
  const min = Math.min(...hits.map((h) => h.score), 0);
  const span = Math.max(max - min, 1e-9);
  const out = new Map<string, number>();
  for (const h of hits) {
    out.set(h.chunk_id, (h.score - min) / span);
  }
  return out;
}

/**
 * Maximal Marginal Relevance over text chunks.
 * score = λ * relevance + (1-λ) * (1 - max_sim_to_selected)
 * Pushes the selected set away from near-duplicates (often from one PDF).
 */
export function mmrSelect(
  candidates: SearchHit[],
  topK: number,
  lambda: number,
): SearchHit[] {
  if (!candidates.length || topK <= 0) return [];
  if (candidates.length <= topK) return [...candidates];

  const rel = normalizeScores(candidates);
  const tokens = new Map<string, Set<string>>();
  for (const h of candidates) {
    tokens.set(h.chunk_id, tokenize(h.text));
  }

  const selected: SearchHit[] = [];
  const remaining = [...candidates];

  while (selected.length < topK && remaining.length) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const relevance = rel.get(cand.chunk_id) ?? 0;
      let maxSim = 0;
      const candTok = tokens.get(cand.chunk_id) || new Set();
      for (const s of selected) {
        const sim = jaccard(candTok, tokens.get(s.chunk_id) || new Set());
        if (sim > maxSim) maxSim = sim;
      }
      // Same-document penalty: slightly prefer a new PDF when scores are close
      const sameDocBoost =
        selected.length > 0 && selected.every((s) => s.doc_id !== cand.doc_id)
          ? 0.05
          : 0;
      const mmr = lambda * relevance + (1 - lambda) * (1 - maxSim) + sameDocBoost;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIdx = i;
      }
    }

    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}

/**
 * Guarantee representation from multiple PDFs when several score above zero.
 * Round-robin take the best unused chunk from each doc, then fill with MMR.
 */
export function diversifyAcrossDocuments(
  candidates: SearchHit[],
  topK: number,
  multiDoc: boolean,
): SearchHit[] {
  if (!candidates.length) return [];

  const byDoc = new Map<string, SearchHit[]>();
  for (const h of candidates) {
    const key = h.doc_id || h.source;
    const list = byDoc.get(key) || [];
    list.push(h);
    byDoc.set(key, list);
  }
  for (const list of byDoc.values()) {
    list.sort((a, b) => b.score - a.score);
  }

  const docIds = [...byDoc.keys()];
  const lambda = multiDoc ? RETRIEVAL.mmrLambdaMulti : RETRIEVAL.mmrLambdaSingle;
  const maxPerDoc = multiDoc ? RETRIEVAL.maxPerDocMulti : RETRIEVAL.maxPerDocSingle;

  // Single document in corpus or pure single-doc question: MMR only (preserve quality)
  if (docIds.length <= 1 || (!multiDoc && docIds.length <= 2)) {
    const mmr = mmrSelect(candidates, topK, lambda);
    return applyPerDocCap(mmr, maxPerDoc, topK);
  }

  // Multi-doc: seed with at least one (preferably two) best chunk(s) per relevant PDF
  const selected: SearchHit[] = [];
  const used = new Set<string>();
  const perDocCount = new Map<string, number>();
  const seedRounds = multiDoc ? 2 : 1;

  for (let round = 0; round < seedRounds && selected.length < topK; round++) {
    for (const docId of docIds) {
      if (selected.length >= topK) break;
      const list = byDoc.get(docId) || [];
      const hit = list.find((h) => !used.has(h.chunk_id));
      if (!hit) continue;
      const count = perDocCount.get(docId) || 0;
      if (count >= maxPerDoc) continue;
      selected.push(hit);
      used.add(hit.chunk_id);
      perDocCount.set(docId, count + 1);
    }
  }

  // Fill remainder with MMR over unused candidates (diversity + relevance)
  const rest = candidates.filter((h) => !used.has(h.chunk_id));
  const need = topK - selected.length;
  if (need > 0 && rest.length) {
    const mmrRest = mmrSelect(rest, need + maxPerDoc, lambda);
    for (const hit of mmrRest) {
      if (selected.length >= topK) break;
      const docId = hit.doc_id || hit.source;
      const count = perDocCount.get(docId) || 0;
      if (count >= maxPerDoc) continue;
      selected.push(hit);
      used.add(hit.chunk_id);
      perDocCount.set(docId, count + 1);
    }
  }

  // If still short (strict caps), allow one more per doc from pure score order
  if (selected.length < topK) {
    for (const hit of candidates) {
      if (selected.length >= topK) break;
      if (used.has(hit.chunk_id)) continue;
      selected.push(hit);
      used.add(hit.chunk_id);
    }
  }

  return selected.slice(0, topK);
}

function applyPerDocCap(hits: SearchHit[], maxPerDoc: number, topK: number): SearchHit[] {
  const counts = new Map<string, number>();
  const out: SearchHit[] = [];
  for (const h of hits) {
    const key = h.doc_id || h.source;
    const n = counts.get(key) || 0;
    if (n >= maxPerDoc) continue;
    out.push(h);
    counts.set(key, n + 1);
    if (out.length >= topK) break;
  }
  return out;
}

/** Parse OCR page markers like `--- page 3 ---` for accurate citations. */
export function extractPageHint(text: string): number | undefined {
  const m = text.match(/---\s*page\s+(\d+)\s*---/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Attach page metadata onto hits for UI / LLM citations. */
export function enrichHitsWithPages(hits: SearchHit[]): SearchHit[] {
  return hits.map((h) => {
    const page = extractPageHint(h.text);
    if (page === undefined) return h;
    return { ...h, page };
  });
}

/**
 * End-to-end selection: candidates (fetch_k) → diversified top_k.
 */
export function selectDiverseContexts(
  candidates: SearchHit[],
  question: string,
  topK?: number,
): { hits: SearchHit[]; multiDoc: boolean; fetchK: number; topK: number } {
  const multiDoc = isMultiDocumentQuery(question);
  const k = topK ?? (multiDoc ? RETRIEVAL.topKMulti : RETRIEVAL.topKSingle);
  const fetchK = multiDoc ? RETRIEVAL.fetchKMulti : RETRIEVAL.fetchKSingle;
  const diversified = diversifyAcrossDocuments(candidates, k, multiDoc);
  const withPages = enrichHitsWithPages(diversified);
  return { hits: withPages, multiDoc, fetchK, topK: k };
}
