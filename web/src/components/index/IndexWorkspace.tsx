"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { getAppConfig, queryStream } from "@/lib/api";
import type { DocumentInfo, QueryResponse, RetrievedContext, Strategy } from "@/lib/types";

import { IndexContextCard } from "./IndexContextCard";
import { IndexUpload } from "./IndexUpload";

const STRATEGIES: { id: Strategy; label: string }[] = [
  { id: "router", label: "Auto" },
  { id: "bm25", label: "Keywords" },
  { id: "vector", label: "Semantic" },
  { id: "hybrid", label: "Hybrid" },
];

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
  const [strategy, setStrategy] = useState<Strategy>("bm25");
  const [llmEnabled, setLlmEnabled] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(DEFAULT_MESSAGES);
  const [contexts, setContexts] = useState<RetrievedContext[]>([]);
  const [activeSource, setActiveSource] = useState<number | null>(null);

  const docIds = useMemo(() => new Set(documents.map((d) => d.doc_id)), [documents]);

  const visibleContexts = useMemo(
    () => contexts.filter((ctx) => docIds.has(ctx.doc_id)),
    [contexts, docIds],
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CHAT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ChatMessage[];
        if (parsed.length) setMessages(parsed);
      }
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  useEffect(() => {
    const persistable = messages.filter((m) => !m.streaming);
    if (persistable.length > 1) {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(persistable));
    }
  }, [messages]);

  useEffect(() => {
    getAppConfig()
      .then((cfg) => {
        setLlmEnabled(cfg.llm_enabled);
        if (cfg.default_strategy) setStrategy(cfg.default_strategy);
      })
      .catch(() => setLlmEnabled(false));
  }, []);

  useEffect(() => {
    if (focusNonce > 0) inputRef.current?.focus();
  }, [focusNonce]);

  useEffect(() => {
    if (activeSource !== null && !visibleContexts[activeSource - 1]) {
      setActiveSource(null);
    }
  }, [activeSource, visibleContexts]);

  async function runQuery(question: string) {
    setError(null);
    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);

    let streamed = "";
    let retrieved: RetrievedContext[] = [];
    try {
      await queryStream(question, strategy, {
        onMeta: (meta) => {
          retrieved = meta.contexts;
          setContexts(meta.contexts);
        },
        onToken: (token) => {
          streamed += token;
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last?.role === "assistant") {
              copy[copy.length - 1] = { ...last, content: streamed, streaming: true };
            }
            return copy;
          });
        },
        onDone: (data) => {
          const full: QueryResponse = {
            answer: data.answer,
            contexts: retrieved,
            strategy: data.strategy,
            answer_mode: data.answer_mode,
            timing_ms: data.timing_ms,
          };
          setContexts(retrieved);
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last?.role === "assistant") {
              copy[copy.length - 1] = {
                role: "assistant",
                content: data.answer,
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
                setActiveSource(null);
              }}
              className="sample-btn sample-btn-ghost text-xs"
            >
              Clear chat
            </button>
          </div>
          <p className="mb-2 text-xs text-[var(--sample-dim)]">
            {llmEnabled
              ? "Streaming · Grok (xAI)"
              : "Template excerpts · set XAI_API_KEY on Render for full answers"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {STRATEGIES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setStrategy(item.id)}
                className={`sample-btn px-2.5 py-1 text-xs ${
                  strategy === item.id
                    ? "sample-btn-outline ring-1 ring-[var(--sample-border-strong)]"
                    : "sample-btn-ghost"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
          {messages.map((msg, idx) => (
            <div
              key={`${msg.role}-${idx}`}
              className={msg.role === "user" ? "sample-bubble-user" : "sample-bubble-assistant"}
            >
              {msg.content}
              {msg.streaming && (
                <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-[var(--sample-dim)]" />
              )}
              {msg.meta && !msg.streaming && (
                <p className="mt-2 text-xs text-[var(--sample-dim)]">
                  {msg.meta.strategy} · {msg.meta.answer_mode} · retrieve {msg.meta.timing_ms.retrieve}
                  ms · gen {msg.meta.timing_ms.generate}ms
                </p>
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
            Sources show up after you ask something
          </p>
        ) : (
          visibleContexts.map((ctx, idx) => (
            <IndexContextCard
              key={ctx.chunk_id}
              context={ctx}
              rank={idx + 1}
              active={activeSource === idx + 1}
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