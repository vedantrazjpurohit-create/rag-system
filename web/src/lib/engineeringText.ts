const ORIYA_TO_LATIN: Record<string, string> = {
  "\u0b05": "a",
  "\u0b06": "a",
  "\u0b07": "i",
  "\u0b08": "i",
  "\u0b09": "u",
  "\u0b0a": "u",
  "\u0b0b": "r",
  "\u0b0c": "l",
  "\u0b0f": "e",
  "\u0b10": "e",
  "\u0b13": "o",
  "\u0b14": "o",
  "\u0b15": "k",
  "\u0b16": "k",
  "\u0b17": "g",
  "\u0b18": "g",
  "\u0b19": "n",
  "\u0b1a": "c",
  "\u0b1b": "c",
  "\u0b1c": "j",
  "\u0b1d": "j",
  "\u0b1e": "n",
  "\u0b1f": "t",
  "\u0b20": "t",
  "\u0b21": "d",
  "\u0b22": "d",
  "\u0b23": "n",
  "\u0b24": "t",
  "\u0b25": "t",
  "\u0b26": "d",
  "\u0b27": "d",
  "\u0b28": "n",
  "\u0b2a": "p",
  "\u0b2b": "f",
  "\u0b2c": "b",
  "\u0b2d": "b",
  "\u0b2e": "m",
  "\u0b2f": "y",
  "\u0b30": "r",
  "\u0b32": "l",
  "\u0b33": "l",
  "\u0b35": "v",
  "\u0b36": "s",
  "\u0b37": "s",
  "\u0b38": "s",
  "\u0b39": "h",
  "\u0b3e": "a",
  "\u0b3f": "i",
  "\u0b40": "i",
  "\u0b41": "u",
  "\u0b42": "u",
  "\u0b47": "e",
  "\u0b48": "e",
  "\u0b4b": "o",
  "\u0b4c": "o",
  "\u0b4d": "",
  "\u0b45": "A",
  "\u0b46": "A",
  "\u0b49": "E",
  "\u0b4a": "O",
  "\u0b54": "F",
  "\u0b55": "B",
  "\u0b56": "R",
  "\u0b57": "",
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
    const code = char.charCodeAt(0);
    const mapped = ORIYA_TO_LATIN[char];
    if (mapped !== undefined) {
      if (mapped) out += mapped;
    } else if (code >= 0x0b00 && code <= 0x0b7f) {
      // drop unmapped Oriya symbol-font bytes
    }
  }
  return orderSubscript(out);
}

/** Fix PDF symbol-font garbage (Indic mis-encodings) for display. */
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