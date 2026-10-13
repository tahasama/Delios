"use client";

import { useState } from "react";
import { StagePath } from "../documents/[id]/next-step";

/**
 * The schedule's stages, and for whoever plans the project its three uploads
 * on the stages themselves: Schedule, Disciplines and Requirements each open
 * their own form under the row; pressing it again, or another, closes it.
 * Documents ready opens nothing. Without uploads the row is shown as it is.
 */
export function UploadSwitch({ stages, at, under, panels }: {
  stages: string[];
  at: number;
  under: React.ReactNode[];
  /** The upload form of each stage that has one, by its position in the row. */
  panels: { stage: number; kind: string; panel: React.ReactNode }[];
}) {
  const [open, setOpen] = useState<number | null>(null);
  const shown = panels.find((one) => one.stage === open) ?? null;
  return (
    <div>
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
      {shown ? <div id={`upload-${shown.kind}`} className="mt-4 border-t border-line pt-4 pb-1">{shown.panel}</div> : null}
    </div>
  );
}
