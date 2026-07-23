import { bestProseSentence, isFormulaHeavy, normalizeEngineeringText } from "./normalize";
import type { SearchHit } from "./types";

const REFUSAL =
  "No supporting context retrieved. Upload a PDF or .txt on Workspace (same browser), wait for “Added … chunks”, then ask again.";

const WEAK_MATCH =
  "No strong match for that question in your uploaded files. Try different keywords, or open a broader passage from the optional suggestions if shown.";

export function llmEnabled(): boolean {
  return Boolean(process.env.XAI_API_KEY?.trim());
}

export function llmModel(): string | null {
  return llmEnabled() ? process.env.XAI_MODEL || "grok-4.5" : null;
}

function truncate(text: string, max = 480): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

function citeSource(h: SearchHit): string {
  const page = h.page ? `, p.${h.page}` : "";
  return `${h.source || h.doc_id || "document"}${page}`;
}

function templateAnswer(hits: SearchHit[], question: string): string {
  if (!hits.length) return REFUSAL;

  const sources = [...new Set(hits.map((h) => h.source || h.doc_id))];
  // Multi-PDF: surface one short excerpt per document so answers aren't one-file-only
  if (sources.length > 1) {
    const byDoc = new Map<string, SearchHit>();
    for (const h of hits) {
      const key = h.doc_id || h.source;
      if (!byDoc.has(key)) byDoc.set(key, h);
    }
    const lines = [...byDoc.values()].slice(0, 6).map((h) => {
      const body = truncate(normalizeEngineeringText(h.text), 220);
      return `From [${citeSource(h)}]: ${body}`;
    });
    return lines.join("\n\n");
  }

  const body = truncate(normalizeEngineeringText(hits[0].text));
  const source = citeSource(hits[0]);
  const define = question.match(/(?:what is|what's|define|explain)\s+(.+?)\??$/i);
  const term = define?.[1]?.trim();

  if (term) {
    const prose = bestProseSentence(body, term);
    if (prose) return `${prose} [${source}]`;
    if (isFormulaHeavy(body)) {
      return `I found material about “${term}” in ${source}, but the PDF text didn't extract cleanly. Try re-uploading or ask in plain words.`;
    }
    return `${term[0].toUpperCase()}${term.slice(1)} (from ${source}): ${body}`;
  }
  if (isFormulaHeavy(body)) {
    return `Retrieved formulas from ${source}, but plain-language text didn't extract cleanly.`;
  }
  return `From [${source}]: ${body}`;
}

async function chatCompletion(system: string, user: string, maxTokens = 400): Promise<string | null> {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) return null;
  const base = process.env.XAI_BASE_URL || "https://api.x.ai/v1";
  const model = process.env.XAI_MODEL || "grok-4.5";
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    return content ? normalizeEngineeringText(content) : null;
  } catch {
    return null;
  }
}

export async function generateAnswer(
  question: string,
  hits: SearchHit[],
  options?: { weakMatch?: boolean; hasCorpus?: boolean },
): Promise<{ answer: string; mode: string }> {
  if (!hits.length) {
    if (options?.weakMatch && options?.hasCorpus) {
      return { answer: WEAK_MATCH, mode: "template" };
    }
    return { answer: REFUSAL, mode: "template" };
  }

  if (llmEnabled()) {
    const sourceCount = new Set(hits.map((h) => h.doc_id || h.source)).size;
    const snippets = hits.slice(0, 12).map((h, i) => {
      const text = normalizeEngineeringText(h.text).replace(/\s+/g, " ").slice(0, 400);
      const page = h.page ? ` page=${h.page}` : "";
      return `[${i + 1}] source=${h.source}${page} doc_id=${h.doc_id}\n<<<CONTEXT>>>\n${text}\n<<<END CONTEXT>>>`;
    });
    const multiHint =
      sourceCount > 1
        ? " Snippets come from MULTIPLE PDFs — synthesize across them and cite each source by filename (and page when given). Do not answer from only one file if others are relevant."
        : "";
    const system =
      "You are a careful RAG assistant. Answer ONLY using the snippets. Cite like [1] or by source filename. " +
      "If context is insufficient, say you cannot answer from the documents. " +
      "Rewrite garbled PDF formulas in plain engineering notation." +
      multiHint;
    const user = `Question:\n${question}\n\nSnippets (${sourceCount} document(s)):\n${snippets.join("\n\n")}`;
    const answer = await chatCompletion(system, user, sourceCount > 1 ? 600 : 400);
    if (answer) return { answer, mode: "llm" };
  }

  return { answer: templateAnswer(hits, question), mode: "template" };
}

export async function generateStudyNotes(topic: string, hits: SearchHit[]): Promise<string> {
  if (!hits.length) {
    return `No notes for “${topic}”. Upload PDFs that cover this topic, then try again.`;
  }
  if (llmEnabled()) {
    const snippets = hits.slice(0, 6).map((h, i) => `[${i + 1}] ${h.source}: ${h.text.slice(0, 400)}`);
    const answer = await chatCompletion(
      "Write clear study notes from the snippets only. Short headings and bullets. Cite [1].",
      `Topic: ${topic}\n\n${snippets.join("\n")}`,
      800,
    );
    if (answer) return answer;
  }
  const lines = [`Study notes: ${topic}`, "", "Key passages", "------------"];
  hits.slice(0, 6).forEach((h, i) => {
    const text = truncate(normalizeEngineeringText(h.text), 360);
    lines.push("", `${i + 1}. From ${h.source}`, `   ${text}`);
  });
  return lines.join("\n");
}

export async function generateDefinition(term: string, hits: SearchHit[]): Promise<string> {
  if (!hits.length) {
    return `No definition for “${term}” was found in your uploaded files.`;
  }
  if (llmEnabled()) {
    const snippets = hits.slice(0, 4).map((h, i) => `[${i + 1}] ${h.source}: ${h.text.slice(0, 400)}`);
    const answer = await chatCompletion(
      "Define the term in one tight paragraph using only the snippets. Cite [1].",
      `Define: ${term}\n\n${snippets.join("\n")}`,
      350,
    );
    if (answer) return answer;
  }
  for (const h of hits) {
    const prose = bestProseSentence(normalizeEngineeringText(h.text), term);
    if (prose) return `${term}: ${prose} (from ${h.source})`;
  }
  return `${term}: ${truncate(hits[0].text, 420)} (from ${hits[0].source})`;
}

export async function generateWebSummary(query: string, snippets: string[]): Promise<string> {
  if (!snippets.length) {
    return `No live web background was found for “${query}”. Try a broader term.`;
  }
  if (llmEnabled()) {
    const answer = await chatCompletion(
      "Summarize background for a student in one paragraph (5–8 sentences). No URLs.",
      `Query: ${query}\n\nSnippets:\n${snippets.map((s) => `- ${s}`).join("\n")}`,
      500,
    );
    if (answer) return answer.replace(/https?:\/\/\S+|www\.\S+/gi, "").replace(/\s+/g, " ").trim();
  }
  return snippets.slice(0, 3).join(" ").slice(0, 1200);
}
