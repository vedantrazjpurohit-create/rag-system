"use client";

import { useCallback, useMemo, useState } from "react";

import { SampleCompare } from "@/components/sample/SampleCompare";
import { SampleHeader, type SampleTab } from "@/components/sample/SampleHeader";
import { SampleHero } from "@/components/sample/SampleHero";
import { SampleLibrary } from "@/components/sample/SampleLibrary";
import { SampleReview } from "@/components/sample/SampleReview";
import { SampleWorkspace } from "@/components/sample/SampleWorkspace";
import { INITIAL_DOCUMENTS, createDocumentFromFile, type MockDocument } from "@/components/sample/mockData";

export default function SamplePage() {
  const [tab, setTab] = useState<SampleTab>("workspace");
  const [documents, setDocuments] = useState<MockDocument[]>(INITIAL_DOCUMENTS);

  const indexedCount = useMemo(
    () => documents.filter((d) => d.status === "indexed").length,
    [documents],
  );

  const handleRemoveDocument = useCallback((id: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const handleAddFiles = useCallback((files: FileList) => {
    const incoming = Array.from(files)
      .filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"))
      .map(createDocumentFromFile);

    if (!incoming.length) return;

    setDocuments((prev) => [...prev, ...incoming]);

    incoming.forEach((doc) => {
      window.setTimeout(() => {
        setDocuments((prev) =>
          prev.map((d) => (d.id === doc.id ? { ...d, status: "indexed" as const } : d)),
        );
      }, 1400 + Math.random() * 800);
    });
  }, []);

  return (
    <>
      <SampleHeader active={tab} onChange={setTab} />

      <main className="mx-auto max-w-5xl px-5 py-6 sm:py-8">
        <p className="sample-card-inset mb-6 px-4 py-3 text-sm text-[var(--sample-muted)]">
          This is a design preview only — the live app is still at{" "}
          <span className="text-[var(--sample-text)]">/</span>
        </p>

        {tab === "workspace" && (
          <div className="space-y-5">
            <SampleHero documentCount={documents.length} indexedCount={indexedCount} />
            <SampleWorkspace
              documents={documents}
              onAddFiles={handleAddFiles}
              onRemoveDocument={handleRemoveDocument}
            />
          </div>
        )}
        {tab === "library" && (
          <SampleLibrary documents={documents} onRemoveDocument={handleRemoveDocument} />
        )}
        {tab === "compare" && <SampleCompare documents={documents} />}
        {tab === "review" && <SampleReview documentCount={documents.length} />}
      </main>

      <footer className="mx-auto max-w-5xl px-5 pb-10 pt-2">
        <p className="text-center text-sm text-[var(--sample-dim)]">Made for late-night study sessions</p>
      </footer>
    </>
  );
}