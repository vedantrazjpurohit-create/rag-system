"use client";

import type { MockDocument } from "./mockData";

interface SampleLibraryProps {
  documents: MockDocument[];
  onRemoveDocument: (id: string) => void;
}

export function SampleLibrary({ documents, onRemoveDocument }: SampleLibraryProps) {
  const indexed = documents.filter((d) => d.status === "indexed").length;
  const totalPages = documents.reduce((sum, d) => sum + d.pages, 0);

  return (
    <div className="sample-fade-in space-y-4">
      <section className="sample-card p-6">
        <h2 className="sample-heading text-xl text-[var(--sample-text)]">Your files</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--sample-muted)]">
          Everything you&apos;ve uploaded lives here. Search pulls from all of them at once.
        </p>
        <p className="mt-3 text-sm text-[var(--sample-dim)]">
          {indexed} ready · {totalPages} pages in total
        </p>
      </section>

      <div className="sample-card overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--sample-border)] bg-[var(--sample-highlight)] text-[var(--sample-muted)]">
            <tr>
              <th className="px-4 py-3 font-normal">Name</th>
              <th className="px-4 py-3 font-normal">Pages</th>
              <th className="px-4 py-3 font-normal">Sections</th>
              <th className="px-4 py-3 font-normal">Status</th>
              <th className="px-4 py-3 text-right font-normal" />
            </tr>
          </thead>
          <tbody>
            {documents.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[var(--sample-muted)]">
                  Nothing here yet — head to Study and add a PDF.
                </td>
              </tr>
            ) : (
              documents.map((doc) => (
                <tr key={doc.id} className="border-b border-[var(--sample-border)] last:border-0">
                  <td className="px-4 py-3 text-[var(--sample-text)]">{doc.name}</td>
                  <td className="px-4 py-3 text-[var(--sample-muted)]">{doc.pages}</td>
                  <td className="px-4 py-3 text-[var(--sample-muted)]">{doc.chapters}</td>
                  <td className="px-4 py-3 text-[var(--sample-muted)]">
                    {doc.status === "indexed" ? "Ready" : "Still reading…"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onRemoveDocument(doc.id)}
                      className="sample-btn sample-btn-ghost text-xs"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}