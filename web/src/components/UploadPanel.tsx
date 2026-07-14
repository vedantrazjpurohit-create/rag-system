"use client";

import { useRef, useState } from "react";

import { ingestFile } from "@/lib/api";

interface UploadPanelProps {
  onUploaded: () => void;
}

export function UploadPanel({ onUploaded }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    setMessage(null);

    try {
      const results = [];
      for (const file of Array.from(files)) {
        results.push(await ingestFile(file));
      }
      const total = results.reduce((sum, r) => sum + r.chunks_indexed, 0);
      setMessage(`Indexed ${total} chunks from ${results.length} file(s).`);
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">Upload documents</h2>
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
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`cursor-pointer rounded-lg border border-dashed px-4 py-8 text-center transition ${
          dragging
            ? "border-emerald-400/60 bg-emerald-500/5"
            : "border-slate-700 hover:border-slate-600 hover:bg-slate-800/40"
        }`}
      >
        <p className="text-sm text-slate-300">
          {uploading ? "Indexing…" : "Drop .md, .txt, or .pdf files"}
        </p>
        <p className="mt-1 text-xs text-slate-500">or click to browse</p>
        <input
          ref={inputRef}
          type="file"
          accept=".md,.txt,.pdf,text/plain,text/markdown,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>
      {message && <p className="mt-2 text-xs text-emerald-300">{message}</p>}
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </section>
  );
}