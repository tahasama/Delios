"use client";

import { useActionState, useState } from "react";
import { FileUpload } from "@/components/file-upload";
import { btn, inputCls } from "@/components/ui";
import type { ActResult } from "@/lib/actions/document-acts";
import { acknowledgeAction, dispatchRecipientAction } from "@/lib/actions/transmittal-acts";

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
