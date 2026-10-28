"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Select } from "@/components/select";

/**
 * Where a table stands in its rows, drawn in the table's own bar above them (owner: paging at the top, "for all tables
 * for consistency"): which rows of how many, the steps when there is more than one page, and how many rows a page
 * holds. The table scrolls inside its card, so the bar is always on screen; no strip under the rows.
 */
export function TablePaging({ from, to, total, extra, hint, page, pages, onPage, perPage, sizes, onSize }: {
  from: number; to: number; total: number;
  /** Said after the count ("3 ticked"). */
  extra?: string;
  /** What the count means, on hover. */
  hint?: string;
  page?: number; pages?: number; onPage?: (page: number) => void;
  perPage?: number; sizes?: number[]; onSize?: (size: number) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-1">
      <p className="whitespace-nowrap font-mono text-[11px] tabular-nums text-slate-500" title={hint}>
        {total ? `${from.toLocaleString("en-GB")}–${to.toLocaleString("en-GB")}` : 0}
        <span className="ml-1.5 font-sans text-slate-400">of {total.toLocaleString("en-GB")}{extra ? `, ${extra}` : ""}</span>
      </p>
      {page && pages && pages > 1 && onPage ? (
        <span className="flex items-center gap-0.5">
          <Step onClick={() => onPage(page - 1)} disabled={page === 1} label="Previous page"><ChevronLeft className="h-4 w-4" /></Step>
          <span className="px-1 font-mono text-[11px] tabular-nums text-slate-600">{page} <span className="text-slate-400">/ {pages}</span></span>
          <Step onClick={() => onPage(page + 1)} disabled={page === pages} label="Next page"><ChevronRight className="h-4 w-4" /></Step>
        </span>
      ) : null}
      {perPage && sizes && onSize ? (
        <label className="flex items-center gap-1.5">
          <span className="stencil text-slate-400">Rows</span>
          <Select className="plain" value={perPage} onChange={(event) => onSize(Number(event.target.value))}>
            {sizes.map((size) => <option key={size} value={size}>{size}</option>)}
          </Select>
        </label>
      ) : null}
    </div>
  );
}

/** One step through the rows. A step that leads nowhere is shown, and dead. */
function Step({ onClick, disabled, label, children }: { onClick: () => void; disabled: boolean; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded-sm p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-brand-ink disabled:cursor-default disabled:text-slate-300 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
