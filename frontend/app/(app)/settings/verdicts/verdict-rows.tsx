"use client";

import { useState } from "react";
import { Field, inputCls } from "@/components/ui";
import { Plus, X } from "lucide-react";
import { VERDICT_EFFECT } from "@/lib/reviews/verdict-effect";

type Verdict = { code: string; label: string; status: string; meaning: string | null };
type Row = Partial<Verdict> & { key: number };

/**
 * The verdicts of a list, as many as wanted: code, label and what it means (one of four, always chosen by the
 * person). A verdict already there keeps its code; it is retired, never taken out.
 */
export function VerdictRows({ verdicts }: { verdicts: Verdict[] }) {
  const [rows, setRows] = useState<Row[]>(() => verdicts.length ? verdicts.map((v, key) => ({ ...v, key })) : [{ key: 0 }, { key: 1 }]);
  const add = () => setRows((was) => [...was, { key: Math.max(-1, ...was.map((r) => r.key)) + 1 }]);
  return (
    <div className="space-y-3">
      {rows.map((v, i) => {
        const kept = !!v.status;
        return (
          <div key={v.key} className="grid grid-cols-2 items-end gap-x-4 gap-y-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,2fr)_auto]">
            <Field label="Code" hint={kept ? "never changes" : "as people write it"}>
              <input name={`code_${i}`} defaultValue={v.code ?? ""} readOnly={kept} className={`${inputCls} ${kept ? "text-slate-500" : ""}`} />
            </Field>
            <Field label="Label"><input name={`label_${i}`} defaultValue={v.label ?? ""} className={inputCls} /></Field>
            <Field label="What it means" required hint={kept && !v.meaning ? "not chosen yet" : "what the app does with it"}>
              <select name={`meaning_${i}`} defaultValue={v.meaning ?? ""} required className={inputCls}>
                <option value="" disabled>Choose…</option>
                {VERDICT_EFFECT.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            {kept ? (
              <label className="mb-1.5 flex items-center gap-1.5 text-[12px] text-slate-600" title="A retired verdict stays on the reviews that gave it, and is offered no more">
                <input type="checkbox" name={`retired_${i}`} defaultChecked={v.status === "RETIRED"} /> Retired
              </label>
            ) : (
              <button type="button" onClick={() => setRows((was) => was.filter((r) => r.key !== v.key))} disabled={rows.length === 1}
                className="mb-1.5 rounded-sm p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:invisible" aria-label="Take this verdict out">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        );
      })}
      <button type="button" onClick={add} className="ask inline-flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Add a verdict</button>
    </div>
  );
}
