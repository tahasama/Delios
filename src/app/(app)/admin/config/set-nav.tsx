"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export type SetNavGroup = { title: string; sets: { key: string; title: string; count: number }[] };

/**
 * The sets as tabs by purpose; under a tab, its sets on the left and the
 * chosen set on the right. Typing in the filter searches every tab at once.
 */
export function SetNav({ groups, current, children }: { groups: SetNavGroup[]; current: string; children: React.ReactNode }) {
  const home = Math.max(0, groups.findIndex((g) => g.sets.some((s) => s.key === current)));
  const [tab, setTab] = useState(home);
  const [q, setQ] = useState("");
  const router = useRouter();
  const needle = q.trim().toLowerCase();
  const sets = needle
    ? groups.flatMap((g) => g.sets).filter((s) => s.title.toLowerCase().includes(needle) || s.key.toLowerCase().includes(needle))
    : groups[tab]?.sets ?? [];

  return (
    <div className="rounded-2xl border border-line bg-surface shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-3 pt-2">
        <div role="tablist" className="scroll-thin -mb-px flex gap-1 overflow-x-auto">
          {groups.map((g, i) => {
            const on = !needle && i === tab;
            return (
              <button
                key={g.title}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => { setTab(i); setQ(""); const first = g.sets[0]; if (first && !g.sets.some((s) => s.key === current)) router.replace(`/admin/config?set=${first.key}`); }}
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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a set…" className="h-8 w-full rounded-lg border border-line bg-surface pl-8 pr-2 text-xs outline-none focus:border-brand-line" />
        </label>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[230px_minmax(0,1fr)]" role="tabpanel">
        <nav aria-label="Sets" className="border-b border-line p-2 lg:border-b-0 lg:border-r">
        <ul className="space-y-px">
          {sets.map((one) => {
            const on = one.key === current;
            return (
              <li key={one.key}>
                <Link
                  replace
                  href={`/admin/config?set=${one.key}`}
                  aria-current={on ? "page" : undefined}
                  className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[13px] ${on ? "bg-tint font-semibold text-brand-ink" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
                >
                  <span className="truncate">{one.title}</span>
                  <span className={`shrink-0 text-[11px] tabular-nums ${on ? "text-brand-ink/70" : "text-slate-400"}`}>{one.count}</span>
                </Link>
              </li>
            );
          })}
          {!sets.length ? <li className="px-2.5 py-2 text-xs text-slate-400">No set matches “{q}”.</li> : null}
        </ul>
        </nav>
        <div className="min-w-0 p-4">{children}</div>
      </div>
    </div>
  );
}
