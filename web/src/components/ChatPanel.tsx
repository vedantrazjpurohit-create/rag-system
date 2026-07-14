"use client";

import { useEffect, useRef, useState } from "react";

import { getAppConfig, queryStream } from "@/lib/api";
import type { QueryResponse, Strategy } from "@/lib/types";

import { ContextCard } from "./ContextCard";

const STRATEGIES: { id: Strategy; label: string; hint: string }[] = [
  { id: "router", label: "Router", hint: "Auto-picks vector, BM25, or hybrid" },
  { id: "vector", label: "Vector", hint: "Semantic similarity" },
  { id: "bm25", label: "BM25", hint: "Keyword matching" },
  { id: "hybrid", label: "Hybrid", hint: "Fused vector + BM25" },
];

const SAMPLE_QUESTIONS = [
  "What chunk size was tested first?",
  "What happened when chunk size was reduced to 256?",
];

const CHAT_STORAGE_KEY = "rag-system-chat-v1";

const DEFAULT_MESSAGES: ChatMessage[] = [
  {
    role: "assistant",
    content:
      "Load the sample corpus or upload your own docs, then ask a question. Answers stream in when Grok is enabled.",
  },
];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  meta?: QueryResponse;
  streaming?: boolean;
}

interface ChatPanelProps {
  focusNonce?: number;
}

export function ChatPanel({ focusNonce = 0 }: ChatPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [strategy, setStrategy] = useState<Strategy>("router");
  const [llmEnabled, setLlmEnabled] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(DEFAULT_MESSAGES);
  const [lastResponse, setLastResponse] = useState<QueryResponse | null>(null);

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
      .then((cfg) => setLlmEnabled(cfg.llm_enabled))
      .catch(() => setLlmEnabled(false));
  }, []);

  useEffect(() => {
    if (focusNonce > 0) inputRef.current?.focus();
  }, [focusNonce]);

  async function runQuery(question: string) {
    setError(null);
    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);

    let streamed = "";
    let contexts: QueryResponse["contexts"] = [];
    try {
      await queryStream(question, strategy, {
        onMeta: (meta) => {
          contexts = meta.contexts;
          setLastResponse({
            answer: "",
            contexts: meta.contexts,
            strategy: meta.strategy,
            answer_mode: "template",
            timing_ms: { retrieve: meta.retrieve_ms, generate: 0, total: meta.retrieve_ms },
          });
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
            contexts,
            strategy: data.strategy,
            answer_mode: data.answer_mode,
            timing_ms: data.timing_ms,
          };
          setLastResponse(full);
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
    <div id="chat-panel" className="flex h-full min-h-[520px] flex-col gap-4 lg:flex-row">
      <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-slate-800 bg-slate-900/50">
        <div className="border-b border-slate-800 px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-500">
              {llmEnabled ? "Streaming · Grok (xAI)" : "Streaming · template mode"}
            </span>
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem(CHAT_STORAGE_KEY);
                setMessages(DEFAULT_MESSAGES);
                setLastResponse(null);
              }}
              className="text-[10px] text-slate-600 hover:text-slate-400"
            >
              Clear chat
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {STRATEGIES.map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.hint}
                onClick={() => setStrategy(item.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  strategy === item.id
                    ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/30"
                    : "bg-slate-950 text-slate-400 ring-1 ring-slate-800 hover:text-slate-200"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={loading}
                onClick={() => void runQuery(q)}
                className="rounded-full bg-slate-950 px-2.5 py-1 text-[10px] text-slate-400 ring-1 ring-slate-800 hover:text-emerald-300 disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.map((msg, idx) => (
            <div
              key={`${msg.role}-${idx}`}
              className={`max-w-[90%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "ml-auto bg-emerald-500/15 text-emerald-50 ring-1 ring-emerald-500/20"
                  : "bg-slate-950/80 text-slate-300 ring-1 ring-slate-800"
              }`}
            >
              {msg.content}
              {msg.streaming && (
                <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-emerald-400" />
              )}
              {msg.meta && !msg.streaming && (
                <p className="mt-2 font-mono text-[10px] text-slate-500">
                  {msg.meta.strategy} · {msg.meta.answer_mode} · retrieve{" "}
                  {msg.meta.timing_ms.retrieve}ms · gen {msg.meta.timing_ms.generate}ms
                </p>
              )}
            </div>
          ))}
          {loading && !messages.at(-1)?.streaming && (
            <p className="text-xs text-slate-500 animate-pulse">Retrieving contexts…</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="border-t border-slate-800 p-4">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your uploaded documents…"
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Ask
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
        </form>
      </section>

      <aside className="w-full shrink-0 space-y-2 lg:w-80">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Retrieved contexts
        </h3>
        {!lastResponse?.contexts.length ? (
          <p className="rounded-lg border border-dashed border-slate-800 px-3 py-6 text-center text-xs text-slate-500">
            Chunks will appear here after a query.
          </p>
        ) : (
          lastResponse.contexts.map((ctx, idx) => (
            <ContextCard key={ctx.chunk_id} context={ctx} rank={idx + 1} />
          ))
        )}
      </aside>
    </div>
  );
}