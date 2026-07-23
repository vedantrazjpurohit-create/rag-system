import { normalizeEngineeringText } from "./normalize";

const MAX_CHARS = Number(process.env.MAX_EXTRACTED_CHARS || 500_000);
const MAX_PDF_PAGES = Number(process.env.MAX_PDF_PAGES || 80);
const MAX_OCR_PAGES = Number(process.env.MAX_OCR_PAGES || 12);
const PDF_TIMEOUT_MS = Number(process.env.PDF_PARSE_TIMEOUT_MS || 50_000);
const MAX_PDF_BYTES = Number(process.env.MAX_PDF_BYTES || 4.5 * 1024 * 1024);
/** Below this, treat as image/scanned PDF and run OCR. */
const MIN_TEXT_CHARS = Number(process.env.MIN_PDF_TEXT_CHARS || 40);

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

/** True when the PDF likely only has images / no real text layer. */
function isWeakExtractedText(text: string): boolean {
  const t = text.trim();
  if (t.length < MIN_TEXT_CHARS) return true;
  const alnum = (t.match(/[A-Za-z0-9]/g) || []).length;
  return alnum / t.length < 0.25;
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
      const pages = totalPages ?? pageCount ?? 1;
      if (typeof pages === "number" && pages > MAX_PDF_PAGES) {
        throw new Error(
          `PDF has too many pages (${pages}). Max allowed is ${MAX_PDF_PAGES}.`,
        );
      }

      const joined = Array.isArray(text) ? text.join("\n") : String(text || "");
      let cleaned = normalizeEngineeringText(joined.trim());

      // Scanned / image-only PDFs: OCR page images
      if (isWeakExtractedText(cleaned)) {
        const ocrText = await ocrPdfPages(pdf, typeof pages === "number" ? pages : 1);
        const ocrClean = normalizeEngineeringText(ocrText.trim());
        if (ocrClean.length > cleaned.length) {
          cleaned = ocrClean;
        }
      }

      if (!cleaned || isWeakExtractedText(cleaned)) {
        throw new Error(
          "Could not read text from this PDF (including images). Try a smaller scanned PDF, clearer photos, or export as text.",
        );
      }
      return clip(cleaned);
    };

    return await withTimeout(parse(), PDF_TIMEOUT_MS, "PDF parsing");
  } catch (err) {
    if (err instanceof Error) {
      const msg = err.message;
      if (
        msg.includes("Could not read text") ||
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

/**
 * Render each page to an image and run Tesseract OCR.
 * Used when the PDF has no useful text layer (scans, slide images, photos).
 */
async function ocrPdfPages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  pageCount: number,
): Promise<string> {
  const { renderPageAsImage } = await import("unpdf");
  const { createWorker } = await import("tesseract.js");

  const limit = Math.min(pageCount, MAX_OCR_PAGES);
  const worker = await createWorker("eng");
  const parts: string[] = [];

  try {
    for (let page = 1; page <= limit; page++) {
      try {
        const image = await renderPageAsImage(pdf, page, {
          scale: 2,
          // Dynamic require so Turbopack does not inline the native binding
          canvasImport: async () => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            return require("@napi-rs/canvas");
          },
        });
        const buffer = Buffer.from(image);
        const {
          data: { text },
        } = await worker.recognize(buffer);
        const line = (text || "").trim();
        if (line) {
          parts.push(`--- page ${page} ---\n${line}`);
        }
      } catch {
        // Skip pages that fail to render/OCR; continue others
      }
    }
  } finally {
    await worker.terminate();
  }

  if (!parts.length) {
    // Second try: OCR embedded images only (figures / photo snippets)
    const embedded = await ocrEmbeddedImages(pdf, pageCount);
    return embedded;
  }

  return parts.join("\n\n");
}

async function ocrEmbeddedImages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  pageCount: number,
): Promise<string> {
  try {
    const { extractImages } = await import("unpdf");
    const sharpMod = await import("sharp").catch(() => null);
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    const parts: string[] = [];
    const limit = Math.min(pageCount, MAX_OCR_PAGES);

    try {
      for (let page = 1; page <= limit; page++) {
        let images: {
          data: Uint8ClampedArray;
          width: number;
          height: number;
          channels: 1 | 3 | 4;
        }[] = [];
        try {
          images = await extractImages(pdf, page);
        } catch {
          continue;
        }
        for (const img of images.slice(0, 4)) {
          if (img.width < 40 || img.height < 40) continue;
          try {
            let png: Buffer;
            if (sharpMod?.default) {
              png = await sharpMod
                .default(Buffer.from(img.data), {
                  raw: {
                    width: img.width,
                    height: img.height,
                    channels: img.channels,
                  },
                })
                .png()
                .toBuffer();
            } else {
              // Fallback: pass raw buffer (Tesseract may still work for some formats)
              png = Buffer.from(img.data);
            }
            const {
              data: { text },
            } = await worker.recognize(png);
            const line = (text || "").trim();
            if (line.length >= 8) parts.push(line);
          } catch {
            /* skip image */
          }
        }
      }
    } finally {
      await worker.terminate();
    }
    return parts.join("\n\n");
  } catch {
    return "";
  }
}
