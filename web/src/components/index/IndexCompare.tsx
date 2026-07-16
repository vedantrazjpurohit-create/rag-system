"use client";

import { useEffect, useMemo, useState } from "react";

import { queryDocuments } from "@/lib/api";
import type { DocumentInfo } from "@/lib/types";

interface IndexCompareProps {
  documents: DocumentInfo[];
}

export function IndexCompare({ documents }: IndexCompareProps) {
  const [docAId, setDocAId] = useState(documents[0]?.doc_id ?? "");
  const [docBId, setDocBId] = useState(documents[1]?.doc_id ?? documents[0]?.doc_id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!documents.length) {
      setDocAId("");
      setDocBId("");
      return;
    }
    if (!documents.some((d) => d.doc_id === docAId)) setDocAId(documents[0].doc_id);
    if (!documents.some((d) => d.doc_id === docBId)) {
      setDocBId(documents[1]?.doc_id ?? documents[0].doc_id);
    }
  }, [documents, docAId, docBId]);

  const docA = documents.find((d) => d.doc_id === docAId) ?? documents[0];
  const docB = documents.find((d) => d.doc_id === docBId) ?? documents[1] ?? documents[0];
  const canCompare = useMemo(
    () => Boolean(docA && docB && docA.doc_id !== docB.doc_id),
    [docA, docB],
  );

  async function handleCompare() {
    if (!canCompare || !docA || !docB) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await queryDocuments(
        `Compare "${docA.source}" and "${docB.source}". What topics overlap and how do they differ?`,
        "router",
        8,
      );
      setResult(response.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compare failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="sample-fade-in space-y-4">
      <header className="sample-card p-6">
        <h2 className="sample-heading text-xl text-[var(--sample-text)]">Compare two readings</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--sample-muted)]">
          Handy before an exam — see what overlaps and what each PDF covers on its own.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <DocSelect label="First file" value={docA?.doc_id ?? ""} options={documents} onChange={setDocAId} />
          <DocSelect label="Second file" value={docB?.doc_id ?? ""} options={documents} onChange={setDocBId} />
        </div>

        {docA && docB && (
          <p className="mt-4 text-sm text-[var(--sample-dim)]">
            {docA.source} <span className="text-[var(--sample-muted)]">and</span> {docB.source}
          </p>
        )}

        <button
          type="button"
          disabled={!canCompare || loading}
          onClick={() => void handleCompare()}
          className="sample-btn sample-btn-primary mt-5"
        >
          {loading ? "Comparing…" : "Run comparison"}
        </button>
      </header>

      {!canCompare && documents.length < 2 && (
        <p className="sample-card-inset px-4 py-3 text-sm text-[var(--sample-muted)]">
          Add at least two files to compare them.
        </p>
      )}
      {error && <p className="sample-card-inset px-4 py-3 text-sm text-red-700/80">{error}</p>}
      {result && (
        <section className="sample-card p-5">
          <h3 className="text-sm font-medium text-[var(--sample-text)]">Comparison</h3>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-[var(--sample-muted)]">
            {result}
          </p>
        </section>
      )}
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
  options: DocumentInfo[];
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
          <option key={doc.doc_id} value={doc.doc_id}>
            {doc.source}
          </option>
        ))}
      </select>
    </label>
  );
}