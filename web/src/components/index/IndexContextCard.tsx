import type { RetrievedContext } from "@/lib/types";

import { EngineeringText } from "./EngineeringText";

interface IndexContextCardProps {
  context: RetrievedContext;
  rank: number;
  active?: boolean;
  onSelect?: () => void;
}

export function IndexContextCard({ context, rank, active, onSelect }: IndexContextCardProps) {
  return (
    <article
      id={`source-${rank}`}
      onClick={onSelect}
      className={`sample-card cursor-pointer p-3 transition ${
        active ? "ring-2 ring-[var(--sample-border-strong)]" : ""
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--sample-accent)]">[{rank}]</span>
        <span className="truncate text-xs text-[var(--sample-dim)]">
          {context.source}
          {context.page != null ? ` · p.${context.page}` : ""}
        </span>
      </div>
      <p className="text-xs text-[var(--sample-dim)]">score {context.score.toFixed(3)}</p>
      <p className="mt-2 text-sm leading-relaxed text-[var(--sample-muted)]">
        <EngineeringText text={context.excerpt ?? context.text ?? ""} />
      </p>
    </article>
  );
}