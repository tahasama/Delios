"use client";

import { useState } from "react";
import { Field, inputCls } from "@/components/ui";
import { Plus, X } from "lucide-react";
import type { RevisionSeries } from "@/lib/settings/api-admin";

type Row = Partial<RevisionSeries> & { key: number };

/**
 * The lines of a revision scheme: one for any phase (the default), and one for each phase that names its revisions
 * otherwise, as many as wanted. A line already carried by revisions keeps its code (sent hidden) and how it counts.
 */
export function SeriesRows({ series, phases }: { series: RevisionSeries[]; phases: { code: string; label: string }[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    series.length ? series.map((s, key) => ({ ...s, key })) : [{ key: 0, phase: null, kind: "LETTERS" }]);
  const add = () => setRows((was) => [...was, { key: Math.max(-1, ...was.map((r) => r.key)) + 1, kind: "LETTERS" }]);
  const remove = (key: number) => setRows((was) => was.filter((r) => r.key !== key));
  const taken = (except: number) => new Set(rows.filter((r) => r.key !== except).map((r) => r.phase ?? ""));

  return (
    <div className="space-y-3">
      {rows.map((s, i) => {
        const others = taken(s.key);
        return (
          <div key={s.key} className="grid grid-cols-2 items-end gap-x-4 gap-y-3 md:grid-cols-[repeat(6,minmax(0,1fr))_auto]">
            {s.code ? <input type="hidden" name={`code_${i}`} value={s.code} /> : <input type="hidden" name={`code_${i}`} value="" />}
            <Field label="Phase" hint={i === 0 ? "a line per phase" : undefined}>
              <select name={`phase_${i}`} defaultValue={s.phase ?? ""} className={inputCls}>
                <option value="" disabled={others.has("")}>Any phase (the default)</option>
                {phases.map((p) => <option key={p.code} value={p.code} disabled={others.has(p.code)}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Name" hint="empty: the phase's"><input name={`label_${i}`} defaultValue={s.label ?? ""} className={inputCls} /></Field>
            <Field label="Counts in">
              <select name={`kind_${i}`} defaultValue={s.kind ?? "LETTERS"} className={inputCls}>
                <option value="LETTERS">Letters</option>
                <option value="NUMBERS">Numbers</option>
              </select>
            </Field>
            <Field label="Prefix" hint="before each value, e.g. P"><input name={`prefix_${i}`} defaultValue={s.prefix ?? ""} className={inputCls} /></Field>
            <Field label="Starts at" hint="empty: A, or 0"><input name={`start_${i}`} defaultValue={s.start ?? ""} className={inputCls} /></Field>
            <Field label="Letters skipped" hint="read as digits or as each other">
              <input name={`excluded_${i}`} defaultValue={s.excludedLetters?.join(" ") ?? ""} className={inputCls} />
              <input type="hidden" name={`width_${i}`} value={s.width ?? 0} />
            </Field>
            <button type="button" onClick={() => remove(s.key)} disabled={rows.length === 1 || !!s.code}
              title={s.code ? "A line stays once the scheme is saved: revisions may carry it" : "Take this line out"}
              className="mb-1.5 rounded-sm p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:invisible" aria-label="Take this line out">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
      <button type="button" onClick={add} disabled={rows.length > phases.length} className="ask inline-flex items-center gap-1.5 disabled:opacity-50">
        <Plus className="h-3.5 w-3.5" /> Add a line for a phase
      </button>
      {phases.length ? null : <p className="text-[11px] text-slate-500">No phase is published (Settings, lists, Phases): one line names every revision.</p>}
    </div>
  );
}
