"use client";

import Link from "next/link";
import { useState } from "react";
import { Search } from "lucide-react";

export type SetNavGroup = { title: string; sets: { key: string; title: string; count: number }[] };

/** The sets, grouped by what they are for, with a filter that narrows as you type. */
export function SetNav({ groups, current }: { groups: SetNavGroup[]; current: string }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = groups
    .map((g) => ({ ...g, sets: g.sets.filter((s) => !needle || s.title.toLowerCase().includes(needle) || s.key.toLowerCase().includes(needle)) }))
    .filter((g) => g.sets.length);

  return (
    <nav aria-label="Sets" className="space-y-3">
      <label className="relative block">
        <span className="sr-only">Filter sets</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter sets…" className="h-9 w-full rounded-lg border border-slate-200 bg-surface pl-8 pr-2 text-xs outline-none focus:border-brand-line" />
      </label>
      {shown.map((g) => (
        <div key={g.title}>
          <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{g.title}</p>
          <ul className="space-y-px">
            {g.sets.map((s) => {
              const on = s.key === current;
              return (
                <li key={s.key}>
                  <Link
                    href={`/admin/config?set=${s.key}`}
                    aria-current={on ? "page" : undefined}
                    className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13px] ${on ? "bg-tint font-semibold text-brand-ink" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
                  >
                    <span className="truncate">{s.title}</span>
                    <span className={`shrink-0 text-[11px] tabular-nums ${on ? "text-brand-ink/70" : "text-slate-400"}`}>{s.count}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {!shown.length ? <p className="px-2 text-xs text-slate-400">No set matches “{q}”.</p> : null}
    </nav>
  );
}
