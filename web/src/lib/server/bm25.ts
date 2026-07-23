import type { Chunk, SearchHit } from "./types";

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []);
}

export class BM25Index {
  private k1 = 1.5;
  private b = 0.75;
  private chunks: Chunk[] = [];
  private termCounts: Map<string, number>[] = [];
  private docFreqs = new Map<string, number>();
  private avgDocLen = 0;

  indexChunks(chunks: Chunk[]): void {
    this.chunks = [...chunks];
    this.termCounts = [];
    this.docFreqs = new Map();
    let totalTerms = 0;

    for (const chunk of this.chunks) {
      const counts = new Map<string, number>();
      for (const term of tokenize(chunk.text)) {
        counts.set(term, (counts.get(term) || 0) + 1);
      }
      this.termCounts.push(counts);
      for (const term of counts.keys()) {
        this.docFreqs.set(term, (this.docFreqs.get(term) || 0) + 1);
      }
      for (const n of counts.values()) totalTerms += n;
    }
    this.avgDocLen = totalTerms / Math.max(1, this.termCounts.length);
  }

  /**
   * Score every chunk with a positive BM25 contribution.
   * Callers use a large fetch_k then diversity-select (MMR / multi-doc).
   */
  scoreAll(query: string): SearchHit[] {
    const queryTerms = tokenize(query);
    if (!queryTerms.length || !this.chunks.length) return [];

    const scored: SearchHit[] = [];
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      const counts = this.termCounts[i];
      const score = this.score(queryTerms, counts);
      if (score <= 0) continue;
      scored.push({
        chunk_id: chunk.id,
        doc_id: chunk.doc_id,
        source: chunk.source,
        text: chunk.text,
        score,
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  search(query: string, topK: number): SearchHit[] {
    return this.scoreAll(query).slice(0, topK);
  }

  private score(queryTerms: string[], counts: Map<string, number>): number {
    let score = 0;
    let docLen = 0;
    for (const n of counts.values()) docLen += n;
    for (const term of queryTerms) {
      const freq = counts.get(term) || 0;
      if (!freq) continue;
      const idf = this.idf(term);
      const denom = freq + this.k1 * (1 - this.b + (this.b * docLen) / Math.max(1, this.avgDocLen));
      score += (idf * (freq * (this.k1 + 1))) / denom;
    }
    return score;
  }

  private idf(term: string): number {
    const nDocs = this.chunks.length;
    const docFreq = this.docFreqs.get(term) || 0;
    return Math.log(1 + (nDocs - docFreq + 0.5) / (docFreq + 0.5));
  }
}
