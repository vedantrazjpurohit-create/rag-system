"use client";

import { useCallback, useEffect, useState } from "react";

import { ChatPanel } from "@/components/ChatPanel";
import { DocumentsPanel } from "@/components/DocumentsPanel";
import { Header } from "@/components/Header";
import { EvalDashboard } from "@/components/EvalDashboard";
import { SafetyLab } from "@/components/SafetyLab";
import { UploadPanel } from "@/components/UploadPanel";
import { deleteDocument, getHealth, listDocuments } from "@/lib/api";
import type { DocumentInfo } from "@/lib/types";

type Tab = "demo" | "eval" | "safety";

export default function Home() {
  const [tab, setTab] = useState<Tab>("demo");
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

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
    getHealth()
      .then(() => {
        setApiOnline(true);
        void refreshDocuments();
      })
      .catch(() => setApiOnline(false));
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
    <div className="min-h-screen bg-[#070b14] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(16,185,129,0.08),_transparent_50%)]" />
      <Header activeTab={tab} onTabChange={setTab} apiOnline={apiOnline} />

      <main className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {apiOnline === false && (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-100">
            API offline. Start the backend:{" "}
            <code className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-xs">
              uvicorn api.app.main:app --reload --app-dir api
            </code>
          </div>
        )}

        {tab === "demo" && (
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <aside className="space-y-4">
              <UploadPanel onUploaded={refreshDocuments} />
              <DocumentsPanel
                documents={documents}
                loading={docsLoading}
                onDelete={handleDelete}
              />
            </aside>
            <ChatPanel />
          </div>
        )}
        {tab === "eval" && <EvalDashboard />}
        {tab === "safety" && <SafetyLab />}
      </main>
    </div>
  );
}