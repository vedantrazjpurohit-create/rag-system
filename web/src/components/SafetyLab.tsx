"use client";

import { useEffect, useState } from "react";

import { getAdversarialSummary } from "@/lib/api";
import type { AdversarialComparison } from "@/lib/types";

const STRATEGIES = ["vector", "bm25", "hybrid", "router"] as const;

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function Bar({
  label,
  before,
  after,
}: {
  label: string;
  before: number;
  after: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="font-medium capitalize text-slate-300">{label}</span>
        <span className="text-slate-500">
          {pct(before)} → <span className="text-emerald-300">{pct(after)}</span>
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-rose-500/50"
          style={{ width: `${before * 100}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-emerald-400/80"
          style={{ width: `${after * 100}%` }}
        />
      </div>
    </div>
  );
}

export function SafetyLab() {
  const [data, setData] = useState<AdversarialComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdversarialSummary()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-sm text-slate-500">Loading adversarial results…</p>;
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-200">
        Could not load adversarial summary. Is the API running?
        {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <h2 className="text-lg font-semibold text-slate-100">Adversarial stress test</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
          22 attack questions, a poison document in the corpus, and strict grading. We ran this
          twice: raw retrieval (baseline) and with OOD + poison guardrails (guarded).
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {STRATEGIES.map((strategy) => {
          const baseline = data.baseline[strategy];
          const guarded = data.guarded[strategy];
          const delta = data.delta_pass_rate[strategy];
          return (
            <article
              key={strategy}
              className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-medium capitalize text-slate-200">{strategy}</h3>
                <span className="font-mono text-xs text-emerald-300">+{(delta * 100).toFixed(1)}pp</span>
              </div>
              <Bar
                label="pass rate"
                before={baseline.pass_rate}
                after={guarded.pass_rate}
              />
              <div className="mt-4 grid grid-cols-2 gap-2 text-[10px]">
                <div className="rounded bg-slate-950/80 p-2">
                  <p className="text-slate-500">Baseline failures</p>
                  <p className="mt-1 font-mono text-rose-300">{baseline.failed}/22</p>
                </div>
                <div className="rounded bg-slate-950/80 p-2">
                  <p className="text-slate-500">Guarded failures</p>
                  <p className="mt-1 font-mono text-emerald-300">{guarded.failed}/22</p>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <h3 className="text-sm font-semibold text-slate-200">How we fixed OOD + poison</h3>
        <ul className="mt-3 grid gap-2 text-sm text-slate-400 sm:grid-cols-2">
          <li className="rounded-lg bg-slate-950/60 px-3 py-2 ring-1 ring-slate-800">
            Trust tiers — poison/misleading filenames hard-filtered
          </li>
          <li className="rounded-lg bg-slate-950/60 px-3 py-2 ring-1 ring-slate-800">
            OOD gate — off-topic queries return no hits
          </li>
          <li className="rounded-lg bg-slate-950/60 px-3 py-2 ring-1 ring-slate-800">
            Unseen-numeric guard — refuse fake numbers
          </li>
          <li className="rounded-lg bg-slate-950/60 px-3 py-2 ring-1 ring-slate-800">
            Score floor — drop low-confidence gibberish hits
          </li>
        </ul>
        <a
          href="https://github.com/vedantrazjpurohit-create/rag-system/blob/main/eval/ADVERSARIAL_EVAL.md"
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-block text-xs text-emerald-400 hover:text-emerald-300"
        >
          Read full adversarial write-up →
        </a>
      </section>
    </div>
  );
}