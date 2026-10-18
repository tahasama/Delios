"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { filterCookie } from "@/lib/core/filter-cookie";

/** One filter of a page as the menu lists it; `held` when it is filtering now (then it stays shown). */
export type FilterChoice = { key: string; label: string; held?: boolean };

/**
 * "Filters": which of a page's filters show (owner: on every page with filters). Each person's choice, kept in a cookie
 * the server reads (`lib/core/filter-choice.ts`), so the page comes back as they left it; a filter in use cannot be hidden.
 */
export function FilterMenu({ page, filters, shown }: { page: string; filters: FilterChoice[]; shown: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kept, setKept] = useState(shown);
  const toggle = (key: string) => {
    const next = kept.includes(key) ? kept.filter((k) => k !== key) : [...kept, key];
    setKept(next);
    try { document.cookie = `${filterCookie(page)}=${encodeURIComponent(next.join(","))}; path=/; max-age=31536000; samesite=lax`; } catch { /* kept for this visit only */ }
    router.refresh();
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        data-caret="none"
        className="plain group inline-flex items-center gap-1.5"
        title="Show or hide filters"
      >
        <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400 group-hover:text-brand-ink" />
        Filters
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-md border border-line bg-surface p-2 shadow-[0_8px_24px_rgb(0_0_0/0.12)]" onMouseLeave={() => setOpen(false)}>
          <p className="stencil px-1.5 pb-1.5 text-slate-500">Show these filters</p>
          {filters.map((f) => (
            <label key={f.key} className="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-[12.5px] text-slate-700 hover:bg-tint-soft">
              <input type="checkbox" data-instant="true" checked={!!f.held || kept.includes(f.key)} disabled={f.held} onChange={() => toggle(f.key)} />
              <span>{f.label}</span>
              {f.held ? <span className="ml-auto text-[11px] text-slate-400">in use</span> : null}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
