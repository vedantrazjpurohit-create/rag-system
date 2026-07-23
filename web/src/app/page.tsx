"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { IndexCompare } from "@/components/index/IndexCompare";
import { IndexLearn } from "@/components/index/IndexLearn";
import { IndexLibrary } from "@/components/index/IndexLibrary";
import { IndexWorkspace } from "@/components/index/IndexWorkspace";
import { SampleHeader, type SampleTab } from "@/components/sample/SampleHeader";
import { SampleHero } from "@/components/sample/SampleHero";
import { deleteDocument, getHealth, listDocuments, syncLocalCorpus } from "@/lib/api";
import type { DocumentInfo } from "@/lib/types";

export default function Home() {
  const [tab, setTab] = useState<SampleTab>("workspace");
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [wakingServer, setWakingServer] = useState(false);

  const indexedCount = useMemo(() => documents.length, [documents]);

  const [docsError, setDocsError] = useState<string | null>(null);

  const refreshDocuments = useCallback(async () => {
    setDocsLoading(true);
    setDocsError(null);
    try {
      // Re-push browser-cached PDFs so Learn/chat hit a warm index on this instance
      const synced = await syncLocalCorpus();
      if (synced.documents?.length) {
        setDocuments(synced.documents);
      } else {
        const response = await listDocuments();
        setDocuments(response.documents ?? []);
      }
    } catch (err) {
      try {
        const response = await listDocuments();
        setDocuments(response.documents ?? []);
      } catch {
        setDocsError(err instanceof Error ? err.message : "Could not load your library");
      }
    } finally {
      setDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    const wakeTimer = window.setTimeout(() => setWakingServer(true), 2500);
    getHealth()
      .then(() => {
        setApiOnline(true);
        void refreshDocuments();
      })
      .catch(() => setApiOnline(false))
      .finally(() => {
        window.clearTimeout(wakeTimer);
        setWakingServer(false);
      });
  }, [refreshDocuments]);

  async function handleDelete(docId: string) {
    // Optimistic UI so Remove feels instant even if the server instance never had the file
    setDocuments((prev) => prev.filter((d) => d.doc_id !== docId));
    setDocsError(null);
    try {
      await deleteDocument(docId);
      await refreshDocuments();
    } catch (err) {
      setDocsError(err instanceof Error ? err.message : "Could not remove file");
      await refreshDocuments();
    }
  }

  return (
    <>
      <SampleHeader active={tab} onChange={setTab} />

      <main
        className={`mx-auto px-5 py-6 sm:py-8 ${tab === "learn" ? "max-w-7xl" : "max-w-5xl"}`}
      >
        {wakingServer && apiOnline === null && (
          <div className="sample-card-inset mb-6 px-4 py-3 text-sm text-[var(--sample-muted)]">
            Starting API… first load can take a few seconds.
          </div>
        )}
        {apiOnline === false && (
          <div className="sample-card-inset mb-6 px-4 py-3 text-sm text-[var(--sample-muted)]">
            API offline. On Vercel this should be same-origin — try a hard refresh. Locally run{" "}
            <code className="rounded bg-[var(--sample-highlight)] px-1.5 py-0.5 font-mono text-xs">
              cd web && npm run dev
            </code>{" "}
            (or <code className="font-mono text-xs">.\launch.ps1</code> for the Python API).
          </div>
        )}
        {docsError && apiOnline && (
          <div className="sample-card-inset mb-6 px-4 py-3 text-sm text-red-700/80">
            Library sync failed: {docsError}
          </div>
        )}

        {tab === "workspace" && (
          <div className="space-y-5">
            <SampleHero documentCount={documents.length} indexedCount={indexedCount} />
            <IndexWorkspace
              documents={documents}
              onUploaded={refreshDocuments}
              onRemoveDocument={handleDelete}
            />
          </div>
        )}
        {tab === "learn" && <IndexLearn documents={documents} />}
        {tab === "library" && (
          <IndexLibrary
            documents={documents}
            loading={docsLoading}
            onRemoveDocument={handleDelete}
          />
        )}
        {tab === "compare" && <IndexCompare documents={documents} />}
      </main>

      <footer className="mx-auto max-w-5xl px-5 pb-10 pt-2">
        <p className="text-center text-sm text-[var(--sample-dim)]">Made for late-night study sessions</p>
      </footer>
    </>
  );
}