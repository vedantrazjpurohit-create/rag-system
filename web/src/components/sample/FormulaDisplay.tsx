"use client";

import { latexToSymbolString, splitSubscripts } from "./mathSymbols";

interface FormulaDisplayProps {
  latex: string;
}

export function FormulaDisplay({ latex }: FormulaDisplayProps) {
  const symbolsOnly = latexToSymbolString(latex);
  const tokens = splitSubscripts(symbolsOnly);

  return (
    <span
      className="text-[15px] tracking-wide text-[var(--sample-text)]"
      style={{ fontFamily: "Cambria Math, STIX Two Math, Latin Modern Math, serif" }}
    >
      {tokens.map((token, idx) =>
        token.type === "sub" ? (
          <sub key={idx}>{token.value}</sub>
        ) : (
          <span key={idx}>{token.value}</span>
        ),
      )}
    </span>
  );
}