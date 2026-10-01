"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChecklistRow = { id: string; number: string; rev: string; status: string | null; title: string };

/**
 * Documents to tick, as a new transmittal lists them: a search above, five rows
 * in view and the rest scrolling inside, each row a tick box with its number,
 * revision, status and title. What is ticked travels as `name`, one per row.
 */
export function RevisionChecklist({ rows, name, initial = [], onCount }: {
  rows: ChecklistRow[];
  name: string;
  initial?: string[];
  onCount?: (n: number) => void;
}) {
  const [chosen, setChosen] = useState<string[]>(initial);
  const [find, setFind] = useState("");
  const words = find.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(
    () => rows.filter((r) => words.every((w) => `${r.number} ${r.rev} ${r.status ?? ""} ${r.title}`.toLowerCase().includes(w))),
    [rows, words],
  );
  const toggle = (id: string) => setChosen((ids) => {
    const next = ids.includes(id) ? ids.filter((one) => one !== id) : [...ids, id];
    onCount?.(next.length);
    return next;
  });

  return (
    <div>
      <div className="asking flex items-center gap-2 border-b border-line px-5 py-2.5 sm:px-6">
        <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <label className="min-w-0 flex-1">
          <span className="sr-only">Find a document</span>
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find by number, title or revision" className="plain w-full" />
        </label>
        {find ? <button type="button" onClick={() => setFind("")} className="text-[11px] font-semibold text-link hover:underline">Clear</button> : null}
        <span className="font-mono text-[11px] tabular-nums text-slate-500">{chosen.length} chosen</span>
      </div>
      {/* What is ticked but filtered out still goes with the form. */}
      {chosen.filter((id) => !shown.some((r) => r.id === id)).map((id) => <input key={id} type="hidden" name={name} value={id} />)}
      {shown.length === 0 ? (
        <p className="px-5 py-6 text-center text-xs text-slate-400 sm:px-6">Nothing matches that.</p>
      ) : (
        <ul className="max-h-45 divide-y divide-line overflow-y-auto scroll-thin">
          {shown.map((r) => {
            const on = chosen.includes(r.id);
            return (
              <li key={r.id}>
                <label className={cn("grid h-9 cursor-pointer grid-cols-[auto_minmax(0,19rem)_2.5rem_4rem_minmax(0,1fr)] items-center gap-x-3 px-5 text-[12.5px] transition-colors sm:px-6", on ? "bg-tint-soft" : "hover:bg-tint-soft")}>
                  <input type="checkbox" name={name} value={r.id} checked={on} onChange={() => toggle(r.id)} />
                  <span className="truncate font-mono font-semibold text-slate-900">{r.number}</span>
                  <span className="font-mono text-slate-600">{r.rev}</span>
                  <span>{r.status ? <span className="code-chip">{r.status}</span> : null}</span>
                  <span className="truncate text-slate-500">{r.title}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
