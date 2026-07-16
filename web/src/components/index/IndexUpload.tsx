"use client";

import { useRef, useState } from "react";

import { ingestFile } from "@/lib/api";
import { TenantUnavailableError } from "@/lib/tenant";

interface IndexUploadProps {
  fileCount: number;
  onUploaded: () => void;
}

export function IndexUpload({ fileCount, onUploaded }: IndexUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;

    const allowed = Array.from(files).filter((file) => {
      const name = file.name.toLowerCase();
      return (
        name.endsWith(".pdf") ||
        name.endsWith(".txt") ||
        name.endsWith(".md") ||
        file.type === "application/pdf" ||
        file.type.startsWith("text/")
      );
    });

    if (!allowed.length) {
      setError("Only PDF, .txt, and .md files are supported.");
      return;
    }

    setUploading(true);
    setError(null);
    setMessage(null);

    try {
      const results = [];
      for (const file of allowed) {
        results.push(await ingestFile(file));
      }
      setMessage(
        `Added ${results.length} file${results.length === 1 ? "" : "s"} — ready to search.`,
      );
      onUploaded();
    } catch (err) {
      if (err instanceof TenantUnavailableError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Upload failed");
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="sample-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-[var(--sample-text)]">Add your PDFs</h2>
        <span className="text-xs text-[var(--sample-dim)]">{fileCount} added</span>
      </div>

      <div
        role="button"
        tabIndex={0}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(e.dataTransfer.files);
        }}
        onClick={() => !uploading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`sample-dropzone cursor-pointer px-4 py-8 text-center ${dragging ? "sample-dropzone-active" : ""}`}
      >
        <p className="text-sm text-[var(--sample-text)]">
          {uploading ? "Reading your files…" : "Drag files here, or click to browse"}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".md,.txt,.pdf,text/plain,text/markdown,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>
      {message && <p className="mt-2 text-xs text-[var(--sample-muted)]">{message}</p>}
      {error && <p className="mt-2 text-xs text-red-700/80">{error}</p>}
    </section>
  );
}