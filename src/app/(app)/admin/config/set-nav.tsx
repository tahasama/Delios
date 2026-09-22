"use client";

import Link from "next/link";
import { useState } from "react";
import { Search } from "lucide-react";

export type SetNavGroup = { title: string; sets: { key: string; title: string; count: number }[] };

/**
 * The sets as tabs by purpose, then the sets of that tab side by side — no
 * scrolling to find one. Typing in the filter searches every tab at once.
 */
export function SetNav({ groups, current }: { groups: SetNavGroup[]; current: string }) {
  const home = Math.max(0, groups.findIndex((g) => g.sets.some((s) => s.key === current)));
  const [tab, setTab] = useState(home);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const sets = needle
    ? groups.flatMap((g) => g.sets).filter((s) => s.title.toLowerCase().includes(needle) || s.key.toLowerCase().includes(needle))
    : groups[tab]?.sets ?? [];

  return (
    <nav aria-label="Sets" className="rounded-2xl border border-slate-200 bg-surface shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-200 px-3 pt-2">
        <div role="tablist" className="scroll-thin -mb-px flex gap-1 overflow-x-auto">
          {groups.map((g, i) => {
            const on = !needle && i === tab;
            return (
              <button
                key={g.title}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => { setTab(i); setQ(""); }}
                className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-semibold transition ${on ? "border-brand-line text-brand-ink" : "border-transparent text-slate-500 hover:text-slate-800"}`}
              >
                {g.title} <span className="ml-0.5 font-normal text-slate-400">{g.sets.length}</span>
              </button>
            );
          })}
        </div>
        <label className="relative mb-1.5 w-full sm:w-56">
          <span className="sr-only">Find a set</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a set…" className="h-8 w-full rounded-lg border border-slate-200 bg-surface pl-8 pr-2 text-xs outline-none focus:border-brand-line" />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5 p-3" role="tabpanel">
        {sets.map((s) => {
          const on = s.key === current;
          return (
            <Link
              key={s.key}
              href={`/admin/config?set=${s.key}`}
              aria-current={on ? "page" : undefined}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] transition ${on ? "border-brand-line bg-tint font-semibold text-brand-ink" : "border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50"}`}
            >
              {s.title}
              <span className={`text-[11px] tabular-nums ${on ? "text-brand-ink/70" : "text-slate-400"}`}>{s.count}</span>
            </Link>
          );
        })}
        {!sets.length ? <p className="text-xs text-slate-400">No set matches “{q}”.</p> : null}
      </div>
    </nav>
  );
}
