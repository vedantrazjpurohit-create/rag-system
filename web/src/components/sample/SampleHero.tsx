"use client";

interface SampleHeroProps {
  documentCount: number;
  indexedCount: number;
}

export function SampleHero({ documentCount, indexedCount }: SampleHeroProps) {
  return (
    <section className="sample-card sample-fade-in p-6 sm:p-8">
      <h1 className="sample-heading max-w-xl text-2xl leading-snug text-[var(--sample-text)] sm:text-[1.75rem]">
        Your notes, made searchable.
      </h1>
      <p className="mt-3 max-w-lg text-[0.9375rem] leading-relaxed text-[var(--sample-muted)]">
        Upload your course material once. Ask anything, from definitions to derivations, and see
        exactly where each answer comes from.
      </p>
      <p className="mt-5 text-sm text-[var(--sample-dim)]">
        {documentCount === 0
          ? "No files yet — upload something to get started."
          : `${documentCount} file${documentCount === 1 ? "" : "s"} here · ${indexedCount} ready to search`}
      </p>
    </section>
  );
}