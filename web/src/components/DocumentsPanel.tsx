"use client";

import type { DocumentInfo } from "@/lib/types";

interface DocumentsPanelProps {
  documents: DocumentInfo[];
  loading: boolean;
  onDelete: (docId: string) => void;
}

function trustBadge(tier: string) {
  if (tier === "superseded") {
    return (
      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-amber-500/30">
        superseded
      </span>
    );
  }
  return (
    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-500/20">
      trusted
    </span>
  );
}

export function DocumentsPanel({ documents, loading, onDelete }: DocumentsPanelProps) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Indexed sources</h2>
        <span className="text-xs text-slate-500">{documents.length} docs</span>
      </div>

      {loading ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : documents.length === 0 ? (
        <p className="text-xs text-slate-500">No documents yet. Upload to start querying.</p>
      ) : (
        <ul className="space-y-2">
          {documents.map((doc) => (
            <li
              key={doc.doc_id}
              className="flex items-start justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-slate-200">{doc.source}</p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {doc.doc_id} · {doc.chunk_count} chunks
                </p>
                <div className="mt-1">{trustBadge(doc.trust_tier)}</div>
              </div>
              <button
                type="button"
                onClick={() => onDelete(doc.doc_id)}
                className="shrink-0 rounded px-2 py-1 text-[10px] text-slate-500 hover:bg-rose-500/10 hover:text-rose-300"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}