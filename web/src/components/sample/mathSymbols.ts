const LATEX_TO_SYMBOL: [string, string][] = [
  ["\\forall", "∀"],
  ["\\exists", "∃"],
  ["\\lambda", "λ"],
  ["\\mu", "μ"],
  ["\\sigma", "σ"],
  ["\\pi", "π"],
  ["\\theta", "θ"],
  ["\\phi", "φ"],
  ["\\omega", "ω"],
  ["\\Delta", "Δ"],
  ["\\Sigma", "Σ"],
  ["\\sum", "∑"],
  ["\\int", "∫"],
  ["\\partial", "∂"],
  ["\\infty", "∞"],
  ["\\leq", "≤"],
  ["\\geq", "≥"],
  ["\\neq", "≠"],
  ["\\approx", "≈"],
  ["\\cdot", "·"],
  ["\\times", "×"],
  ["\\pm", "±"],
  ["\\rightarrow", "→"],
  ["\\leftarrow", "←"],
  ["\\Rightarrow", "⇒"],
  ["\\in", "∈"],
  ["\\subset", "⊂"],
  ["\\cup", "∪"],
  ["\\cap", "∩"],
  ["\\;", " "],
  ["\\,", " "],
  ["\\quad", "  "],
  ["\\qquad", "    "],
];

export function latexToSymbolString(latex: string): string {
  let out = latex;
  for (const [command, symbol] of LATEX_TO_SYMBOL) {
    out = out.split(command).join(symbol);
  }
  // Drop any leftover LaTeX commands — never show command names in the UI.
  out = out.replace(/\\[a-zA-Z]+/g, "");
  out = out.replace(/\\./g, "");
  return out.replace(/\s{2,}/g, " ").trim();
}

export function splitSubscripts(expression: string): Array<{ type: "text" | "sub"; value: string }> {
  const tokens: Array<{ type: "text" | "sub"; value: string }> = [];
  const regex = /_\{([^}]+)\}|_\s*([a-zA-Z0-9])/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(expression)) !== null) {
    if (match.index > last) {
      tokens.push({ type: "text", value: expression.slice(last, match.index) });
    }
    tokens.push({ type: "sub", value: match[1] ?? match[2] });
    last = regex.lastIndex;
  }

  if (last < expression.length) {
    tokens.push({ type: "text", value: expression.slice(last) });
  }

  return tokens.length ? tokens : [{ type: "text", value: expression }];
}