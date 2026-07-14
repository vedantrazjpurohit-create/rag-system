"use client";

const FLOW = [
  { step: "1", title: "Ingest", desc: "Upload .md, .txt, or .pdf — chunked at 512 tokens with 64 overlap" },
  { step: "2", title: "Index", desc: "ChromaDB vector store + in-memory BM25 mirror (persists across restarts)" },
  { step: "3", title: "Route", desc: "Query classifier picks vector, BM25, or hybrid per question shape" },
  { step: "4", title: "Guard", desc: "OOD refusal, poison-doc filter, unseen-numeric rejection, score floors" },
  { step: "5", title: "Answer", desc: "Retrieve top-k chunks → Grok LLM or template answer with citations" },
  { step: "6", title: "Measure", desc: "Live eval + 22-question adversarial suite with before/after pass rates" },
];

export function AboutPage() {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="text-xl font-semibold text-slate-100">Architecture</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
          Full-stack RAG with retrieval proof — not a black-box chatbot. Every answer shows which
          chunks were retrieved, which strategy was used, and how long it took.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FLOW.map((item) => (
          <article
            key={item.step}
            className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"
          >
            <span className="font-mono text-xs text-emerald-400">Step {item.step}</span>
            <h3 className="mt-1 font-medium text-slate-200">{item.title}</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">{item.desc}</p>
          </article>
        ))}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <h3 className="text-sm font-semibold text-slate-200">Stack</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            "Next.js 16",
            "FastAPI",
            "ChromaDB",
            "sentence-transformers",
            "BM25",
            "Hybrid fusion",
            "Query router",
            "xAI Grok",
            "SSE streaming",
          ].map((tech) => (
            <span
              key={tech}
              className="rounded-full bg-slate-950 px-3 py-1 text-xs text-slate-400 ring-1 ring-slate-800"
            >
              {tech}
            </span>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6">
        <h3 className="text-sm font-semibold text-emerald-200">What makes this different</h3>
        <ul className="mt-3 space-y-2 text-sm text-slate-400">
          <li>Adversarial eval: 0% pass rate before guardrails → 68% after (router)</li>
          <li>Poison document stress test with trust-tier filtering</li>
          <li>Four retrieval strategies compared on the same live index</li>
          <li>Documents persist across API restarts (local ChromaDB)</li>
        </ul>
      </section>
    </div>
  );
}