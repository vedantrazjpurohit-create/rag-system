"use client";

import { useEffect, useMemo, useState } from "react";

import { MOCK_COMPARE } from "./mockData";
import type { MockDocument } from "./mockData";

interface SampleCompareProps {
  documents: MockDocument[];
}

export function SampleCompare({ documents }: SampleCompareProps) {
  const pdfs = useMemo(() => documents.filter((d) => d.type === "pdf"), [documents]);
  const [docAId, setDocAId] = useState(pdfs[0]?.id ?? "");
  const [docBId, setDocBId] = useState(pdfs[1]?.id ?? pdfs[0]?.id ?? "");

  useEffect(() => {
    if (!pdfs.length) {
      setDocAId("");
      setDocBId("");
      return;
    }
    if (!pdfs.some((d) => d.id === docAId)) setDocAId(pdfs[0].id);
    if (!pdfs.some((d) => d.id === docBId)) {
      setDocBId(pdfs[1]?.id ?? pdfs[0].id);
    }
  }, [pdfs, docAId, docBId]);

  const docA = pdfs.find((d) => d.id === docAId) ?? pdfs[0];
  const docB = pdfs.find((d) => d.id === docBId) ?? pdfs[1] ?? pdfs[0];

  const overlaps =
    docA && docB && docA.id !== docB.id
      ? MOCK_COMPARE.overlaps
      : ["Add at least two PDFs if you want to compare them."];
  const differences =
    docA && docB && docA.id !== docB.id
      ? MOCK_COMPARE.differences
      : ["Pick two different files from the lists above."];

  return (
    <div className="sample-fade-in space-y-4">
      <header className="sample-card p-6">
        <h2 className="sample-heading text-xl text-[var(--sample-text)]">Compare two readings</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--sample-muted)]">
          Handy before an exam — see what overlaps and what each PDF covers on its own.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <DocSelect label="First PDF" value={docA?.id ?? ""} options={pdfs} onChange={setDocAId} />
          <DocSelect label="Second PDF" value={docB?.id ?? ""} options={pdfs} onChange={setDocBId} />
        </div>

        {docA && docB && (
          <p className="mt-4 text-sm text-[var(--sample-dim)]">
            {docA.name} <span className="text-[var(--sample-muted)]">and</span> {docB.name}
          </p>
        )}
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <CompareCard title="They agree on" items={overlaps} />
        <CompareCard title="They differ on" items={differences} />
      </div>
    </div>
  );
}

function DocSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: MockDocument[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm text-[var(--sample-muted)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sample-input mt-1.5 text-sm"
      >
        {options.map((doc) => (
          <option key={doc.id} value={doc.id}>
            {doc.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function CompareCard({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="sample-card p-5">
      <h3 className="text-sm font-medium text-[var(--sample-text)]">{title}</h3>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item} className="border-l-2 border-[var(--sample-border-strong)] pl-3 text-sm leading-relaxed text-[var(--sample-muted)]">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}