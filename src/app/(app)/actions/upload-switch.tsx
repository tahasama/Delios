"use client";

import { useState } from "react";
import { StagePath } from "../documents/[id]/next-step";

/**
 * The schedule's three lists as a stepper, and Documents ready, what they
 * feed, set apart after them. For whoever may upload, each list's pill opens
 * its own form under the row; pressing it again, or another, closes it.
 * Without uploads the row is shown as it is.
 */
export function UploadSwitch({ stages, at, under, result, panels }: {
  /** The three lists, as a stepper. */
  stages: string[];
  at: number;
  under: React.ReactNode[];
  /** What the lists feed, set apart at the end of the row. */
  result: { name: string; current: boolean; lines: React.ReactNode };
  /** The upload form of each stage that has one, by its position in the row. */
  panels: { stage: number; kind: string; panel: React.ReactNode }[];
}) {
  const [open, setOpen] = useState<number | null>(null);
  const shown = panels.find((one) => one.stage === open) ?? null;
  return (
    <div>
      {/* The three lists as a stepper, then what they feed, set apart by a rule. */}
      <div className="flex flex-wrap items-start gap-x-10 gap-y-5">
        <StagePath
          stages={stages}
          at={at}
          under={under}
          pick={panels.length ? {
            can: stages.map((_, i) => panels.some((one) => one.stage === i)),
            open,
            onPick: (i) => setOpen(open === i ? null : i),
            controls: (i) => `upload-${panels.find((one) => one.stage === i)?.kind ?? i}`,
          } : undefined}
        />
        <div className="border-line sm:border-l sm:pl-8">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-semibold ${result.current ? "bg-(--color-brand) text-white" : "text-slate-400 ring-1 ring-line-strong"}`}
            aria-current={result.current ? "step" : undefined}
          >
            {result.name}
          </span>
          <div className="mt-2.5 space-y-0.5 px-2.5 text-[11px] leading-4 text-slate-500">{result.lines}</div>
        </div>
      </div>
      {shown ? <div id={`upload-${shown.kind}`} className="mt-5 border-t border-line pt-4 pb-1">{shown.panel}</div> : null}
    </div>
  );
}
