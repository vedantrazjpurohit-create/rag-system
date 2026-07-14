import type { RetrievedContext } from "@/lib/types";

interface ContextCardProps {
  context: RetrievedContext;
  rank: number;
}

export function ContextCard({ context, rank }: ContextCardProps) {
  return (
    <article className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-emerald-400">#{rank}</span>
        <span className="truncate text-[10px] text-slate-500">{context.source}</span>
        <span className="font-mono text-[10px] text-slate-400">
          {context.score.toFixed(3)}
        </span>
      </div>
      <p className="line-clamp-4 text-xs leading-relaxed text-slate-300">{context.text}</p>
      <p className="mt-2 font-mono text-[10px] text-slate-600">{context.doc_id}</p>
    </article>
  );
}