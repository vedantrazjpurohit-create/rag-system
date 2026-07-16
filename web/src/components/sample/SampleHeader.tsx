"use client";

export type SampleTab = "workspace" | "learn" | "library" | "compare" | "review";

interface SampleHeaderProps {
  active: SampleTab;
  onChange: (tab: SampleTab) => void;
}

const TABS: { id: SampleTab; label: string }[] = [
  { id: "workspace", label: "Study" },
  { id: "learn", label: "Learn" },
  { id: "library", label: "Files" },
  { id: "compare", label: "Compare" },
  { id: "review", label: "Check" },
];

export function SampleHeader({ active, onChange }: SampleHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--sample-border)] bg-[var(--sample-bg)]/92 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-5 py-4">
        <div>
          <p className="sample-heading text-lg text-[var(--sample-text)]">Index</p>
          <p className="text-sm text-[var(--sample-muted)]">your course PDFs, in one place</p>
        </div>

        <nav className="hidden items-center gap-1 sm:flex">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`sample-tab ${active === tab.id ? "sample-tab-active" : ""}`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-t border-[var(--sample-border)] px-5 py-2 sm:hidden">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`sample-tab shrink-0 ${active === tab.id ? "sample-tab-active" : ""}`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </header>
  );
}