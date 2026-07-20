const ORIYA_TO_LATIN: Record<string, string> = {
  "\u0b05": "a",
  "\u0b06": "a",
  "\u0b07": "i",
  "\u0b08": "i",
  "\u0b09": "u",
  "\u0b0a": "u",
  "\u0b0f": "e",
  "\u0b13": "o",
  "\u0b2a": "p",
  "\u0b2b": "f",
  "\u0b2c": "b",
  "\u0b2e": "m",
  "\u0b30": "r",
  "\u0b45": "A",
  "\u0b46": "A",
  "\u0b4a": "O",
  "\u0b54": "F",
  "\u0b55": "B",
  "\u0b56": "R",
  "\u0b76": "",
};

const LATIN_ORIYA = /([A-Za-z])\s*((?:[\u0b00-\u0b7f]+\s*)+)([A-Za-z]{0,4})?/g;
const INDIC_GARBAGE = /[\u0b00-\u0b7f\u0900-\u097f\u0c00-\u0c7f\u0c80-\u0cff]+/g;
const COMBINING_NOISE = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\ufe20-\ufe2f]+/g;

function orderSubscript(sub: string): string {
  const letters = sub.replace(/[^A-Za-z]/g, "");
  if (letters.includes("O") && letters.includes("A") && letters.length <= 4) {
    const rest = letters.replace(/[OA]/g, "");
    return `OA${rest}`;
  }
  return sub;
}

function decodeOriyaRun(run: string): string {
  let out = "";
  for (const char of run) {
    const mapped = ORIYA_TO_LATIN[char];
    if (mapped) out += mapped;
  }
  return orderSubscript(out);
}

export function normalizeEngineeringText(text: string): string {
  if (!text) return text;
  let cleaned = text.replace(COMBINING_NOISE, "");
  cleaned = cleaned.replace(LATIN_ORIYA, (_, base: string, oriya: string, suffix = "") => {
    const compact = oriya.replace(/\s+/g, "");
    const sub = decodeOriyaRun(compact) + suffix;
    return sub ? `${base}_${sub}` : base;
  });
  cleaned = cleaned.replace(INDIC_GARBAGE, "");
  cleaned = cleaned.replace(/∑/g, "∑ ");
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  return cleaned;
}

export function proseRatio(text: string): number {
  if (!text) return 0;
  let good = 0;
  for (const c of text) {
    if (/[A-Za-z0-9\s.,;:\-()[\]]/.test(c)) good += 1;
  }
  return good / text.length;
}

export function isFormulaHeavy(text: string): boolean {
  if (!text) return false;
  if (INDIC_GARBAGE.test(text)) return true;
  const words = text.match(/[A-Za-z]{3,}/g) || [];
  const content = words.filter(
    (w) => !["sum", "the", "and", "for", "from", "with", "that", "this"].includes(w.toLowerCase()),
  );
  if (content.length >= 4 && proseRatio(text) >= 0.7) return false;
  if (text.includes("∑") || (text.match(/_/g) || []).length >= 2) return true;
  return false;
}

export function bestProseSentence(text: string, term?: string | null): string | null {
  const parts = text.split(/(?<=[.!?])\s+|\n+/);
  const candidates: string[] = [];
  for (const part of parts) {
    const line = part.trim();
    if (line.length < 28) continue;
    if (INDIC_GARBAGE.test(line)) continue;
    if (proseRatio(line) < 0.72) continue;
    if (isFormulaHeavy(line)) continue;
    candidates.push(line);
  }
  if (!candidates.length) return null;
  const termL = (term || "").toLowerCase().trim();
  if (termL) {
    const hit = candidates.find((c) => c.toLowerCase().includes(termL));
    if (hit) return hit;
  }
  return candidates[0];
}
