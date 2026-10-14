"use client";

import Link from "next/link";
import { useState } from "react";
import { RevisionChecklist } from "@/components/revision-checklist";

type Row = { id: string; number: string; rev: string; status: string | null; title: string };

/**
 * Step 1 of starting a review: tick the documents that go down the same route. Going on reloads the page with them
 * named, so the routes offered are those that serve all of them; nothing ticked, it says so instead of reloading.
 */
export function ChooseDocuments({ rows, waitingForFile }: { rows: Row[]; waitingForFile: number }) {
  const [count, setCount] = useState(0);
  return (
    <form method="get">
      <RevisionChecklist name="revision" rows={rows} onCount={setCount} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
        <Link href="/reviews" className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
        <div className="flex items-center gap-3">
          {count === 0
            ? <span className="text-[11px] font-semibold text-amber-800">Tick at least one document to go on.</span>
            : waitingForFile ? <span className="text-[11px] text-slate-400">{waitingForFile} more being prepared without a file yet</span> : null}
          <button type="submit" disabled={count === 0} data-on={count ? "true" : undefined} className="ask disabled:cursor-not-allowed disabled:opacity-50">Continue</button>
        </div>
      </div>
    </form>
  );
}
