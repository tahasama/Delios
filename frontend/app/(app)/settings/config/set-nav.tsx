"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, Search } from "lucide-react";

/** One set of a list, as the menu shows it under its list. */
export type SetNavSet = { id: string | null; name: string; active: boolean; isDefault: boolean; count: number };
export type SetNavGroup = { title: string; sets: { key: string; title: string; count: number; takesSets: boolean; parts: SetNavSet[] }[] };

/**
 * The lists as tabs by purpose (they wrap, never scroll); under a tab, its lists on the left and the chosen list on the
 * right, flush in the same sheet. Typing in Find searches every tab at once.
 */
export function SetNav({ groups, current, currentSet, mayAddSets, children }: {
  groups: SetNavGroup[]; current: string;
  /** The set shown on the right. */
  currentSet: string | null;
  /** Whoever may change the lists sees "New set" under a list that takes sets. */
  mayAddSets: boolean;
  children: React.ReactNode;
}) {
  const home = Math.max(0, groups.findIndex((g) => g.sets.some((s) => s.key === current)));
  const [tab, setTab] = useState(home);
  const [q, setQ] = useState("");
  // A list opens on its sets with its + (which becomes −); the one shown on the right starts open.
  const [open, setOpen] = useState<Set<string>>(() => new Set([current]));
  // The list chosen opens on its sets by itself, whichever way it was chosen.
  useEffect(() => { setOpen((was) => (was.has(current) ? was : new Set(was).add(current))); }, [current]);
  const toggle = (key: string) => setOpen((was) => { const next = new Set(was); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const router = useRouter();
  const needle = q.trim().toLowerCase();
  const sets = needle
    ? groups.flatMap((g) => g.sets).filter((s) => s.title.toLowerCase().includes(needle) || s.key.toLowerCase().includes(needle))
    : groups[tab]?.sets ?? [];

  return (
    // As tall as the window under the top bar (h-18) less the page's margins above and below it (py-6): the title above
    // scrolls away, then this sheet fills the window and only its table and its list of lists scroll. A narrow screen flows.
    <div className="register register-sheet register-sheet-open flex flex-col lg:h-[calc(100dvh-7.5rem)]">
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
                onClick={() => { setTab(i); setQ(""); const first = g.sets[0]; if (first && !g.sets.some((s) => s.key === current)) router.replace(`/settings/config?set=${first.key}`, { scroll: false }); }}
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
              const opened = open.has(one.key);
              return (
                <li key={one.key}>
                  <div className={`flex items-center rounded-sm ${on ? "bg-tint" : "hover:bg-tint-soft"}`}>
                    <Link
                      replace
                      scroll={false}
                      href={`/settings/config?set=${one.key}`}
                      aria-current={on ? "page" : undefined}
                      className={`flex min-w-0 flex-1 items-center justify-between gap-2 py-2 pl-2.5 pr-1 text-[13px] ${on ? "font-semibold text-brand-ink" : "text-slate-600 hover:text-slate-900"}`}
                    >
                      <span className="truncate">{one.title}</span>
                      <span className={`shrink-0 text-[11px] tabular-nums ${on ? "text-brand-ink/70" : "text-slate-500"}`}>{one.count}</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => toggle(one.key)}
                      aria-expanded={opened}
                      aria-label={`${opened ? "Close" : "Open"} the sets of ${one.title}`}
                      title={opened ? "Close its sets" : "Its sets"}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-slate-500 hover:bg-white/60 hover:text-slate-800"
                    >
                      {opened ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  {opened ? (
                    <ul className="mb-1 ml-3 mt-0.5 space-y-px border-l border-line pl-2">
                      {one.parts.map((part) => {
                        const here = on && (currentSet ?? "") === (part.id ?? "");
                        return (
                          <li key={part.id ?? "default"}>
                            <Link
                              replace
                              scroll={false}
                              href={`/settings/config?set=${one.key}${part.id ? `&vs=${part.id}` : ""}`}
                              aria-current={here ? "page" : undefined}
                              className={`flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-[12px] ${here ? "bg-tint font-semibold text-brand-ink" : "text-slate-600 hover:bg-tint-soft hover:text-slate-900"} ${part.active ? "" : "opacity-60"}`}
                            >
                              <span className="truncate">{part.name}{part.active ? "" : " · off"}</span>
                              <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{part.count}</span>
                            </Link>
                          </li>
                        );
                      })}
                      {mayAddSets && one.takesSets ? (
                        <li>
                          <Link replace scroll={false} href={`/settings/config?set=${one.key}&panel=newset`} className="flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-[12px] font-semibold text-link hover:bg-tint-soft">
                            <Plus className="h-3 w-3" /> New set
                          </Link>
                        </li>
                      ) : !one.takesSets ? (
                        <li className="px-2 py-1 text-[11px] text-slate-500">one set: the same for every deliverable type</li>
                      ) : null}
                    </ul>
                  ) : null}
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
