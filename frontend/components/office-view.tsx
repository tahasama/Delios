"use client";

import { useEffect, useState } from "react";

/**
 * A Word, PowerPoint or other office file shown as the PDF the backend made of it (owner: "word", "powerpoint";
 * LibreOffice, faithful), the first time it is opened, then kept. Opened at the zoom chosen.
 */
export function OfficeView({ fileId, name, zoom = 1, height, dark = false }: { fileId: string; name: string; zoom?: number; height: string; dark?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  return <iframe key={zoom} src={`${url}#zoom=${Math.round(zoom * 100)}`} title={name} className={`block w-full bg-slate-100 ${height}`}
    style={dark ? { filter: "invert(0.9) hue-rotate(180deg)" } : undefined} />;
}
