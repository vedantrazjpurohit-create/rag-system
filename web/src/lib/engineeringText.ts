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
  "\u0b4a": "O",
  "\u0b54": "F",
  "\u0b55": "B",
  "\u0b56": "R",
  "\u0b76": "",
};

const LATIN_ORIYA = /([A-Za-z])\s*((?:[\u0b00-\u0b7f]+\s*)+)([A-Za-z]{0,4})?/g;
const ORIYA_BLOCK = /[\u0b00-\u0b7f]+/g;
const COMBINING_NOISE = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\ufe20-\ufe2f]+/g;

function decodeOriyaRun(run: string): string {
  let out = "";
  for (const char of run) {
    const mapped = ORIYA_TO_LATIN[char];
    if (mapped) out += mapped;
  }
  return out;
}

/** Fix PDF symbol-font garbage (Oriya mis-encodings) for display. */
export function normalizeEngineeringText(text: string): string {
  if (!text) return text;

  let cleaned = text.replace(COMBINING_NOISE, "");
  cleaned = cleaned.replace(LATIN_ORIYA, (_, base: string, oriya: string, suffix = "") => {
    const compact = oriya.replace(/\s+/g, "");
    const sub = decodeOriyaRun(compact) + suffix;
    return sub ? `${base}_${sub}` : base;
  });
  cleaned = cleaned.replace(ORIYA_BLOCK, "");
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  return cleaned;
}

export type TextToken = { type: "text" | "sub"; value: string };

/** Split M_OA style notation into renderable subscript tokens. */
export function tokenizeSubscripts(text: string): TextToken[] {
  const normalized = normalizeEngineeringText(text);
  const tokens: TextToken[] = [];
  const regex = /([A-Za-z])_([A-Za-z0-9]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(normalized)) !== null) {
    if (match.index > last) {
      tokens.push({ type: "text", value: normalized.slice(last, match.index) });
    }
    tokens.push({ type: "text", value: match[1] });
    tokens.push({ type: "sub", value: match[2] });
    last = regex.lastIndex;
  }

  if (last < normalized.length) {
    tokens.push({ type: "text", value: normalized.slice(last) });
  }

  return tokens.length ? tokens : [{ type: "text", value: normalized }];
}