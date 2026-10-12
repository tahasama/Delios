import { requireScope } from "@/lib/scope";
import { ActionForm } from "@/components/form";
import { attachSupplierFileAction } from "@/lib/actions/supplier";
import { supplierStage } from "@/lib/state-names";
import { fmtDate } from "@/lib/utils";
import { NextStepBody, StagePath, type StepItem } from "./next-step";
import { cn } from "@/lib/utils";
import { hasVerb } from "@/lib/auth";
import { getMe } from "@/lib/api/me";
import { legacyDocument } from "@/lib/api/legacy";

/**
 * What a supplier sees on a document it owes us, in its own set of states: sent
 * to it, received, accepted, in review, released & issued; returned (by the
 * check, or by the review) brings it back to them. Attaching sends it, on one
 * transmittal. While Document Control has taken it back, nothing is sent.
 */
export async function SupplierDelivery({ documentId }: { documentId: string }) {
  const ctx = await requireScope();
  const { user } = ctx;
  // Read-only stays read-only: uploading is a right Document Control gives.
  const mayUpload = hasVerb(user, "CREATE") || hasVerb(user, "REVISE");
  const org = (await getMe())?.tenant.name ?? "us";
  const doc = await legacyDocument(ctx, documentId);
  const latest = doc?.revisions[0] ?? null;
  // Taken back by Document Control to change it: not theirs to send until it comes back to them.
  const unlocked = !!doc?.unlocked && (!doc.relocked || new Date(doc.relocked.at) < new Date(doc.unlocked.at));
  const stage = supplierStage(true, unlocked, latest ? { state: latest.backend.state, resentAt: latest.backend.resent?.at, returnedAt: latest.backend.returnedAt } : null);
  const toSend = stage === "SENT" || stage === "RETURNED_CHECK" || stage === "RETURNED_REVIEW";
  const at = stage === "RECEIVED" ? 1 : stage === "ACCEPTED" ? 2 : stage === "IN_REVIEW" ? 3 : stage === "RELEASED" ? 4 : 0;
  const note = stage === "UNLOCKED" ? <>{org} took it back to change it ({doc!.unlocked!.by}, {fmtDate(new Date(doc!.unlocked!.at))}): <em>{doc!.unlocked!.reason}</em>. Do not send it for now: it comes back to you once changed.</>
    : stage === "SENT" && latest ? <>{org} sent rev {latest.value} back to you{latest.backend.resent?.reason ? <>: <em>{latest.backend.resent.reason}</em></> : null}. Send it again: it stays rev {latest.value}.</>
    : stage === "SENT" ? <>Attach your file and send it. It goes in under this number; your own number can stay inside the document.</>
    : stage === "RETURNED_CHECK" ? <>{org} returned rev {latest!.value}{latest!.returnedReason ? <>: <em>{latest!.returnedReason}</em></> : null}. Correct it and send it again: it stays rev {latest!.value}.</>
    : stage === "RETURNED_REVIEW" ? <>The review returned rev {latest!.value}{latest!.returnedReason ? <>: <em>{latest!.returnedReason}</em></> : null}. Send the next revision.</>
    : stage === "RECEIVED" ? <>Received. {org} checks it, then accepts it or returns it with a reason.</>
    : stage === "ACCEPTED" ? <>Accepted by {org}.</>
    : stage === "IN_REVIEW" ? <>With {org}: in review.</>
    : <>Released and in use.</>;

  const items: StepItem[] = [];
  if (mayUpload && toSend) items.push({
    key: "attach",
    primary: true,
    open: true,
    label: `Send to ${org}`,
    body: (
      <ActionForm action={attachSupplierFileAction} submitLabel="Send" size="sm" hidden={{ documentId }}>
        <input type="file" name="file" required className="block w-full" />
        <p className="text-[11px] text-slate-500">A PDF is what people read; send the editable original as well if it was asked for. One transmittal carries it to {org}&apos;s Document Control.</p>
      </ActionForm>
    ),
  });

  return (
    <section className={cn("register register-sheet register-sheet-open relative", at >= 2 ? "rail-review" : "rail-prep")}>
      <span className="absolute inset-y-0 left-0 w-0.75 rounded-l-[0.875rem] bg-(--rail)" aria-hidden />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span className="stencil text-slate-600">Your delivery</span>
        <span className="text-[11px] text-slate-500">asked of you by {org}</span>
      </div>
      <NextStepBody items={items} status={<StagePath stages={["Sent", "Received", "Accepted", "In review", "Released & issued"]} at={at} note={<>{note}{!mayUpload && toSend ? <span className="mt-1 block text-[12px] text-amber-700">Your access is read-only. Ask {org}&apos;s Document Control for the right to upload.</span> : null}</>} />} />
    </section>
  );
}
