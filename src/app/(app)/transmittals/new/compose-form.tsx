"use client";

import { useActionState, useState } from "react";
import { composeAction } from "@/lib/actions/transmittal-acts";
import type { Addressees } from "@/lib/api/types";
import { btn, Field, FormSection, inputCls } from "@/components/ui";

type Item = { revisionId: string; number: string; title: string; revision: string; status: string | null };

/** The compose form: what goes, to whom, why. */
export function ComposeForm({ items, preselected, addressees, reasons }: {
  items: Item[]; preselected: boolean; addressees: Addressees; reasons: { code: string; label: string; answer: boolean }[];
}) {
  const [state, act, pending] = useActionState(composeAction, undefined);
  const [formKey] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState(reasons[0]?.code ?? "");
  const wantsAnswer = reasons.find((r) => r.code === reason)?.answer ?? false;
  const box = "flex items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50";
  return (
    <form action={act} className="max-w-4xl space-y-4">
      <input type="hidden" name="formKey" value={formKey} />
      <FormSection title="What goes" help="Each revision as it stands now, recorded on the transmittal for good.">
        {items.length === 0 ? <p className="text-sm text-slate-500">No document has a released revision yet.</p> : (
          <div className="max-h-80 overflow-y-auto rounded border border-line">
            {items.map((i) => (
              <label key={i.revisionId} className={box}>
                <input type="checkbox" name="revisionId" value={i.revisionId} defaultChecked={preselected} className="mt-1" />
                <span><span className="font-semibold">{i.number}</span> rev {i.revision}{i.status ? ` · ${i.status}` : ""}<span className="block text-xs text-slate-500">{i.title}</span></span>
              </label>
            ))}
          </div>
        )}
      </FormSection>
      <FormSection title="To whom" help="Our own people get one transmittal together; each outside organization gets its own.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">People on the project</p>
            <div className="max-h-64 overflow-y-auto rounded border border-line">
              {addressees.people.map((p) => (
                <label key={p.id} className={box}><input type="checkbox" name="userId" value={p.id} className="mt-1" /><span>{p.name}<span className="block text-xs text-slate-500">{p.function}{p.organization ? ` · ${p.organization}` : ""}</span></span></label>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">Outside organizations</p>
            <div className="max-h-64 overflow-y-auto rounded border border-line">
              {addressees.parties.map((p) => (
                <label key={p.id} className={box}><input type="checkbox" name="partyId" value={p.id} className="mt-1" /><span>{p.name}<span className="block text-xs text-slate-500">{p.participation === "BY_PROXY" ? "works in its own system: Document Control sends it and records how" : "reads it here"}</span></span></label>
              ))}
            </div>
          </div>
        </div>
      </FormSection>
      <FormSection title="Why">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Reason for issue">
            <select name="reason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
              {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Answer due" hint={wantsAnswer ? "Empty: the period this reason sets." : "This reason expects no answer."}>
            <input type="date" name="responseDue" disabled={!wantsAnswer} className={inputCls} />
          </Field>
        </div>
        <Field label="Subject" hint="Empty: the document and its status, or the number of documents."><input name="subject" className={inputCls} /></Field>
        <Field label="Message"><textarea name="message" rows={4} className={inputCls} /></Field>
      </FormSection>
      {state?.error ? <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
      <button type="submit" disabled={pending} className={btn("primary")}>{pending ? "Sending…" : "Number and send"}</button>
    </form>
  );
}
