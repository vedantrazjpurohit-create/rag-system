"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { IndexCompare } from "@/components/index/IndexCompare";
import { IndexLibrary } from "@/components/index/IndexLibrary";
import { IndexReview } from "@/components/index/IndexReview";
import { IndexWorkspace } from "@/components/index/IndexWorkspace";
import { SampleHeader, type SampleTab } from "@/components/sample/SampleHeader";
import { SampleHero } from "@/components/sample/SampleHero";
import { deleteDocument, getHealth, listDocuments } from "@/lib/api";
import type { DocumentInfo } from "@/lib/types";

export default function Home() {
  const [tab, setTab] = useState<SampleTab>("workspace");
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [wakingServer, setWakingServer] = useState(false);

  const indexedCount = useMemo(() => documents.length, [documents]);

  const refreshDocuments = useCallback(async () => {
    setDocsLoading(true);
    try {
      const response = await listDocuments();
      setDocuments(response.documents);
    } catch {
      setDocuments([]);
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
    try {
      await deleteDocument(docId);
      await refreshDocuments();
    } catch {
      /* stale state until manual refresh */
    }
  }

  return (
    <>
      <SampleHeader active={tab} onChange={setTab} />

      <main className="mx-auto max-w-5xl px-5 py-6 sm:py-8">
        {wakingServer && apiOnline === null && (
          <div className="sample-card-inset mb-6 px-4 py-3 text-sm text-[var(--sample-muted)]">
            Waking server… Render free tier can take 30–60s after idle. The page will load once the
            API responds.
          </div>
        )}
        {apiOnline === false && (
          <div className="sample-card-inset mb-6 px-4 py-3 text-sm text-[var(--sample-muted)]">
            API offline. Run{" "}
            <code className="rounded bg-[var(--sample-highlight)] px-1.5 py-0.5 font-mono text-xs">
              .\launch.ps1
            </code>{" "}
            locally or deploy to Render for a public URL.
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
        {tab === "library" && (
          <IndexLibrary
            documents={documents}
            loading={docsLoading}
            onRemoveDocument={handleDelete}
          />
        )}
        {tab === "compare" && <IndexCompare documents={documents} />}
        {tab === "review" && <IndexReview documentCount={documents.length} />}
      </main>

      <footer className="mx-auto max-w-5xl px-5 pb-10 pt-2">
        <p className="text-center text-sm text-[var(--sample-dim)]">Made for late-night study sessions</p>
      </footer>
    </>
  );
}