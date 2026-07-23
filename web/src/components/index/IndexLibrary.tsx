"use client";

import type { DocumentInfo } from "@/lib/types";

interface IndexLibraryProps {
  documents: DocumentInfo[];
  loading: boolean;
  onRemoveDocument: (docId: string, source?: string) => void;
}

export function IndexLibrary({ documents, loading, onRemoveDocument }: IndexLibraryProps) {
  const totalChunks = documents.reduce((sum, d) => sum + d.chunk_count, 0);

  return (
    <div className="sample-fade-in space-y-4">
      <section className="sample-card p-6">
        <h2 className="sample-heading text-xl text-[var(--sample-text)]">Your files</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--sample-muted)]">
          Everything you&apos;ve uploaded lives here. Search pulls from all of them at once.
        </p>
        <p className="mt-3 text-sm text-[var(--sample-dim)]">
          {documents.length} file{documents.length === 1 ? "" : "s"} · {totalChunks} chunks indexed
        </p>
      </section>

      <div className="sample-card overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--sample-border)] bg-[var(--sample-highlight)] text-[var(--sample-muted)]">
            <tr>
              <th className="px-4 py-3 font-normal">Name</th>
              <th className="px-4 py-3 font-normal">Chunks</th>
              <th className="px-4 py-3 font-normal">Status</th>
              <th className="px-4 py-3 text-right font-normal" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-[var(--sample-muted)]">
                  Loading your library…
                </td>
              </tr>
            ) : documents.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-[var(--sample-muted)]">
                  Nothing here yet — head to Study and add a PDF.
                </td>
              </tr>
            ) : (
              documents.map((doc) => (
                <tr key={doc.doc_id} className="border-b border-[var(--sample-border)] last:border-0">
                  <td className="px-4 py-3 text-[var(--sample-text)]">{doc.source}</td>
                  <td className="px-4 py-3 text-[var(--sample-muted)]">{doc.chunk_count}</td>
                  <td className="px-4 py-3 text-[var(--sample-muted)]">Ready</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onRemoveDocument(doc.doc_id, doc.source);
                      }}
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