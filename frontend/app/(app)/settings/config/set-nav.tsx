"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export type SetNavGroup = { title: string; sets: { key: string; title: string; count: number }[] };

/**
 * The lists as tabs by purpose (they wrap, never scroll); under a tab, its lists on the left and the chosen list on the
 * right, flush in the same sheet. Typing in Find searches every tab at once.
 */
export function SetNav({ groups, current, children }: { groups: SetNavGroup[]; current: string; children: React.ReactNode }) {
  const home = Math.max(0, groups.findIndex((g) => g.sets.some((s) => s.key === current)));
  const [tab, setTab] = useState(home);
  const [q, setQ] = useState("");
  const router = useRouter();
  const needle = q.trim().toLowerCase();
  // The sheet stands from where it starts to the foot of the window (the page keeps its own bottom margin), so the
  // page never scrolls: only the table's rows do, and the list of lists when it is long. On a narrow screen it flows.
  const box = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const fit = () => {
      const el = box.current;
      if (!el) return;
      if (window.innerWidth < 1024) { setHeight(null); return; }
      const top = el.getBoundingClientRect().top + window.scrollY;
      const below = parseFloat(getComputedStyle(el.closest("main") ?? document.body).paddingBottom) || 0;
      setHeight(Math.max(360, Math.floor(window.innerHeight - top - below)));
    };
    fit();
    window.addEventListener("resize", fit);
    document.fonts?.ready.then(fit).catch(() => {});
    return () => window.removeEventListener("resize", fit);
  }, []);
  const sets = needle
    ? groups.flatMap((g) => g.sets).filter((s) => s.title.toLowerCase().includes(needle) || s.key.toLowerCase().includes(needle))
    : groups[tab]?.sets ?? [];

  return (
    <div ref={box} style={height ? { height } : undefined} className="register register-sheet register-sheet-open flex flex-col">
      <div className="asking flex shrink-0 flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-line px-5 pt-2 sm:px-6">
        <div role="tablist" className="-mb-px flex flex-wrap gap-x-5">
          {groups.map((g, i) => {
            const on = !needle && i === tab;
            return (
              <button
                key={g.title}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => { setTab(i); setQ(""); const first = g.sets[0]; if (first && !g.sets.some((s) => s.key === current)) router.replace(`/settings/config?set=${first.key}`); }}
                className={`-mb-px whitespace-nowrap border-b-2 px-0.5 pb-2 pt-1 text-[12px] leading-4 transition ${on ? "border-brand-ink font-semibold text-slate-900" : "border-transparent text-slate-500 hover:border-line-strong hover:text-slate-800"}`}
              >
                {g.title} <span className="ml-1 font-normal tabular-nums text-slate-500">{g.sets.length}</span>
              </button>
            );
          })}
        </div>
        <label className="search-field relative mb-1.5 w-full sm:w-56">
          <span className="sr-only">Find a list</span>
          <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a list…" className="plain w-full pl-6!" />
        </label>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[230px_minmax(0,1fr)] lg:grid-rows-1" role="tabpanel">
        <nav aria-label="Lists" className="scroll-quiet min-h-0 overflow-y-auto border-b border-line p-2 lg:border-b-0 lg:border-r">
          <ul className="space-y-px">
            {sets.map((one) => {
              const on = one.key === current;
              return (
                <li key={one.key}>
                  <Link
                    replace
                    href={`/settings/config?set=${one.key}`}
                    aria-current={on ? "page" : undefined}
                    className={`flex items-center justify-between gap-2 rounded-sm px-2.5 py-2 text-[13px] ${on ? "bg-tint font-semibold text-brand-ink" : "text-slate-600 hover:bg-tint-soft hover:text-slate-900"}`}
                  >
                    <span className="truncate">{one.title}</span>
                    <span className={`shrink-0 text-[11px] tabular-nums ${on ? "text-brand-ink/70" : "text-slate-500"}`}>{one.count}</span>
                  </Link>
                </li>
              );
            })}
            {!sets.length ? <li className="px-2.5 py-2 text-xs text-slate-500">No list matches “{q}”.</li> : null}
          </ul>
        </nav>
        <div className="flex min-h-0 min-w-0 flex-col">{children}</div>
      </div>
    </div>
  );
}
