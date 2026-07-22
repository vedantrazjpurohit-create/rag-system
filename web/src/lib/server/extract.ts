import { normalizeEngineeringText } from "./normalize";

const MAX_CHARS = Number(process.env.MAX_EXTRACTED_CHARS || 500_000);
const MAX_PDF_PAGES = Number(process.env.MAX_PDF_PAGES || 80);
const PDF_TIMEOUT_MS = Number(process.env.PDF_PARSE_TIMEOUT_MS || 25_000);
const MAX_PDF_BYTES = Number(process.env.MAX_PDF_BYTES || 4.5 * 1024 * 1024);

export async function extractUploadText(raw: Buffer, filename: string): Promise<string> {
  const name = (filename || "upload").toLowerCase();
  if (name.endsWith(".pdf")) {
    if (raw.length > MAX_PDF_BYTES) {
      throw new Error(
        `PDF too large (max ${Math.floor(MAX_PDF_BYTES / (1024 * 1024))}MB). Use a smaller file.`,
      );
    }
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

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function extractPdf(raw: Buffer): Promise<string> {
  try {
    const parse = async () => {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(raw));
      const pageCount =
        typeof (pdf as { numPages?: number }).numPages === "number"
          ? (pdf as { numPages: number }).numPages
          : undefined;
      if (pageCount !== undefined && pageCount > MAX_PDF_PAGES) {
        throw new Error(
          `PDF has too many pages (${pageCount}). Max allowed is ${MAX_PDF_PAGES}.`,
        );
      }
      const { text, totalPages } = await extractText(pdf, { mergePages: true });
      const pages = totalPages ?? pageCount;
      if (typeof pages === "number" && pages > MAX_PDF_PAGES) {
        throw new Error(
          `PDF has too many pages (${pages}). Max allowed is ${MAX_PDF_PAGES}.`,
        );
      }
      const joined = Array.isArray(text) ? text.join("\n") : String(text || "");
      const cleaned = normalizeEngineeringText(joined.trim());
      if (!cleaned) {
        throw new Error("Uploaded file has no readable text");
      }
      return clip(cleaned);
    };

    return await withTimeout(parse(), PDF_TIMEOUT_MS, "PDF parsing");
  } catch (err) {
    if (err instanceof Error) {
      const msg = err.message;
      if (
        msg.includes("no readable text") ||
        msg.includes("too many pages") ||
        msg.includes("timed out") ||
        msg.includes("too large")
      ) {
        throw err;
      }
      throw new Error(`Could not read PDF: ${msg}`);
    }
    throw new Error("Could not read PDF");
  }
}
