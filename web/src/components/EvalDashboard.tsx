"use client";

import { useEffect, useState } from "react";

import {
  getBenchmarksSummary,
  getEvalHistory,
  runEvalCompare,
} from "@/lib/api";
import type { BenchmarkComparison, EvalHistoryRun, Strategy } from "@/lib/types";

const STRATEGIES: Strategy[] = ["vector", "bm25", "hybrid", "router"];
const METRICS = [
  { key: "retrieval.recall_at_k", label: "Recall@k" },
  { key: "retrieval.mrr", label: "MRR" },
  { key: "retrieval.ndcg_at_k", label: "nDCG@k" },
  { key: "gen.faithfulness", label: "Faithfulness" },
] as const;

function MetricBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px]">
        <span className="text-slate-500">{label}</span>
        <span className="font-mono text-slate-300">{value.toFixed(3)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-emerald-400/80"
          style={{ width: `${Math.min(value, 1) * 100}%` }}
        />
      </div>
    </div>
  );
}

export function EvalDashboard() {
  const [benchmarks, setBenchmarks] = useState<BenchmarkComparison | null>(null);
  const [history, setHistory] = useState<EvalHistoryRun[]>([]);
  const [live, setLive] = useState<BenchmarkComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadStatic() {
    setLoading(true);
    setError(null);
    try {
      const [bench, hist] = await Promise.all([
        getBenchmarksSummary(),
        getEvalHistory(),
      ]);
      setBenchmarks(bench);
      setHistory(hist.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load benchmarks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatic();
  }, []);

  async function handleRunLive() {
    setRunning(true);
    setError(null);
    try {
      const result = await runEvalCompare();
      setLive(result.strategies);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Live eval failed");
    } finally {
      setRunning(false);
      const hist = await getEvalHistory();
      setHistory(hist.runs);
    }
  }

  const active = live ?? benchmarks;

  if (loading) {
    return <p className="text-sm text-slate-500">Loading eval data…</p>;
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Eval dashboard</h2>
          <p className="mt-1 text-sm text-slate-400">
            Compare retrieval strategies on recall, MRR, nDCG, and faithfulness.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleRunLive()}
          disabled={running}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {running ? "Running all strategies…" : "Run live eval (4 strategies)"}
        </button>
      </section>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {live && (
        <p className="text-xs text-emerald-300">
          Showing live eval on your current index. Static committed benchmarks below when cleared.
        </p>
      )}

      {active ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STRATEGIES.map((strategy) => {
            const payload = active[strategy];
            if (!payload) return null;
            return (
              <article
                key={strategy}
                className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"
              >
                <h3 className="mb-3 font-medium capitalize text-slate-200">{strategy}</h3>
                <div className="space-y-2">
                  {METRICS.map((metric) => (
                    <MetricBar
                      key={metric.key}
                      label={metric.label}
                      value={payload.metrics[metric.key] ?? 0}
                    />
                  ))}
                </div>
                <p className="mt-3 font-mono text-[10px] text-slate-600">
                  p50 {payload.metrics["latency.p50_ms"] ?? "—"}ms ·{" "}
                  {payload.num_questions} questions
                </p>
              </article>
            );
          })}
        </section>
      ) : null}

      {benchmarks && live && (
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h3 className="text-sm font-semibold text-slate-300">Committed benchmarks (sample corpus)</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="pb-2 pr-4">Strategy</th>
                  {METRICS.map((m) => (
                    <th key={m.key} className="pb-2 pr-4">
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STRATEGIES.map((strategy) => (
                  <tr key={strategy} className="border-t border-slate-800 text-slate-300">
                    <td className="py-2 pr-4 capitalize">{strategy}</td>
                    {METRICS.map((m) => (
                      <td key={m.key} className="py-2 pr-4 font-mono">
                        {(benchmarks[strategy]?.metrics[m.key] ?? 0).toFixed(3)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <h3 className="text-sm font-semibold text-slate-300">Eval history</h3>
        {history.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No persisted runs yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {history
              .slice()
              .reverse()
              .map((run, idx) => (
                <li
                  key={`${run.timestamp}-${idx}`}
                  className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="text-slate-400">
                      {new Date(run.timestamp).toLocaleString()}
                    </span>
                    <span className="font-mono text-slate-500">
                      {String(run.config?.strategy ?? "vector")} · recall{" "}
                      {(run.metrics["retrieval.recall_at_k"] ?? 0).toFixed(3)}
                    </span>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}