"use client";

import { useEffect, useState } from "react";
import { useDark } from "@/components/use-dark";
import { DARK_PDF_FILTER, readerUrl } from "@/lib/documents/pdf-dark";

/**
 * A Word, PowerPoint or other office file shown as the PDF the backend made of it (owner: "word", "powerpoint";
 * LibreOffice, faithful), the first time it is opened, then kept. Opened at the zoom chosen.
 */
export function OfficeView({ fileId, name, zoom = 1, height }: { fileId: string; name: string; zoom?: number; height: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dark = useDark();
  useEffect(() => {
    let gone = false;
    let made: string | null = null;
    fetch(`/api/files/${fileId}/as-pdf`)
      .then(async (r) => {
        if (gone) return;
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          setError(body.error ?? "The file could not be shown.");
          return;
        }
        made = URL.createObjectURL(await r.blob());
        if (!gone) setUrl(made);
      })
      .catch(() => { if (!gone) setError("The file could not be shown."); });
    return () => { gone = true; if (made) URL.revokeObjectURL(made); };
  }, [fileId]);
  if (error) return <p className="p-6 text-center text-xs text-slate-500">{error}</p>;
  if (!url) return <p className="p-6 text-center text-xs text-slate-500">Turning {name} into a page to read… (the first time takes a few seconds)</p>;
  return <iframe key={`${zoom}-${dark}`} src={readerUrl(url, zoom, dark)} title={name} className={`block w-full bg-slate-100 ${height}`}
    style={dark ? { filter: DARK_PDF_FILTER } : undefined} />;
}
