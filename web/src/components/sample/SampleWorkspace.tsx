"use client";

import { useEffect, useMemo, useState } from "react";

import { FormulaDisplay } from "./FormulaDisplay";
import { SampleUpload } from "./SampleUpload";
import {
  ASK_PLACEHOLDER,
  buildMockReply,
  filterCitationsByLibrary,
  filterReplyByLibrary,
  type Citation,
  type MockChapter,
  type MockDefinition,
  type MockDocument,
  type MockFormula,
  type QueryMode,
} from "./mockData";

type Message = {
  role: "user" | "assistant";
  text: string;
  citationIds?: number[];
  citations?: Citation[];
  intent?: Exclude<QueryMode, "compare">;
  ms?: number;
  definition?: MockDefinition;
  formulas?: MockFormula[];
  chapters?: MockChapter[];
};

interface SampleWorkspaceProps {
  documents: MockDocument[];
  onAddFiles: (files: FileList) => void;
  onRemoveDocument: (id: string) => void;
}

export function SampleWorkspace({ documents, onAddFiles, onRemoveDocument }: SampleWorkspaceProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Hey — upload your PDFs on the left, then just ask. Something like “what is resultant force-couple?” or “summarize chapter 3” works fine.",
    },
  ]);
  const [activeCitation, setActiveCitation] = useState<number | null>(null);
  const [pending, setPending] = useState(false);

  const visibleCitations = useMemo(() => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && m.citations?.length);
    if (!lastAssistant?.citations) return [];
    return filterCitationsByLibrary(lastAssistant.citations, documents);
  }, [messages, documents]);

  const indexedCount = documents.filter((d) => d.status === "indexed").length;

  useEffect(() => {
    if (activeCitation !== null && !visibleCitations.some((c) => c.id === activeCitation)) {
      setActiveCitation(null);
    }
  }, [activeCitation, visibleCitations]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || pending) return;

    const reply = buildMockReply(question, documents);
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setInput("");
    setPending(true);

    window.setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: reply.answer,
          citationIds: reply.citationIds,
          citations: reply.citations,
          intent: reply.intent,
          definition: reply.definition,
          formulas: reply.formulas,
          chapters: reply.chapters,
          ms: 0.2 + Math.random() * 0.25,
        },
      ]);
      setPending(false);
    }, 520);
  }

  return (
    <div className="sample-fade-in grid gap-4 lg:grid-cols-[240px_1fr_250px]">
      <aside className="space-y-4">
        <SampleUpload documents={documents} onAdd={onAddFiles} />

        <Panel title="Your files" count={documents.length}>
          <p className="mb-2 text-xs text-[var(--sample-dim)]">
            {indexedCount} ready to search
          </p>
          <ul className="max-h-[280px] space-y-2 overflow-y-auto">
            {documents.length === 0 ? (
              <li className="sample-card-inset px-3 py-4 text-center text-xs text-[var(--sample-muted)]">
                Nothing uploaded yet
              </li>
            ) : (
              documents.map((doc) => (
                <li key={doc.id} className="sample-card-inset px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm text-[var(--sample-text)]">{doc.name}</p>
                    <button
                      type="button"
                      onClick={() => onRemoveDocument(doc.id)}
                      aria-label={`Remove ${doc.name}`}
                      className="sample-btn sample-btn-ghost shrink-0 text-xs"
                    >
                      Remove
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-[var(--sample-dim)]">
                    {doc.pages} pages · {doc.status === "indexed" ? "ready" : "still reading…"}
                  </p>
                </li>
              ))
            )}
          </ul>
        </Panel>
      </aside>

      <section className="sample-card flex min-h-[560px] flex-col overflow-hidden">
        <div className="border-b border-[var(--sample-border)] px-4 py-3">
          <p className="text-sm text-[var(--sample-muted)]">
            {documents.length === 0
              ? "Add a PDF first, then ask anything."
              : `Searching across ${documents.length} file${documents.length === 1 ? "" : "s"}`}
          </p>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
          {messages.map((msg, idx) => {
            const filtered =
              msg.role === "assistant" ? filterMessageByLibrary(msg, documents) : msg;

            return (
              <div
                key={idx}
                className={msg.role === "user" ? "sample-bubble-user" : "sample-bubble-assistant"}
              >
                {filtered.role === "assistant" && filtered.citationIds?.length ? (
                  <AnswerWithCitations
                    text={filtered.text}
                    citationIds={filtered.citationIds}
                    activeId={activeCitation}
                    onSelect={setActiveCitation}
                  />
                ) : (
                  filtered.text
                )}

                {filtered.role === "assistant" && filtered.definition && (
                  <DefinitionList definition={filtered.definition} onSelectCitation={setActiveCitation} />
                )}
                {filtered.role === "assistant" && filtered.formulas?.length ? (
                  <FormulasList formulas={filtered.formulas} onSelectCitation={setActiveCitation} />
                ) : null}
                {filtered.role === "assistant" && filtered.chapters?.length ? (
                  <ChapterList chapters={filtered.chapters} />
                ) : null}
              </div>
            );
          })}
          {pending && (
            <p className="text-sm text-[var(--sample-dim)]">Looking through your notes…</p>
          )}
        </div>

        <form className="border-t border-[var(--sample-border)] p-4" onSubmit={handleSubmit}>
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={ASK_PLACEHOLDER}
              className="sample-input min-w-0 flex-1"
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              className="sample-btn sample-btn-primary shrink-0"
            >
              Ask
            </button>
          </div>
        </form>
      </section>

      <aside className="space-y-3">
        <p className="text-sm font-medium text-[var(--sample-text)]">Where it came from</p>
        {visibleCitations.length === 0 ? (
          <p className="sample-card-inset px-3 py-4 text-center text-xs text-[var(--sample-muted)]">
            Sources show up after you ask something
          </p>
        ) : null}
        {visibleCitations.map((src) => (
          <article
            key={src.id}
            id={`citation-${src.id}`}
            onClick={() => setActiveCitation(src.id)}
            className={`sample-card cursor-pointer p-3 transition ${
              activeCitation === src.id ? "ring-2 ring-[var(--sample-border-strong)]" : ""
            }`}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[var(--sample-accent)]">[{src.id}]</span>
              <span className="truncate text-xs text-[var(--sample-dim)]">{src.doc}</span>
            </div>
            <p className="text-xs text-[var(--sample-muted)]">
              {src.chapter} · {src.page}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--sample-muted)]">{src.excerpt}</p>
          </article>
        ))}
      </aside>
    </div>
  );
}

function filterMessageByLibrary(message: Message, documents: MockDocument[]): Message {
  if (message.role !== "assistant") return message;
  const filtered = filterReplyByLibrary(
    {
      intent: message.intent ?? "search",
      answer: message.text,
      citationIds: message.citationIds ?? [],
      citations: message.citations ?? [],
      definition: message.definition,
      formulas: message.formulas,
      chapters: message.chapters,
    },
    documents,
  );
  return {
    ...message,
    citationIds: filtered.citationIds,
    citations: filtered.citations,
    definition: filtered.definition,
    formulas: filtered.formulas,
    chapters: filtered.chapters,
  };
}

function AnswerWithCitations({
  text,
  citationIds,
  activeId,
  onSelect,
}: {
  text: string;
  citationIds: number[];
  activeId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <span>
      {text}
      <span className="ml-1 inline-flex gap-0.5">
        {citationIds.map((id) => (
          <CitationButton key={id} id={id} activeId={activeId} onSelect={onSelect} />
        ))}
      </span>
    </span>
  );
}

function CitationButton({
  id,
  activeId,
  onSelect,
}: {
  id: number;
  activeId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onSelect(id);
        document.getElementById(`citation-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }}
      className={`text-xs align-super transition ${
        activeId === id
          ? "font-medium text-[var(--sample-accent)] underline"
          : "text-[var(--sample-dim)] hover:text-[var(--sample-accent)]"
      }`}
    >
      [{id}]
    </button>
  );
}

function DefinitionList({
  definition,
  onSelectCitation,
}: {
  definition: MockDefinition;
  onSelectCitation: (id: number) => void;
}) {
  return (
    <div className="sample-card-inset mt-4 p-3">
      <p className="text-xs text-[var(--sample-dim)]">Definition</p>
      <p className="mt-1 text-sm font-medium text-[var(--sample-text)]">{definition.term}</p>
      <p className="mt-2 text-sm leading-relaxed text-[var(--sample-muted)]">{definition.definition}</p>
      <div className="mt-2 text-xs text-[var(--sample-dim)]">
        See{" "}
        {definition.citations.map((id) => (
          <CitationButton key={id} id={id} activeId={null} onSelect={onSelectCitation} />
        ))}
      </div>
    </div>
  );
}

function FormulasList({
  formulas,
  onSelectCitation,
}: {
  formulas: MockFormula[];
  onSelectCitation: (id: number) => void;
}) {
  return (
    <ul className="mt-4 space-y-2">
      {formulas.map((f) => (
        <li key={f.label} className="sample-card-inset p-3">
          <p className="text-xs text-[var(--sample-dim)]">{f.label}</p>
          <div className="mt-1">
            <FormulaDisplay latex={f.latex} />
          </div>
          <div className="mt-2 text-xs text-[var(--sample-dim)]">
            <CitationButton id={f.citation} activeId={null} onSelect={onSelectCitation} /> {f.doc} · {f.page}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ChapterList({ chapters }: { chapters: MockChapter[] }) {
  return (
    <ul className="mt-4 space-y-2">
      {chapters.map((ch) => (
        <li key={ch.chapter} className="sample-card-inset p-3">
          <p className="text-xs text-[var(--sample-dim)]">{ch.doc}</p>
          <p className="mt-1 text-sm font-medium text-[var(--sample-text)]">{ch.chapter}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--sample-muted)]">{ch.summary}</p>
        </li>
      ))}
    </ul>
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
        {count !== undefined && (
          <span className="text-xs text-[var(--sample-dim)]">{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}