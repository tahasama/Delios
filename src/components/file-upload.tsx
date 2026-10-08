"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { requestUploadAction, type UploadTarget } from "@/lib/actions/document-acts";
import { btn } from "@/components/ui";

/** The file's SHA-256 fingerprint, in hexadecimal: the backend checks the stored bytes against it. */
async function fingerprint(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Choose files and send them straight to storage: for each, the backend gives
 * a short-lived upload link after checking its name, size and fingerprint; the
 * browser sends the bytes there. Then `onUploaded` receives the files' ids.
 */
export function FileUpload({ target, label, onUploaded, multiple = true }: {
  target: UploadTarget;
  multiple?: boolean;
  label: string;
  /** Told the uploaded files' ids, and their names, in the same order. */
  onUploaded: (fileIds: string[], names: string[]) => Promise<string | null>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setError(null);
    const ids: string[] = [];
    try {
      for (const [i, file] of files.entries()) {
        setBusy(`Checking ${file.name} (${i + 1} of ${files.length})…`);
        const sha256 = await fingerprint(file);
        const asked = await requestUploadAction(target, { fileName: file.name, size: file.size, contentType: file.type || "application/octet-stream", sha256 });
        if (!asked.ok) throw new Error(`${file.name}: ${asked.message}`);
        setBusy(`Uploading ${file.name} (${i + 1} of ${files.length})…`);
        const sent = await fetch(asked.ticket.url, { method: asked.ticket.method, headers: asked.ticket.headers, body: file });
        if (!sent.ok) throw new Error(`${file.name} could not be stored (${sent.status}).`);
        ids.push(asked.ticket.fileId);
      }
      setBusy("Recording…");
      const problem = await onUploaded(ids, files.map((f) => f.name));
      if (problem) throw new Error(problem);
      setFiles([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <input type="file" multiple={multiple} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="block w-full text-xs text-slate-600 file:mr-3 file:rounded file:border-0 file:bg-tint file:px-3 file:py-1.5 file:text-xs file:font-semibold" />
      {files.length ? <p className="text-[11px] text-slate-500">{files.map((f) => f.name).join(", ")}</p> : null}
      {error ? <p role="alert" className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      <button type="button" disabled={!files.length || !!busy} onClick={send} className={btn("primary", "sm")}>
        <Upload className="h-4 w-4" /> {busy ?? label}
      </button>
    </div>
  );
}
