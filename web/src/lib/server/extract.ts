import { normalizeEngineeringText } from "./normalize";

const MAX_CHARS = 500_000;

export async function extractUploadText(raw: Buffer, filename: string): Promise<string> {
  const name = (filename || "upload").toLowerCase();
  if (name.endsWith(".pdf")) {
    if (!raw.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error("File does not look like a valid PDF");
    }
    return extractPdf(raw);
  }
  const text = raw.toString("utf8").trim();
  return clip(normalizeEngineeringText(text));
}

function clip(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return text.slice(0, MAX_CHARS).trimEnd();
}

async function extractPdf(raw: Buffer): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(raw));
    const { text } = await extractText(pdf, { mergePages: true });
    const joined = Array.isArray(text) ? text.join("\n") : String(text || "");
    const cleaned = normalizeEngineeringText(joined.trim());
    if (!cleaned) {
      throw new Error("Uploaded file has no readable text");
    }
    return clip(cleaned);
  } catch (err) {
    if (err instanceof Error && err.message.includes("no readable text")) throw err;
    throw new Error(
      err instanceof Error
        ? `Could not read PDF: ${err.message}`
        : "Could not read PDF",
    );
  }
}
