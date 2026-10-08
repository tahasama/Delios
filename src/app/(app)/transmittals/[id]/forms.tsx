"use client";

import { useActionState, useState } from "react";
import { FileUpload } from "@/components/file-upload";
import { btn, inputCls } from "@/components/ui";
import type { ActResult } from "@/lib/actions/document-acts";
import { acknowledgeAction, dispatchRecipientAction, registerItemAction } from "@/lib/actions/transmittal-acts";

function Result({ state }: { state: ActResult | undefined }) {
  if (!state) return null;
  return state.ok ? <p className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{state.message}</p>
    : <p role="alert" className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{state.message}</p>;
}

/** The reader acknowledges what was sent to them. */
export function Acknowledge({ transmittalId }: { transmittalId: string }) {
  const [state, act, pending] = useActionState(acknowledgeAction, undefined);
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="transmittalId" value={transmittalId} />
      <Result state={state} />
      <button type="submit" disabled={pending} className={btn("primary", "sm")}>{pending ? "…" : "I have received it"}</button>
    </form>
  );
}

/** For an organization outside the system: how it went, their reference, and proof if there is any. */
export function Dispatch({ transmittalId, recipientId, name }: { transmittalId: string; recipientId: string; name: string }) {
  const [state, act, pending] = useActionState(dispatchRecipientAction, undefined);
  const [proof, setProof] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {proof ? <p className="text-xs text-emerald-700">Proof uploaded.</p> : (
        <FileUpload target={{ transmittalId }} multiple={false} label="Upload proof (optional)" onUploaded={async (ids) => { setProof(ids[0]); return null; }} />
      )}
      <form action={act} className="space-y-2">
        <input type="hidden" name="transmittalId" value={transmittalId} />
        <input type="hidden" name="recipientId" value={recipientId} />
        <input type="hidden" name="proofFileId" value={proof ?? ""} />
        <div className="grid gap-2 sm:grid-cols-2">
          <input name="channel" className={inputCls} placeholder="How it went (their portal, email…)" />
          <input name="reference" className={inputCls} placeholder="Their reference (optional)" />
        </div>
        <Result state={state} />
        <button type="submit" disabled={pending} className={btn("primary", "sm")}>{pending ? "…" : `Record it as sent to ${name}`}</button>
      </form>
    </div>
  );
}

type Pick = { code: string; label: string };

/**
 * Document Control puts something that came unplanned into our register: it
 * gets our number from what is chosen here; it is originated by the sender.
 */
export function RegisterItem({ transmittalId, itemId, title, docType, lists }: {
  transmittalId: string; itemId: string; title: string; docType: string | null;
  lists: { deliverableTypes: Pick[]; docTypes: Pick[]; disciplines: Pick[]; subprojects: Pick[]; orders: Pick[] };
}) {
  const [state, act, pending] = useActionState(registerItemAction, undefined);
  const select = (name: string, list: Pick[], value?: string | null, blank?: string) => (
    <select name={name} defaultValue={value ?? (blank === undefined ? list[0]?.code : "")} className={inputCls}>
      {blank !== undefined ? <option value="">{blank}</option> : null}
      {list.map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
    </select>
  );
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="transmittalId" value={transmittalId} />
      <input type="hidden" name="itemId" value={itemId} />
      <input name="title" defaultValue={title} className={inputCls} aria-label="Title" />
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[11px] text-slate-500">Deliverable type{select("deliverableType", lists.deliverableTypes)}</label>
        <label className="text-[11px] text-slate-500">Document type{select("docType", lists.docTypes, docType)}</label>
        <label className="text-[11px] text-slate-500">Discipline{select("discipline", lists.disciplines)}</label>
        <label className="text-[11px] text-slate-500">Subproject{select("subproject", lists.subprojects, null, "—")}</label>
        <label className="text-[11px] text-slate-500">Purchase order{select("contractRef", lists.orders, null, "—")}</label>
      </div>
      <Result state={state} />
      <button type="submit" disabled={pending} className={btn("primary", "sm")}>{pending ? "…" : "Register it under our numbering"}</button>
    </form>
  );
}
