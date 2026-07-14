"use client";

import { useEffect, useState } from "react";

import { getAppConfig, queryDocuments } from "@/lib/api";
import type { QueryResponse, Strategy } from "@/lib/types";

import { ContextCard } from "./ContextCard";

const STRATEGIES: { id: Strategy; label: string; hint: string }[] = [
  { id: "router", label: "Router", hint: "Auto-picks vector, BM25, or hybrid" },
  { id: "vector", label: "Vector", hint: "Semantic similarity" },
  { id: "bm25", label: "BM25", hint: "Keyword matching" },
  { id: "hybrid", label: "Hybrid", hint: "Fused vector + BM25" },
];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  meta?: QueryResponse;
}

export function ChatPanel() {
  const [strategy, setStrategy] = useState<Strategy>("router");
  const [llmEnabled, setLlmEnabled] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Upload documents, then ask a question. I'll retrieve supporting chunks and show scores + timing.",
    },
  ]);
  const [lastResponse, setLastResponse] = useState<QueryResponse | null>(null);

  useEffect(() => {
    getAppConfig()
      .then((cfg) => setLlmEnabled(cfg.llm_enabled))
      .catch(() => setLlmEnabled(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    setInput("");
    setError(null);
    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: question }]);

    try {
      const response = await queryDocuments(question, strategy);
      setLastResponse(response);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: response.answer, meta: response },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Query failed";
      setError(msg);
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${msg}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full min-h-[520px] flex-col gap-4 lg:flex-row">
      <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-slate-800 bg-slate-900/50">
        <div className="border-b border-slate-800 px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] text-slate-500">
              Answers: {llmEnabled ? "Grok LLM (xAI)" : "template (set XAI_API_KEY for LLM)"}
            </span>
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
              {msg.meta && (
                <p className="mt-2 font-mono text-[10px] text-slate-500">
                  {msg.meta.strategy} · {msg.meta.answer_mode} · retrieve{" "}
                  {msg.meta.timing_ms.retrieve}ms · gen {msg.meta.timing_ms.generate}ms
                </p>
              )}
            </div>
          ))}
          {loading && (
            <p className="text-xs text-slate-500 animate-pulse">Retrieving contexts…</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="border-t border-slate-800 p-4">
          <div className="flex gap-2">
            <input
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