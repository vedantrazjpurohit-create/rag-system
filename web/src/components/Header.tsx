"use client";

type Tab = "demo" | "eval" | "safety" | "about";

interface HeaderProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  apiOnline: boolean | null;
}

export function Header({ activeTab, onTabChange, apiOnline }: HeaderProps) {
  return (
    <header className="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-400/30">
            <span className="font-mono text-sm font-bold text-emerald-300">R</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-wide text-slate-100 sm:text-base">
              RAG System
            </h1>
            <p className="text-xs text-slate-500">Upload · Query · Measure retrieval</p>
          </div>
        </div>

        <nav className="flex items-center gap-1 rounded-lg bg-slate-900/80 p-1 ring-1 ring-slate-800">
          <button
            type="button"
            onClick={() => onTabChange("demo")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
              activeTab === "demo"
                ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Demo
          </button>
          <button
            type="button"
            onClick={() => onTabChange("eval")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
              activeTab === "eval"
                ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Eval
          </button>
          <button
            type="button"
            onClick={() => onTabChange("safety")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
              activeTab === "safety"
                ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Safety
          </button>
          <button
            type="button"
            onClick={() => onTabChange("about")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
              activeTab === "about"
                ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            About
          </button>
        </nav>

        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex h-2 w-2 rounded-full ${
              apiOnline === null
                ? "bg-slate-600"
                : apiOnline
                  ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                  : "bg-rose-400"
            }`}
          />
          <span className="hidden text-slate-500 sm:inline">
            API {apiOnline === null ? "checking…" : apiOnline ? "online" : "offline"}
          </span>
          <span className="hidden rounded-md px-2 py-1 text-slate-500 ring-1 ring-slate-800 sm:inline">
            Live
          </span>
        </div>
      </div>
    </header>
  );
}