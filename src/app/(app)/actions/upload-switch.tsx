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
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {line}
        <div className="flex flex-wrap items-center gap-2">
          {panels.map((one, i) => (
            <button
              key={one.kind}
              type="button"
              className="ask"
              data-on={open === one.kind ? "true" : "false"}
              aria-expanded={open === one.kind}
              onClick={() => setOpen(open === one.kind ? null : one.kind)}
            >
              <span className="font-mono text-[11px] opacity-60">{i + 1}</span>
              <Upload className="h-3.5 w-3.5" /> {one.label}
            </button>
          ))}
        </div>
      </div>
      {shown ? <div className="mt-3 border-t border-line pt-4">{shown.panel}</div> : null}
    </div>
  );
}
