export interface Chunk {
  id: string;
  doc_id: string;
  source: string;
  text: string;
  owner_id: string;
  trust_tier: string;
}

export interface SearchHit {
  chunk_id: string;
  doc_id: string;
  source: string;
  text: string;
  score: number;
  excerpt?: string;
}

export interface DocumentInfo {
  doc_id: string;
  source: string;
  chunk_count: number;
  trust_tier: string;
}
