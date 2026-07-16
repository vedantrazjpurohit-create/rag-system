"use client";

import { useRef, useState } from "react";

import type { MockDocument } from "./mockData";

interface SampleUploadProps {
  documents: MockDocument[];
  onAdd: (files: FileList) => void;
}

export function SampleUpload({ documents, onAdd }: SampleUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pdfCount = documents.filter((d) => d.type === "pdf").length;

  return (
    <section className="sample-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-[var(--sample-text)]">Add your PDFs</h2>
        <span className="text-xs text-[var(--sample-dim)]">{pdfCount} added</span>
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
          if (e.dataTransfer.files.length) onAdd(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`sample-dropzone cursor-pointer px-4 py-8 text-center ${dragging ? "sample-dropzone-active" : ""}`}
      >
        <p className="text-sm text-[var(--sample-text)]">Drag files here, or click to browse</p>
        <p className="mt-1 text-xs text-[var(--sample-muted)]">You can add more than one at a time</p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onAdd(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </section>
  );
}