"use client";

interface LandingHeroProps {
  onTryDemo: () => void;
  onLoadSample: () => void;
  loadingSample: boolean;
}

export function LandingHero({ onTryDemo, onLoadSample, loadingSample }: LandingHeroProps) {
  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/90 via-slate-900/50 to-emerald-950/30 p-6 sm:p-8">
      <div className="max-w-2xl">
        <p className="text-xs font-medium uppercase tracking-widest text-emerald-400/80">
          Retrieval-Augmented Generation
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">
          Upload docs. Ask questions. Prove retrieval works.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-400 sm:text-base">
          Vector, BM25, hybrid, and router strategies — with eval metrics and adversarial
          safety testing. Not just another chatbot wrapper.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onLoadSample}
            disabled={loadingSample}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            {loadingSample ? "Loading sample docs…" : "Load sample corpus"}
          </button>
          <button
            type="button"
            onClick={onTryDemo}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-600 hover:text-slate-100"
          >
            Jump to chat
          </button>
          <span className="self-center text-[10px] text-slate-600">
            Share publicly: run share.ps1
          </span>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Strategies", value: "4" },
          { label: "Guardrails", value: "OOD + poison" },
          { label: "Eval suite", value: "22 probes" },
          { label: "Stack", value: "FastAPI + Next" },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-slate-800/80 bg-slate-950/50 px-3 py-2"
          >
            <p className="text-[10px] uppercase tracking-wider text-slate-500">{item.label}</p>
            <p className="mt-0.5 text-xs font-medium text-slate-200">{item.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}