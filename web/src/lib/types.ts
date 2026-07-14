export type Strategy = "vector" | "bm25" | "hybrid" | "router";

export interface DocumentInfo {
  doc_id: string;
  source: string;
  chunk_count: number;
  trust_tier: "trusted" | "superseded" | string;
}

export interface Stats {
  chunk_count: number;
  source_count: number;
  sources: string[];
  doc_ids: string[];
}

export interface RetrievedContext {
  chunk_id: string;
  doc_id: string;
  text: string;
  source: string;
  score: number;
}

export interface QueryResponse {
  answer: string;
  contexts: RetrievedContext[];
  strategy: Strategy;
  timing_ms: {
    retrieve: number;
    total: number;
  };
}

export interface IngestResponse {
  chunks_indexed: number;
  source: string;
  doc_id: string;
}

export interface StrategySummary {
  pass_rate: number;
  break_rate: number;
  failed: number;
  num_questions: number;
  top_failures: Record<string, number>;
}

export interface AdversarialComparison {
  baseline: Record<string, StrategySummary>;
  guarded: Record<string, StrategySummary>;
  delta_pass_rate: Record<string, number>;
}