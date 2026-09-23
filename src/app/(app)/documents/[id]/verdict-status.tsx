"use client";

import { useState } from "react";
import { Field, inputCls } from "@/components/ui";

export type VerdictOption = { code: string; label: string; effect: string; proceeds: boolean };
export type StatusOption = { code: string; label: string; allowsWork: boolean };

/**
 * The verdict, and — when it lets the revision proceed — what it may then be
 * used for. The status is the reviewers' decision, so it is required here and
 * cannot be changed at release. A verdict that sends the revision back asks
 * for a reason instead.
 */
export function VerdictDecision({ verdicts, statuses, deciding }: { verdicts: VerdictOption[]; statuses: StatusOption[]; deciding: boolean }) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const verdict = verdicts.find((v) => v.code === code);
  const proceeds = verdict?.proceeds === true;
  const chosen = statuses.find((s) => s.code === status);

  return (
    <>
      <Field label={deciding ? "Your verdict" : "Your advice"} required>
        <select name="outcome" required className={inputCls} value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="" disabled>Choose…</option>
          {verdicts.map((v) => <option key={v.code} value={v.code}>{v.code} — {v.label} ({v.effect})</option>)}
        </select>
      </Field>

      {deciding && proceeds ? (
        <Field label="It may then be used for" required hint="your decision — the control function releases at exactly this and cannot change it">
          <select name="proposedStatus" required value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
            <option value="" disabled>Choose…</option>
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
      ) : null}

      <Field label={proceeds || !code ? "Comment" : "What must change"} required={!!code && !proceeds} hint={code && !proceeds ? "the author needs to know what to fix" : "optional"}>
        <textarea name="note" rows={2} required={!!code && !proceeds} className={inputCls} placeholder={proceeds ? "what you checked" : "what must change before it comes back"} />
      </Field>
    </>
  );
}
