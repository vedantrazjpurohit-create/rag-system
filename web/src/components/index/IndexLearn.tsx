"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getAppConfig, runStudy } from "@/lib/api";
import type { DocumentInfo, Flashcard, RetrievedContext, SearchHistoryEntry, StudyMode } from "@/lib/types";

import { IndexContextCard } from "./IndexContextCard";

const MODES: { id: StudyMode; label: string; hint: string }[] = [
  { id: "notes", label: "Notes", hint: "Generate study notes from your PDFs" },
  { id: "define", label: "Definition", hint: "Find a definition in your files" },
  { id: "flashcards", label: "Flashcards", hint: "Build Q&A cards to review" },
  { id: "web", label: "Web", hint: "Background paragraph — no links" },
];

const HISTORY_KEY = "index-search-history-v1";

function loadHistory(): SearchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SearchHistoryEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, 30) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: SearchHistoryEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 30)));
}

interface IndexLearnProps {
  documents: DocumentInfo[];
}

export function IndexLearn({ documents }: IndexLearnProps) {
  const [mode, setMode] = useState<StudyMode>("notes");
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [notes, setNotes] = useState<string | null>(null);
  const [definition, setDefinition] = useState<string | null>(null);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [webSummary, setWebSummary] = useState<string | null>(null);
  const [contexts, setContexts] = useState<RetrievedContext[]>([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [llmEnabled, setLlmEnabled] = useState(false);

  const docIds = useMemo(() => new Set(documents.map((d) => d.doc_id)), [documents]);
  const visibleContexts = useMemo(
    () => contexts.filter((ctx) => docIds.has(ctx.doc_id)),
    [contexts, docIds],
  );

  useEffect(() => {
    setHistory(loadHistory());
    getAppConfig()
      .then((cfg) => setLlmEnabled(cfg.llm_enabled))
      .catch(() => setLlmEnabled(false));
  }, []);

  const pushHistory = useCallback((entry: SearchHistoryEntry) => {
    setHistory((prev) => {
      const next = [entry, ...prev.filter((h) => !(h.topic === entry.topic && h.mode === entry.mode))].slice(
        0,
        30,
      );
      saveHistory(next);
      return next;
    });
  }, []);

  async function handleGenerate(nextTopic?: string, nextMode?: StudyMode) {
    const query = (nextTopic ?? topic).trim();
    const chosen = nextMode ?? mode;
    if (!query || loading) return;

    setError(null);
    setLoading(true);
    setShowBack(false);
    setCardIndex(0);

    try {
      const result = await runStudy({ mode: chosen, topic: query, count: 8 });
      setNotes(result.notes ?? null);
      setDefinition(result.definition ?? null);
      setCards(result.cards ?? []);
      setWebSummary(result.summary ?? null);
      setContexts(result.contexts ?? []);

      if (chosen !== "web") {
        try {
          const web = await runStudy({ mode: "web", topic: query });
          setWebSummary(web.summary ?? null);
        } catch {
          /* web background is optional */
        }
      }

      pushHistory({
        id: crypto.randomUUID(),
        topic: query,
        mode: chosen,
        at: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Study request failed");
    } finally {
      setLoading(false);
    }
  }

  const activeCard = cards[cardIndex];

  return (
    <div className="sample-fade-in space-y-4">
      <section className="sample-card p-6">
        <h2 className="sample-heading text-xl text-[var(--sample-text)]">Learn from your library</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--sample-muted)]">
          Generate notes, pull definitions, build flashcards, and read a short web background — all
          from what you search. Web results are plain paragraphs, not links.
        </p>
        <p className="mt-2 text-xs text-[var(--sample-dim)]">
          {llmEnabled ? "Full generation · Grok enabled" : "Template mode · add XAI_API_KEY for richer output"}
        </p>
      </section>

      <div className="grid gap-4 xl:grid-cols-[190px_1fr_230px_230px]">
        <aside className="sample-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-[var(--sample-text)]">Your searches</h3>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem(HISTORY_KEY);
                  setHistory([]);
                }}
                className="sample-btn sample-btn-ghost text-xs"
              >
                Clear
              </button>
            )}
          </div>
          <ul className="max-h-[520px] space-y-2 overflow-y-auto">
            {history.length === 0 ? (
              <li className="sample-card-inset px-3 py-4 text-center text-xs text-[var(--sample-muted)]">
                Searches you run will show up here
              </li>
            ) : (
              history.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setTopic(entry.topic);
                      setMode(entry.mode);
                      void handleGenerate(entry.topic, entry.mode);
                    }}
                    className="sample-card-inset w-full px-3 py-2.5 text-left transition hover:bg-[var(--sample-highlight)]"
                  >
                    <p className="truncate text-sm text-[var(--sample-text)]">{entry.topic}</p>
                    <p className="mt-1 text-xs text-[var(--sample-dim)]">
                      {modeLabel(entry.mode)} · {formatWhen(entry.at)}
                    </p>
                  </button>
                </li>
              ))
            )}
          </ul>
        </aside>

        <section className="sample-card flex min-h-[560px] flex-col overflow-hidden">
          <div className="border-b border-[var(--sample-border)] px-4 py-3">
            <div className="flex flex-wrap gap-1.5">
              {MODES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  title={item.hint}
                  onClick={() => setMode(item.id)}
                  className={`sample-btn px-2.5 py-1 text-xs ${
                    mode === item.id
                      ? "sample-btn-outline ring-1 ring-[var(--sample-border-strong)]"
                      : "sample-btn-ghost"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-5">
            {loading && (
              <p className="text-sm text-[var(--sample-dim)]">Working on your {modeLabel(mode).toLowerCase()}…</p>
            )}
            {!loading && mode === "notes" && notes && (
              <article className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--sample-text)]">
                {notes}
              </article>
            )}
            {!loading && mode === "define" && definition && (
              <article className="text-sm leading-relaxed text-[var(--sample-text)]">{definition}</article>
            )}
            {!loading && mode === "flashcards" && cards.length > 0 && activeCard && (
              <div className="space-y-4">
                <div className="sample-card-inset min-h-[200px] p-5">
                  <p className="text-xs text-[var(--sample-dim)]">
                    Card {cardIndex + 1} of {cards.length} · {activeCard.source}
                  </p>
                  <p className="mt-3 text-base leading-relaxed text-[var(--sample-text)]">
                    {showBack ? activeCard.back : activeCard.front}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowBack((v) => !v)}
                    className="sample-btn sample-btn-outline"
                  >
                    {showBack ? "Show question" : "Show answer"}
                  </button>
                  <button
                    type="button"
                    disabled={cardIndex === 0}
                    onClick={() => {
                      setCardIndex((i) => Math.max(0, i - 1));
                      setShowBack(false);
                    }}
                    className="sample-btn sample-btn-ghost"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={cardIndex >= cards.length - 1}
                    onClick={() => {
                      setCardIndex((i) => Math.min(cards.length - 1, i + 1));
                      setShowBack(false);
                    }}
                    className="sample-btn sample-btn-ghost"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            {!loading && mode === "web" && webSummary && (
              <article className="text-sm leading-relaxed text-[var(--sample-text)]">{webSummary}</article>
            )}
            {!loading && !notes && !definition && !cards.length && !webSummary && (
              <p className="text-sm text-[var(--sample-muted)]">
                {documents.length === 0 && mode !== "web"
                  ? "Upload PDFs first, then generate notes, definitions, or flashcards."
                  : "Enter a topic below — e.g. “equilibrium”, “chapter 3 moments”, or “PID controller”."}
              </p>
            )}
          </div>

          <form
            className="border-t border-[var(--sample-border)] p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleGenerate();
            }}
          >
            <div className="flex gap-2">
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={
                  mode === "define"
                    ? "Term to define — e.g. resultant force-couple"
                    : mode === "flashcards"
                      ? "Topic for flashcards — e.g. control systems"
                      : mode === "web"
                        ? "Search the web for background — e.g. Nyquist stability"
                        : "Topic for notes — e.g. summarize chapter 3"
                }
                className="sample-input min-w-0 flex-1"
              />
              <button
                type="submit"
                disabled={loading || !topic.trim()}
                className="sample-btn sample-btn-primary shrink-0"
              >
                Go
              </button>
            </div>
            {error && <p className="mt-2 text-xs text-red-700/80">{error}</p>}
          </form>
        </section>

        <aside className="space-y-3">
          <p className="text-sm font-medium text-[var(--sample-text)]">From your files</p>
          {visibleContexts.length === 0 ? (
            <p className="sample-card-inset px-3 py-4 text-center text-xs text-[var(--sample-muted)]">
              File sources appear for notes, definitions, and flashcards
            </p>
          ) : (
            visibleContexts.map((ctx, idx) => (
              <IndexContextCard key={ctx.chunk_id} context={ctx} rank={idx + 1} />
            ))
          )}
        </aside>

        <aside className="space-y-3">
          <p className="text-sm font-medium text-[var(--sample-text)]">From the web</p>
          {webSummary ? (
            <article className="sample-card p-4">
              <p className="text-sm leading-relaxed text-[var(--sample-muted)]">{webSummary}</p>
            </article>
          ) : (
            <p className="sample-card-inset px-3 py-4 text-center text-xs text-[var(--sample-muted)]">
              A short background paragraph shows here — no links, just context
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function modeLabel(mode: StudyMode): string {
  return MODES.find((m) => m.id === mode)?.label ?? mode;
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}