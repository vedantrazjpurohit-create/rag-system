"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getAppConfig, runStudy, syncLocalCorpus } from "@/lib/api";
import type {
  DocumentInfo,
  Flashcard,
  RetrievedContext,
  SearchHistoryEntry,
  StudyMode,
  WebSource,
} from "@/lib/types";

import { IndexContextCard } from "./IndexContextCard";

const MODES: { id: StudyMode; label: string; hint: string }[] = [
  { id: "notes", label: "Notes", hint: "Generate study notes from your PDFs" },
  { id: "define", label: "Definition", hint: "Find a definition in your files" },
  { id: "flashcards", label: "Flashcards", hint: "Build Q&A cards to review" },
  { id: "web", label: "Web", hint: "Live background from Wikipedia / the web" },
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
  const [webSources, setWebSources] = useState<WebSource[]>([]);
  const [webProvider, setWebProvider] = useState<string | null>(null);
  const [webError, setWebError] = useState<string | null>(null);
  const [matchedPassages, setMatchedPassages] = useState<number | null>(null);
  const [contexts, setContexts] = useState<RetrievedContext[]>([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [llmEnabled, setLlmEnabled] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [lastTopic, setLastTopic] = useState<string | null>(null);

  const docIds = useMemo(() => new Set(documents.map((d) => d.doc_id)), [documents]);
  const visibleContexts = useMemo(() => {
    if (!contexts.length) return [];
    const filtered = contexts.filter((ctx) => !ctx.doc_id || docIds.has(ctx.doc_id));
    // If library list is stale / ids differ, still show what retrieval returned
    return filtered.length > 0 ? filtered : contexts;
  }, [contexts, docIds]);

  useEffect(() => {
    setHistory(loadHistory());
    getAppConfig()
      .then((cfg) => {
        setLlmEnabled(cfg.llm_enabled);
        setWebSearchEnabled(cfg.web_search_enabled !== false);
      })
      .catch(() => {
        setLlmEnabled(false);
        setWebSearchEnabled(true);
      });
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
    setLastTopic(query);

    // Clear previous primary result for this mode so stale text doesn't linger
    if (chosen === "notes") setNotes(null);
    if (chosen === "define") setDefinition(null);
    if (chosen === "flashcards") setCards([]);
    if (chosen === "web") {
      setWebSummary(null);
      setWebSources([]);
      setWebProvider(null);
      setWebError(null);
    }

    try {
      if (chosen === "web") {
        const web = await runStudy({ mode: "web", topic: query });
        setWebSummary(web.summary ?? null);
        setWebSources(web.sources ?? []);
        setWebProvider(web.provider ?? null);
        setWebError(web.search_error ?? null);
        setContexts([]);
        setMatchedPassages(null);
        setNotes(null);
        setDefinition(null);
        setCards([]);
      } else {
        // Re-sync browser PDF cache → this server instance (Vercel cold starts wipe memory)
        try {
          await syncLocalCorpus();
        } catch {
          /* continue; server may still have chunks */
        }

        // Library + web background in parallel so notes aren't blocked by web search
        const [library, web] = await Promise.all([
          runStudy({ mode: chosen, topic: query, count: 8, top_k: 8 }),
          webSearchEnabled
            ? runStudy({ mode: "web", topic: query }).catch((err: unknown) => {
                return {
                  summary: null,
                  sources: [] as WebSource[],
                  provider: "none",
                  search_error: err instanceof Error ? err.message : "Web search failed",
                };
              })
            : Promise.resolve({
                summary: "Web search is disabled on this server.",
                sources: [] as WebSource[],
                provider: "none",
                search_error: "web_search_disabled",
              }),
        ]);

        setNotes(library.notes ?? null);
        setDefinition(library.definition ?? null);
        setCards(library.cards ?? []);
        setContexts(library.contexts ?? []);
        setMatchedPassages(
          typeof library.matched_passages === "number"
            ? library.matched_passages
            : (library.contexts?.length ?? 0),
        );

        setWebSummary(web.summary ?? null);
        setWebSources(web.sources ?? []);
        setWebProvider(web.provider ?? null);
        setWebError(web.search_error ?? null);

        if (chosen === "notes" && (library.matched_passages === 0 || !library.notes)) {
          setError(
            documents.length === 0
              ? "No PDFs in your library yet — upload on the Workspace tab first, then come back to Learn."
              : "No passages matched this topic in your PDFs. Try a shorter keyword (e.g. “force”), or re-upload the file.",
          );
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
  const hasPrimary =
    (mode === "notes" && !!notes) ||
    (mode === "define" && !!definition) ||
    (mode === "flashcards" && cards.length > 0) ||
    (mode === "web" && !!webSummary);

  return (
    <div className="sample-fade-in space-y-4">
      <section className="sample-card p-6">
        <h2 className="sample-heading text-xl text-[var(--sample-text)]">Learn from your library</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--sample-muted)]">
          Notes, definitions, and flashcards come from PDFs you uploaded on the Workspace tab (same
          browser). We re-sync your library before each search so Learn sees the same files. Web
          background is separate (Wikipedia / DuckDuckGo).
        </p>
        <p className="mt-2 text-xs text-[var(--sample-dim)]">
          {llmEnabled ? "Full generation · Grok enabled" : "Template mode · add XAI_API_KEY for richer output"}
          {" · "}
          {webSearchEnabled ? "Live web search on" : "Web search disabled"}
          {documents.length === 0
            ? " · No PDFs indexed yet — notes need an upload first"
            : ` · ${documents.length} file${documents.length === 1 ? "" : "s"} in library`}
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
            {lastTopic && matchedPassages !== null && mode !== "web" && (
              <p className="mt-2 text-xs text-[var(--sample-dim)]">
                Last run for “{lastTopic}”: {matchedPassages} matching passage
                {matchedPassages === 1 ? "" : "s"} from your files
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-5">
            {loading && (
              <p className="text-sm text-[var(--sample-dim)]">
                Working on your {modeLabel(mode).toLowerCase()}
                {mode !== "web" ? " and live web background" : ""}…
              </p>
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
              <div className="space-y-4">
                <article className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--sample-text)]">
                  {webSummary}
                </article>
                {webProvider && webProvider !== "none" && (
                  <p className="text-xs text-[var(--sample-dim)]">Live provider: {webProvider}</p>
                )}
              </div>
            )}
            {!loading && !hasPrimary && (
              <p className="text-sm text-[var(--sample-muted)]">
                {documents.length === 0 && mode !== "web"
                  ? "Upload PDFs on the Workspace tab first, then generate notes, definitions, or flashcards here."
                  : "Enter a topic below — e.g. “force”, “equilibrium”, or “PID controller” — and press Go."}
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
                    ? "Term to define — e.g. resultant force"
                    : mode === "flashcards"
                      ? "Topic for flashcards — e.g. control systems"
                      : mode === "web"
                        ? "Search the web — e.g. force physics"
                        : "Topic for notes — e.g. force or chapter 3 moments"
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
              {mode === "web"
                ? "Switch to Notes / Definition / Flashcards to pull file passages"
                : matchedPassages === 0
                  ? "No passages matched — try a shorter keyword or upload a better PDF"
                  : "File sources appear here after you generate notes, definitions, or flashcards"}
            </p>
          ) : (
            visibleContexts.map((ctx, idx) => (
              <IndexContextCard key={ctx.chunk_id ?? `${ctx.doc_id}-${idx}`} context={ctx} rank={idx + 1} />
            ))
          )}
        </aside>

        <aside className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-[var(--sample-text)]">From the web</p>
            {webProvider && webProvider !== "none" && (
              <span className="rounded-full bg-[var(--sample-highlight)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--sample-dim)]">
                {webProvider}
              </span>
            )}
          </div>
          {webSummary ? (
            <div className="space-y-3">
              <article className="sample-card p-4">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--sample-muted)]">
                  {webSummary}
                </p>
              </article>
              {webSources.length > 0 && (
                <ul className="space-y-2">
                  {webSources.map((src, idx) => (
                    <li key={`${src.provider}-${src.title}-${idx}`} className="sample-card-inset px-3 py-2.5">
                      <p className="text-xs font-medium text-[var(--sample-text)]">{src.title}</p>
                      <p className="mt-1 line-clamp-4 text-xs leading-relaxed text-[var(--sample-muted)]">
                        {src.snippet}
                      </p>
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--sample-dim)]">
                        {src.provider}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="sample-card-inset px-3 py-4 text-center text-xs text-[var(--sample-muted)]">
              {webError
                ? `Web search issue: ${webError}`
                : "A live background paragraph and source cards show here after you press Go"}
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
