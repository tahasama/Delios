"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUpload } from "@/components/file-upload";
import { btn, inputCls } from "@/components/ui";
import { arrivalAction, resubmitAction, startRevisionAction, startReviewAction, type ActResult } from "@/lib/actions/document-acts";
import type { ListValue, RouteView } from "@/lib/api/types";

function Result({ state }: { state: ActResult | undefined }) {
  if (!state) return null;
  return state.ok
    ? <p className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{state.message ?? "Done."}</p>
    : <p role="alert" className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{state.message}</p>;
}

/** Start the next revision: files first, then why it is revised. */
export function StartRevision({ documentId, first }: { documentId: string; first: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [change, setChange] = useState("");
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {!first ? (
        <>
          <input className={inputCls} placeholder="Why it is revised" value={reason} onChange={(e) => setReason(e.target.value)} />
          <input className={inputCls} placeholder="What changed" value={change} onChange={(e) => setChange(e.target.value)} />
        </>
      ) : null}
      <FileUpload target={{ documentId }} label={first ? "Upload and start the first revision" : "Upload and start the next revision"}
        onUploaded={async (ids) => {
          const r = await startRevisionAction(documentId, ids, reason, change);
          if (!r.ok) return r.message;
          setDone(r.message ?? null);
          router.refresh();
          return null;
        }} />
      {done ? <p className="text-xs text-emerald-700">{done}</p> : null}
    </div>
  );
}

/** Send corrected files under the same revision. */
export function Resubmit({ documentId, revisionId }: { documentId: string; revisionId: string }) {
  const router = useRouter();
  return (
    <FileUpload target={{ documentId }} label="Upload the corrected files"
      onUploaded={async (ids) => {
        const r = await resubmitAction(documentId, revisionId, ids);
        if (!r.ok) return r.message;
        router.refresh();
        return null;
      }} />
  );
}

/** Document Control's check on what arrived: an outcome from the organization's list, and a note. */
export function Arrival({ documentId, revisionId, outcomes }: { documentId: string; revisionId: string; outcomes: ListValue[] }) {
  const [state, act, pending] = useActionState(arrivalAction, undefined);
  const usable = outcomes.filter((o) => o.status === "ACTIVE" && (o.props?.act === "accept" || o.props?.act === "return"));
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="revisionId" value={revisionId} />
      <select name="outcome" className={inputCls} defaultValue={usable.find((o) => o.props?.act === "accept")?.code ?? ""}>
        {usable.length ? usable.map((o) => <option key={o.code} value={o.code}>{o.label}</option>) : <option value="">Accept</option>}
      </select>
      <textarea name="note" rows={2} className={inputCls} placeholder="What is wrong (needed to return it)" />
      <Result state={state} />
      <button type="submit" disabled={pending} className={btn("primary", "sm")}>{pending ? "Recording…" : "Record"}</button>
    </form>
  );
}

/** Send the revision for review, on the route the organization's rules pick, or another one offered. */
export function SendForReview({ documentId, revisionId, routes }: { documentId: string; revisionId: string; routes: RouteView[] }) {
  const [state, act, pending] = useActionState(startReviewAction, undefined);
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="revisionId" value={revisionId} />
      {routes.length > 1 ? (
        <select name="routeId" className={inputCls} defaultValue={routes.find((r) => r.isDefault)?.id ?? routes[0].id}>
          {routes.map((r) => <option key={r.id} value={r.id}>{r.name}: {r.steps.map((s) => s.title).join(" → ")}</option>)}
        </select>
      ) : routes[0] ? <p className="text-xs text-slate-500">Route: {routes[0].name} ({routes[0].steps.map((s) => s.title).join(" → ")})</p> : null}
      <Result state={state} />
      <button type="submit" disabled={pending} className={btn("primary", "sm")}>{pending ? "Sending…" : "Send for review"}</button>
    </form>
  );
}
