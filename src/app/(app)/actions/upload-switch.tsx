"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

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
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        {line}
        {/* Quiet until needed: one label, three names, in the order they are done. */}
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="mr-1 inline-flex items-center gap-1 text-slate-500"><Upload aria-hidden className="h-3.5 w-3.5" /> Upload Excel</span>
          {panels.map((one) => (
            <button
              key={one.kind}
              type="button"
              className={cn(
                "rounded-md px-2 py-1 font-semibold ring-1 ring-line transition-colors hover:bg-tint hover:text-brand-ink",
                open === one.kind ? "bg-tint text-brand-ink ring-brand-line" : "text-slate-600",
              )}
              aria-expanded={open === one.kind}
              aria-controls={`upload-${one.kind}`}
              onClick={() => setOpen(open === one.kind ? null : one.kind)}
            >
              {one.label}
            </button>
          ))}
        </div>
      </div>
      {shown ? <div id={`upload-${shown.kind}`} className="mt-3 border-t border-line pt-3 pb-1">{shown.panel}</div> : null}
    </div>
  );
}
