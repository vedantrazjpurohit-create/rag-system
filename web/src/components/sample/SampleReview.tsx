"use client";

import { MOCK_METRICS } from "./mockData";

interface SampleReviewProps {
  documentCount: number;
}

export function SampleReview({ documentCount }: SampleReviewProps) {
  return (
    <div className="sample-fade-in space-y-4">
      <section className="sample-card p-6 sm:p-8">
        <h2 className="sample-heading text-xl text-[var(--sample-text)]">Quick sanity check</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--sample-muted)]">
          Run the same questions against your library and see if answers still land on the right
          pages. Good to do before you present or hand something in.
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {MOCK_METRICS.map((metric) => (
          <div key={metric.label} className="sample-card px-5 py-4">
            <p className="text-sm text-[var(--sample-muted)]">{metric.label}</p>
            <p className="sample-heading mt-2 text-2xl text-[var(--sample-text)]">
              {metric.label === "Sources" ? `${documentCount} docs` : metric.value}
            </p>
          </div>
        ))}
      </div>

      <section className="sample-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-[var(--sample-muted)]">Last time you ran this</p>
            <p className="mt-1 text-sm text-[var(--sample-text)]">
              22 questions across {documentCount} PDF{documentCount === 1 ? "" : "s"}
            </p>
          </div>
          <button type="button" className="sample-btn sample-btn-outline">
            Run again
          </button>
        </div>
      </section>
    </div>
  );
}