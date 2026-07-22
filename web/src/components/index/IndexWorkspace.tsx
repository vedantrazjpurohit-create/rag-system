"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { queryStream } from "@/lib/api";
import type { DocumentInfo, QueryResponse, RetrievedContext } from "@/lib/types";

import { EngineeringText, normalizeForDisplay } from "./EngineeringText";
import { IndexContextCard } from "./IndexContextCard";
import { IndexUpload } from "./IndexUpload";

const ASK_PLACEHOLDER =
  "Ask in plain language — e.g. what is resultant force-couple, define equilibrium, summarize chapter 3…";

const CHAT_STORAGE_KEY = "index-chat-v1";

const DEFAULT_MESSAGES: ChatMessage[] = [
  {
    role: "assistant",
    content:
      "Hey — upload your PDFs on the left, then just ask. Definitions, formulas, summaries — answers stream in when Grok is enabled.",
  },
];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  meta?: QueryResponse;
  streaming?: boolean;
}

interface IndexWorkspaceProps {
  documents: DocumentInfo[];
  onUploaded: () => void;
  onRemoveDocument: (docId: string) => void;
  focusNonce?: number;
}

export function IndexWorkspace({
  documents,
  onUploaded,
  onRemoveDocument,
  focusNonce = 0,
}: IndexWorkspaceProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window === "undefined") return DEFAULT_MESSAGES;
    try {
      const saved = localStorage.getItem(CHAT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ChatMessage[];
        if (parsed.length) return parsed;
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_MESSAGES;
  });
  const [contexts, setContexts] = useState<RetrievedContext[]>([]);
  const [broadPassages, setBroadPassages] = useState<RetrievedContext[]>([]);
  const [weakMatch, setWeakMatch] = useState(false);
  const [showBroad, setShowBroad] = useState(false);
  const [activeSource, setActiveSource] = useState<number | null>(null);

  const docIds = useMemo(() => new Set(documents.map((d) => d.doc_id)), [documents]);

  const visibleContexts = useMemo(
    () => contexts.filter((ctx) => !ctx.doc_id || docIds.has(ctx.doc_id) || docIds.size === 0),
    [contexts, docIds],
  );

  const visibleBroad = useMemo(
    () => broadPassages.filter((ctx) => !ctx.doc_id || docIds.has(ctx.doc_id) || docIds.size === 0),
    [broadPassages, docIds],
  );

  const effectiveActiveSource =
    activeSource !== null && visibleContexts[activeSource - 1] ? activeSource : null;

  useEffect(() => {
    const persistable = messages.filter((m) => !m.streaming);
    if (persistable.length > 1) {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(persistable));
    }
  }, [messages]);

  useEffect(() => {
    if (focusNonce > 0) inputRef.current?.focus();
  }, [focusNonce]);

  async function runQuery(question: string) {
    setError(null);
    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);

    let streamed = "";
    let retrieved: RetrievedContext[] = [];
    let broad: RetrievedContext[] = [];
    let wasWeak = false;
    try {
      await queryStream(question, "bm25", {
        onMeta: (meta) => {
          retrieved = meta.contexts;
          broad = meta.broad_passages ?? [];
          wasWeak = Boolean(meta.weak_match);
          setContexts(meta.contexts);
          setBroadPassages(broad);
          setWeakMatch(wasWeak);
          setShowBroad(false);
        },
        onToken: (token) => {
          streamed += token;
          const display = normalizeForDisplay(streamed);
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last?.role === "assistant") {
              copy[copy.length - 1] = { ...last, content: display, streaming: true };
            }
            return copy;
          });
        },
        onDone: (data) => {
          const answer = normalizeForDisplay(data.answer);
          wasWeak = Boolean(data.weak_match ?? wasWeak);
          const full: QueryResponse = {
            answer,
            contexts: retrieved,
            broad_passages: broad,
            weak_match: wasWeak,
            strategy: data.strategy,
            answer_mode: data.answer_mode,
            timing_ms: data.timing_ms,
          };
          setContexts(retrieved);
          setBroadPassages(broad);
          setWeakMatch(wasWeak);
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last?.role === "assistant") {
              copy[copy.length - 1] = {
                role: "assistant",
                content: answer,
                meta: full,
                streaming: false,
              };
            }
            return copy;
          });
        },
        onError: (msg) => {
          setError(msg);
          setMessages((prev) => [
            ...prev.slice(0, -1),
            { role: "assistant", content: `Error: ${msg}` },
          ]);
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Query failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;
    setInput("");
    await runQuery(question);
  }

  return (
    <div className="sample-fade-in grid gap-4 lg:grid-cols-[240px_1fr_250px]">
      <aside className="space-y-4">
        <IndexUpload fileCount={documents.length} onUploaded={onUploaded} />

        <Panel title="Your files" count={documents.length}>
          <p className="mb-2 text-xs text-[var(--sample-dim)]">
            {documents.length} ready to search
          </p>
          <ul className="max-h-[280px] space-y-2 overflow-y-auto">
            {documents.length === 0 ? (
              <li className="sample-card-inset px-3 py-4 text-center text-xs text-[var(--sample-muted)]">
                Nothing uploaded yet
              </li>
            ) : (
              documents.map((doc) => (
                <li key={doc.doc_id} className="sample-card-inset px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm text-[var(--sample-text)]">
                      {doc.source}
                    </p>
                    <button
                      type="button"
                      onClick={() => onRemoveDocument(doc.doc_id)}
                      aria-label={`Remove ${doc.source}`}
                      className="sample-btn sample-btn-ghost shrink-0 text-xs"
                    >
                      Remove
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-[var(--sample-dim)]">ready</p>
                </li>
              ))
            )}
          </ul>
        </Panel>
      </aside>

      <section className="sample-card flex min-h-[560px] flex-col overflow-hidden">
        <div className="border-b border-[var(--sample-border)] px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[var(--sample-muted)]">
              {documents.length === 0
                ? "Add a PDF first, then ask anything."
                : `Searching across ${documents.length} file${documents.length === 1 ? "" : "s"}`}
            </p>
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem(CHAT_STORAGE_KEY);
                setMessages(DEFAULT_MESSAGES);
                setContexts([]);
                setBroadPassages([]);
                setWeakMatch(false);
                setShowBroad(false);
                setActiveSource(null);
              }}
              className="sample-btn sample-btn-ghost text-xs"
            >
              Clear chat
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
          {messages.map((msg, idx) => (
            <div
              key={`${msg.role}-${idx}`}
              className={msg.role === "user" ? "sample-bubble-user" : "sample-bubble-assistant"}
            >
              {msg.role === "assistant" ? (
                <EngineeringText text={msg.content} />
              ) : (
                msg.content
              )}
              {msg.streaming && (
                <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-[var(--sample-dim)]" />
              )}
            </div>
          ))}
          {loading && !messages.at(-1)?.streaming && (
            <p className="text-sm text-[var(--sample-dim)]">Looking through your notes…</p>
          )}
        </div>

        <form className="border-t border-[var(--sample-border)] p-4" onSubmit={handleSubmit}>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={ASK_PLACEHOLDER}
              className="sample-input min-w-0 flex-1"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="sample-btn sample-btn-primary shrink-0"
            >
              Ask
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-red-700/80">{error}</p>}
        </form>
      </section>

      <aside className="space-y-3">
        <p className="text-sm font-medium text-[var(--sample-text)]">Where it came from</p>
        {visibleContexts.length === 0 ? (
          <p className="sample-card-inset px-3 py-4 text-center text-xs text-[var(--sample-muted)]">
            {weakMatch
              ? "No strong match for that question"
              : "Sources show up after you ask something"}
          </p>
        ) : (
          visibleContexts.map((ctx, idx) => (
            <IndexContextCard
              key={ctx.chunk_id}
              context={ctx}
              rank={idx + 1}
              active={effectiveActiveSource === idx + 1}
              onSelect={() => {
                setActiveSource(idx + 1);
                document.getElementById(`source-${idx + 1}`)?.scrollIntoView({
                  behavior: "smooth",
                  block: "nearest",
                });
              }}
            />
          ))
        )}
        {weakMatch && visibleBroad.length > 0 && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowBroad((v) => !v)}
              className="sample-btn sample-btn-ghost w-full text-xs"
            >
              {showBroad ? "Hide broad passages" : "Show broad passages (may be unrelated)"}
            </button>
            {showBroad &&
              visibleBroad.map((ctx, idx) => (
                <IndexContextCard
                  key={`broad-${ctx.chunk_id}-${idx}`}
                  context={ctx}
                  rank={idx + 1}
                />
              ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function Panel({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="sample-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-[var(--sample-text)]">{title}</h2>
        {count !== undefined && <span className="text-xs text-[var(--sample-dim)]">{count}</span>}
      </div>
      {children}
    </section>
  );
}