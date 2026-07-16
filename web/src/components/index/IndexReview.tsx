"use client";

import { useEffect, useState } from "react";

import { getBenchmarksSummary, runEvalCompare } from "@/lib/api";
import type { BenchmarkComparison, Strategy } from "@/lib/types";

const STRATEGIES: Strategy[] = ["vector", "bm25", "hybrid", "router"];
const METRICS = [
  { key: "retrieval.recall_at_k", label: "Recall@k" },
  { key: "retrieval.mrr", label: "MRR" },
  { key: "retrieval.ndcg_at_k", label: "nDCG@k" },
  { key: "gen.faithfulness", label: "Faithfulness" },
] as const;

interface IndexReviewProps {
  documentCount: number;
}

export function IndexReview({ documentCount }: IndexReviewProps) {
  const [benchmarks, setBenchmarks] = useState<BenchmarkComparison | null>(null);
  const [live, setLive] = useState<BenchmarkComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getBenchmarksSummary()
      .then(setBenchmarks)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load metrics"))
      .finally(() => setLoading(false));
  }, []);

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const result = await runEvalCompare();
      setLive(result.strategies);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eval run failed");
    } finally {
      setRunning(false);
    }
  }

  const data = live ?? benchmarks;

  return (
    <div className="sample-fade-in space-y-4">
      <section className="sample-card p-6 sm:p-8">
        <h2 className="sample-heading text-xl text-[var(--sample-text)]">Quick sanity check</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--sample-muted)]">
          Run benchmark questions against your library and see if retrieval still lands on the right
          chunks. Good to do before you present or hand something in.
        </p>
        <p className="mt-3 text-sm text-[var(--sample-dim)]">
          {documentCount} file{documentCount === 1 ? "" : "s"} in your library
        </p>
      </section>

      {loading && (
        <p className="sample-card-inset px-4 py-3 text-sm text-[var(--sample-muted)]">Loading metrics…</p>
      )}
      {error && <p className="sample-card-inset px-4 py-3 text-sm text-red-700/80">{error}</p>}

      {data && (
        <div className="grid gap-3 sm:grid-cols-2">
          {STRATEGIES.map((strategy) => {
            const metrics = data[strategy]?.metrics;
            if (!metrics) return null;
            return (
              <section key={strategy} className="sample-card p-5">
                <h3 className="text-sm font-medium capitalize text-[var(--sample-text)]">{strategy}</h3>
                <ul className="mt-4 space-y-3">
                  {METRICS.map(({ key, label }) => {
                    const value = metrics[key as keyof typeof metrics] as number;
                    return (
                      <li key={key}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="text-[var(--sample-muted)]">{label}</span>
                          <span className="text-[var(--sample-text)]">{value.toFixed(3)}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--sample-highlight)]">
                          <div
                            className="h-full rounded-full bg-[var(--sample-accent-soft)]"
                            style={{ width: `${Math.min(value, 1) * 100}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <section className="sample-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-[var(--sample-muted)]">Live eval</p>
            <p className="mt-1 text-sm text-[var(--sample-text)]">
              Re-run the benchmark suite on the current index
            </p>
          </div>
          <button
            type="button"
            disabled={running}
            onClick={() => void handleRun()}
            className="sample-btn sample-btn-outline"
          >
            {running ? "Running…" : "Run again"}
          </button>
        </div>
      </section>
    </div>
  );
}