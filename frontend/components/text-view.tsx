"use client";

import { useEffect, useState } from "react";

/** A plain text file shown as it is (owner: "plain text"): read by the backend, its first 2 MB, said when cut. Never run. */
export function TextView({ fileId, name, zoom = 1 }: { fileId: string; name: string; zoom?: number }) {
  const [read, setRead] = useState<{ text: string; cut: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    fetch(`/api/files/${fileId}/text`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (gone) return;
        if (!r.ok) setError(body.error ?? "The file could not be shown.");
        else setRead(body);
      })
      .catch(() => { if (!gone) setError("The file could not be shown."); });
    return () => { gone = true; };
  }, [fileId]);
  if (error) return <p className="p-6 text-center text-xs text-slate-500">{error}</p>;
  if (!read) return <p className="p-6 text-center text-xs text-slate-500">Opening {name}…</p>;
  return (
    <div className="flex h-[70vh] min-h-120 flex-col bg-surface">
      <pre style={{ fontSize: `${12 * zoom}px` }} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono leading-relaxed text-slate-800">{read.text}</pre>
      {read.cut ? <p className="border-t border-line bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">The first 2 MB are shown. Download the file for the rest.</p> : null}
    </div>
  );
}
