import { normalizeEngineeringText, tokenizeSubscripts } from "@/lib/engineeringText";

interface EngineeringTextProps {
  text: string;
  className?: string;
}

export function EngineeringText({ text, className }: EngineeringTextProps) {
  const tokens = tokenizeSubscripts(text);

  return (
    <span className={className}>
      {tokens.map((token, idx) =>
        token.type === "sub" ? (
          <sub key={idx} className="text-[0.85em]">
            {token.value}
          </sub>
        ) : (
          <span key={idx}>{token.value}</span>
        ),
      )}
    </span>
  );
}

export function normalizeForDisplay(text: string): string {
  return normalizeEngineeringText(text);
}