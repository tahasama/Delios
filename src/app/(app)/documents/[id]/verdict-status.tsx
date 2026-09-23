"use client";

import { useState } from "react";
import { Field, inputCls } from "@/components/ui";

/**
 * What the revision may be used for, chosen by whoever gives the binding
 * verdict — not by the control function. Until it is released it reads
 * "to be IFC"; releasing drops the "to be".
 */
export function VerdictStatus({ statuses }: { statuses: { code: string; label: string; allowsWork: boolean }[] }) {
  const [code, setCode] = useState("");
  const chosen = statuses.find((s) => s.code === code);
  return (
    <Field label="If it proceeds, it may be used for" hint="ignored when the verdict sends it back to the author">
      <select name="proposedStatus" value={code} onChange={(e) => setCode(e.target.value)} className={inputCls}>
        <option value="">Choose…</option>
        {statuses.map((s) => <option key={s.code} value={s.code}>to be {s.code} — {s.label}</option>)}
      </select>
      {chosen ? (
        <span className={`mt-1.5 block text-[11px] ${chosen.allowsWork ? "font-semibold text-amber-700" : "text-slate-500"}`}>
          {chosen.allowsWork
            ? `Once released, people may build, fabricate or order from it (${chosen.code}).`
            : `Once released, it may be read and commented on, but not built from (${chosen.code}).`}
        </span>
      ) : null}
    </Field>
  );
}
