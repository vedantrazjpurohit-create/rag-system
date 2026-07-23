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

function citeLabel(h: SearchHit): string {
  const name = h.source || h.doc_id || "document";
  if (h.page != null) return `${name} — Page ${h.page}`;
  return name;
}

/** Build a de-duplicated Sources block for every answer. */
export function formatSourcesSection(hits: SearchHit[]): string {
  if (!hits.length) return "## Sources\n\n- No document sources available.";

  // Group pages by document name for "Pages 236–237" style when possible
  const byDoc = new Map<string, Set<number>>();
  const noPage = new Set<string>();

  for (const h of hits) {
    const name = h.source || h.doc_id || "document";
    if (h.page != null && Number.isFinite(h.page)) {
      const set = byDoc.get(name) || new Set<number>();
      set.add(h.page);
      byDoc.set(name, set);
    } else {
      noPage.add(name);
    }
  }

  const lines: string[] = [];
  for (const [name, pages] of [...byDoc.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sorted = [...pages].sort((a, b) => a - b);
    if (sorted.length === 1) {
      lines.push(`- ${name} — Page ${sorted[0]}`);
    } else if (sorted.length === 2 && sorted[1] === sorted[0] + 1) {
      lines.push(`- ${name} — Pages ${sorted[0]}–${sorted[1]}`);
    } else {
      lines.push(`- ${name} — Pages ${sorted.join(", ")}`);
    }
  }
  for (const name of [...noPage].sort()) {
    if (!byDoc.has(name)) lines.push(`- ${name}`);
  }

  return `## Sources\n\n${lines.join("\n")}`;
}

/**
 * Ensure the model output ends with a correct Sources section derived from hits
 * (so citations stay accurate even if the model omits or invents them).
 */
export function ensureSourcesSection(answer: string, hits: SearchHit[]): string {
  const body = answer.replace(/\n*##\s*Sources[\s\S]*$/i, "").trimEnd();
  return `${body}\n\n${formatSourcesSection(hits)}`.trim();
}

function tutorSystemPrompt(sourceCount: number): string {
  const multi =
    sourceCount > 1
      ? `
MULTI-DOCUMENT MODE: Context comes from ${sourceCount} different PDFs. Synthesize into ONE coherent explanation.
Do not answer from a single file if others are relevant. Weave ideas together and note when sources agree or differ.`
      : "";

  return `You are an expert tutor for university students. You teach from the student's uploaded course materials only.

GROUNDING RULES (strict):
- Use ONLY facts supported by the provided context snippets.
- Do NOT invent formulas, definitions, numbers, or claims not present in the context.
- If the context is incomplete for a full answer, say what is missing and answer only what you can support.
- Prefer short quotations only when a precise definition or formula must be preserved; otherwise paraphrase in your own words.
- Rewrite garbled PDF symbol text into clean engineering/math notation.

TEACHING STYLE:
- First understand the question and the context, then explain like a clear, intelligent tutor.
- Do not dump or lightly rephrase retrieved text. Summarize and teach.
- Add helpful framing when the context supports it: why it matters, pros/cons, how concepts relate, simple intuition for students.
- Be concise but complete. Use short paragraphs, headings, and bullets.
- Sound natural (like ChatGPT/Claude), not like a search result list.

REQUIRED OUTPUT FORMAT (markdown, always use these sections):

## Answer

A clear, well-structured explanation in your own words (2–6 short paragraphs as needed).

## Key Points

- 3–6 bullet points with the essentials a student should remember

## Sources

- Exactly list the document filenames (and page numbers when given in the context metadata). One bullet per document or page range.
- Do not invent page numbers. If a page is unknown, list the filename only.
${multi}`;
}

function buildContextBlock(hits: SearchHit[]): string {
  return hits
    .slice(0, 12)
    .map((h, i) => {
      const text = normalizeEngineeringText(h.text).replace(/\s+/g, " ").slice(0, 500);
      const page = h.page != null ? ` | page=${h.page}` : "";
      return (
        `[${i + 1}] filename="${h.source || "document"}"${page} | doc_id=${h.doc_id}\n` +
        `<<<CONTEXT>>>\n${text}\n<<<END CONTEXT>>>`
      );
    })
    .join("\n\n");
}

function templateAnswer(hits: SearchHit[], question: string): string {
  if (!hits.length) return REFUSAL;

  const sources = [...new Set(hits.map((h) => h.source || h.doc_id))];
  const define = question.match(/(?:what is|what's|define|explain)\s+(.+?)\??$/i);
  const term = define?.[1]?.trim();

  let answerBody = "";
  let keyPoints: string[] = [];

  if (sources.length > 1) {
    const byDoc = new Map<string, SearchHit>();
    for (const h of hits) {
      const key = h.doc_id || h.source;
      if (!byDoc.has(key)) byDoc.set(key, h);
    }
    const pieces = [...byDoc.values()].slice(0, 5).map((h) => {
      const prose =
        bestProseSentence(normalizeEngineeringText(h.text), term || null) ||
        truncate(normalizeEngineeringText(h.text), 280);
      return prose;
    });
    answerBody =
      `Based on your uploaded materials, here is a combined take:\n\n` +
      pieces.map((p, i) => `${i + 1}. ${p}`).join("\n\n") +
      `\n\nThese points come from different PDFs in your library. For a fuller tutor-style explanation, enable Grok (XAI_API_KEY) on the server.`;
    keyPoints = pieces.slice(0, 4).map((p) => truncate(p, 140));
  } else {
    const body = normalizeEngineeringText(hits[0].text);
    const prose =
      bestProseSentence(body, term || null) || truncate(body, 420);
    if (isFormulaHeavy(body) && !bestProseSentence(body, term || null)) {
      answerBody = `Your notes contain relevant material in **${citeLabel(hits[0])}**, but formulas did not extract cleanly as plain text. Re-upload a clearer PDF or enable the LLM for a better rewrite.`;
      keyPoints = ["Formula text may be garbled in the PDF extract.", `See source: ${citeLabel(hits[0])}`];
    } else if (term) {
      answerBody = `**${term[0].toUpperCase()}${term.slice(1)}**\n\n${prose}\n\nThis is drawn from your notes. With Grok enabled, answers will be fuller tutor-style explanations rather than short extracts.`;
      keyPoints = [truncate(prose, 160)];
    } else {
      answerBody = `${prose}\n\nThis is the best matching passage from your notes. Enable Grok (XAI_API_KEY) for richer explanations.`;
      keyPoints = [truncate(prose, 160)];
    }
  }

  const bullets = keyPoints.map((k) => `- ${k}`).join("\n");
  return [
    "## Answer",
    "",
    answerBody.trim(),
    "",
    "## Key Points",
    "",
    bullets || "- See the answer above.",
    "",
    formatSourcesSection(hits),
  ].join("\n");
}

async function chatCompletion(
  system: string,
  user: string,
  maxTokens = 900,
  temperature = 0.35,
): Promise<string | null> {
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
        temperature,
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
    // Do not aggressively normalize the whole markdown answer (would smash structure).
    return content || null;
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
    const system = tutorSystemPrompt(sourceCount);
    const user = [
      `Student question:\n${question}`,
      "",
      `You have ${hits.length} context snippet(s) from ${sourceCount} document(s).`,
      "Read them carefully, then teach the answer in the required format.",
      "Do not concatenate snippets. Write an original explanation grounded only in this context.",
      "",
      buildContextBlock(hits),
    ].join("\n");

    const raw = await chatCompletion(system, user, sourceCount > 1 ? 1100 : 900, 0.35);
    if (raw) {
      // Light cleanup only — keep markdown structure
      const cleaned = raw.replace(/\r\n/g, "\n").trim();
      return { answer: ensureSourcesSection(cleaned, hits), mode: "llm" };
    }
  }

  return { answer: templateAnswer(hits, question), mode: "template" };
}

export async function generateStudyNotes(topic: string, hits: SearchHit[]): Promise<string> {
  if (!hits.length) {
    return `No notes for “${topic}”. Upload PDFs that cover this topic, then try again.`;
  }
  if (llmEnabled()) {
    const system = `You are a study-notes tutor. Using ONLY the context, write clear student notes in your own words.
Use markdown with short headings and bullets. Do not copy long passages.
End with a ## Sources section listing filenames and pages when known.`;
    const user = `Topic: ${topic}\n\n${buildContextBlock(hits)}`;
    const answer = await chatCompletion(system, user, 1000, 0.3);
    if (answer) return ensureSourcesSection(answer, hits);
  }
  const lines = [
    `## Answer`,
    "",
    `Study notes on **${topic}** (extract mode — enable Grok for richer tutoring).`,
    "",
    `## Key Points`,
    "",
  ];
  hits.slice(0, 6).forEach((h) => {
    const text = truncate(normalizeEngineeringText(h.text), 200);
    lines.push(`- ${text}`);
  });
  lines.push("", formatSourcesSection(hits));
  return lines.join("\n");
}

export async function generateDefinition(term: string, hits: SearchHit[]): Promise<string> {
  if (!hits.length) {
    return `No definition for “${term}” was found in your uploaded files.`;
  }
  if (llmEnabled()) {
    const system = `You are a patient tutor. Define the term using ONLY the context, in plain student-friendly language.
Explain intuition and why it matters when the context allows. Do not invent details.
Use this structure:

## Answer
## Key Points
## Sources`;
    const user = `Define: ${term}\n\n${buildContextBlock(hits)}`;
    const answer = await chatCompletion(system, user, 700, 0.3);
    if (answer) return ensureSourcesSection(answer, hits);
  }
  for (const h of hits) {
    const prose = bestProseSentence(normalizeEngineeringText(h.text), term);
    if (prose) {
      return [
        "## Answer",
        "",
        `**${term}**\n\n${prose}`,
        "",
        "## Key Points",
        "",
        `- ${truncate(prose, 160)}`,
        "",
        formatSourcesSection(hits),
      ].join("\n");
    }
  }
  return [
    "## Answer",
    "",
    `**${term}**\n\n${truncate(hits[0].text, 420)}`,
    "",
    "## Key Points",
    "",
    `- See definition above from your notes.`,
    "",
    formatSourcesSection(hits),
  ].join("\n");
}

export async function generateWebSummary(query: string, snippets: string[]): Promise<string> {
  if (!snippets.length) {
    return `No live web background was found for “${query}”. Try a broader term.`;
  }
  if (llmEnabled()) {
    const answer = await chatCompletion(
      "You are a tutor. Write a clear educational background paragraph (5–8 sentences) for a student. Use only the research snippets. No URLs. Paraphrase; do not paste snippets.",
      `Query: ${query}\n\nResearch snippets:\n${snippets.map((s) => `- ${s}`).join("\n")}`,
      600,
      0.35,
    );
    if (answer) return answer.replace(/https?:\/\/\S+|www\.\S+/gi, "").replace(/\s+/g, " ").trim();
  }
  return snippets.slice(0, 3).join(" ").slice(0, 1200);
}
