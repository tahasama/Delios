"use client";

import { useState } from "react";
import { Upload } from "lucide-react";

/**
 * The schedule's three uploads, one button each and in the order they are
 * done. A button opens its own form under the line and nothing else; pressing
 * it again, or another, closes it.
 */
export function UploadSwitch({ line, panels }: {
  line: React.ReactNode;
  panels: { kind: string; label: string; panel: React.ReactNode }[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = panels.find((one) => one.kind === open) ?? null;
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        {line}
        {/* One small joined group: a button per list, in the order they are done. */}
        <div className="inline-flex shrink-0 items-stretch divide-x divide-line overflow-hidden rounded-md border border-line text-xs">
          {panels.map((one) => (
            <button
              key={one.kind}
              type="button"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 font-semibold transition-colors ${
                open === one.kind ? "bg-tint text-brand-ink" : "text-slate-600 hover:bg-tint-soft hover:text-brand-ink"
              }`}
              aria-expanded={open === one.kind}
              aria-controls={`upload-${one.kind}`}
              onClick={() => setOpen(open === one.kind ? null : one.kind)}
            >
              <Upload aria-hidden className="h-3.5 w-3.5 opacity-70" /> {one.label}
            </button>
          ))}
        </div>
      </div>
      {shown ? <div id={`upload-${shown.kind}`} className="mt-5 border-t border-line pt-4 pb-1">{shown.panel}</div> : null}
    </div>
  );
}
