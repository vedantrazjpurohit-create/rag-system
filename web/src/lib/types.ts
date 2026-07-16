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
  source: string;
  score: number;
  excerpt?: string;
  text?: string;
}

export interface QueryResponse {
  answer: string;
  contexts: RetrievedContext[];
  strategy: Strategy;
  answer_mode: "llm" | "template" | string;
  timing_ms: {
    retrieve: number;
    generate: number;
    total: number;
  };
}

export interface EvalMetrics {
  "retrieval.recall_at_k": number;
  "retrieval.mrr": number;
  "retrieval.ndcg_at_k": number;
  "gen.faithfulness": number;
  "gen.citation_coverage": number;
  "latency.p50_ms"?: number;
  "latency.p95_ms"?: number;
  "runtime.total_s"?: number;
}

export interface StrategyEvalResult {
  config: Record<string, unknown>;
  num_questions: number;
  metrics: EvalMetrics;
  metrics_by_category: Record<string, { num_questions: number; metrics: EvalMetrics }>;
}

export type BenchmarkComparison = Record<Strategy, StrategyEvalResult>;

export interface EvalHistoryRun {
  timestamp: string;
  metrics: EvalMetrics;
  metrics_by_category: Record<string, unknown>;
  config: Record<string, unknown>;
  num_questions: number;
}

export interface AppConfig {
  llm_enabled: boolean;
  llm_model: string | null;
  strategies: Strategy[];
  persistence_enabled?: boolean;
  chroma_path?: string;
  low_memory_mode?: boolean;
  default_strategy?: Strategy;
  auth_required?: boolean;
  admin_auth_required?: boolean;
  tenant_header_required?: boolean;
  tenant_uuid_required?: boolean;
  web_search_enabled?: boolean;
}

export type StudyMode = "notes" | "define" | "flashcards" | "web";

export interface Flashcard {
  front: string;
  back: string;
  source: string;
}

export interface StudyResponse {
  mode: StudyMode;
  topic: string;
  answer_mode: string;
  timing_ms: Record<string, number>;
  notes?: string;
  definition?: string;
  term?: string;
  cards?: Flashcard[];
  summary?: string;
  contexts?: RetrievedContext[];
  strategy?: Strategy;
}

export interface SearchHistoryEntry {
  id: string;
  topic: string;
  mode: StudyMode;
  at: string;
}

export interface IngestResponse {
  chunks_indexed: number;
  source: string;
  doc_id: string;
  index_mode?: string;
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