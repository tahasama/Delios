"use client";

import { useActionState, useState } from "react";
import { btn, inputCls } from "@/components/ui";
import type { ActResult } from "@/lib/actions/document-acts";
import { issueRequestAction, requestIssueAction } from "@/lib/actions/transmittal-acts";
import type { Distribution, IssueRequestView } from "@/lib/api/types";

function Result({ state }: { state: ActResult | undefined }) {
  if (!state) return null;
  return state.ok ? <p className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{state.message}</p>
    : <p role="alert" className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{state.message}</p>;
}

/**
 * Asking for the released revision to be issued: to whom (the matrix proposes
 * people; anyone else needs a reason) and why. Document Control sends it.
 */
export function RequestIssue({ documentId, revisionId, distribution, reasons }: {
  documentId: string; revisionId: string; distribution: Distribution; reasons: { code: string; label: string }[];
}) {
  const [state, act, pending] = useActionState(requestIssueAction, undefined);
  const [formKey] = useState(() => crypto.randomUUID());
  const [others, setOthers] = useState(false);
  const box = "flex items-center gap-2 text-xs";
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="revisionId" value={revisionId} />
      <input type="hidden" name="formKey" value={formKey} />
      <select name="reason" className={inputCls}>{reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}</select>
      <div className="space-y-1">
        {distribution.proposed.map((p) => <label key={p.id} className={box}><input type="checkbox" name="userId" value={p.id} defaultChecked /> {p.name} <span className="text-slate-400">· {p.function}</span></label>)}
        {distribution.parties.map((p) => <label key={p.id} className={box}><input type="checkbox" name="partyId" value={p.id} /> {p.name}</label>)}
        {distribution.others.length ? (
          <button type="button" onClick={() => setOthers(!others)} className="text-[11px] font-semibold text-link">{others ? "Hide the others" : `Someone the matrix does not propose (${distribution.others.length})`}</button>
        ) : null}
        {others ? distribution.others.map((p) => <label key={p.id} className={box}><input type="checkbox" name="userId" value={p.id} /> {p.name} <span className="text-slate-400">· {p.function}</span></label>) : null}
      </div>
      {others ? <input name="offDistributionReason" className={inputCls} placeholder="Why someone the matrix does not propose" /> : null}
      <input name="note" className={inputCls} placeholder="A note for Document Control (optional)" />
      <Result state={state} />
      <button type="submit" disabled={pending} className={btn("secondary", "sm")}>{pending ? "…" : "Ask for it to be issued"}</button>
    </form>
  );
}

/** One request, with Document Control's two answers: send it, or withdraw it. Whoever asked may withdraw it too. */
export function OpenRequest({ documentId, request, control, reasonLabel }: { documentId: string; request: IssueRequestView; control: boolean; reasonLabel: string }) {
  const [state, act, pending] = useActionState(issueRequestAction, undefined);
  return (
    <form action={act} className="space-y-1 text-xs">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="requestId" value={request.id} />
      <p><span className="font-semibold">{reasonLabel}</span>, asked by {request.raisedBy}{request.note ? `: ${request.note}` : ""}</p>
      <Result state={state} />
      <div className="flex gap-2">
        {control ? <button type="submit" name="what" value="carry-out" disabled={pending} className={btn("primary", "sm")}>Send it</button> : null}
        <button type="submit" name="what" value="cancel" disabled={pending} className={btn("ghost", "sm")}>Withdraw</button>
      </div>
    </form>
  );
}
