import { requireScope } from "@/lib/scope";
import { ActionForm } from "@/components/form";
import { attachSupplierFileAction, askBackAction, answerAskAction } from "@/lib/actions/supplier";
import { Field, inputCls } from "@/components/ui";
import { supplierStage } from "@/lib/state-names";
import { fmtDate } from "@/lib/utils";
import { NextStepBody, StagePath, type StepItem } from "./next-step";
import { cn } from "@/lib/utils";
import { hasVerb } from "@/lib/auth";
import { getMe } from "@/lib/api/me";
import { legacyDocument, handBacks } from "@/lib/api/legacy";

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
  // One side holds it at a time, and only the holder changes it: the other asks for it back.
  const holds = doc?.withSupplier !== false;
  const asks = await handBacks(ctx, documentId);
  const openAsk = asks.find((one) => !one.answeredAt) ?? null;
  const stage = supplierStage(true, latest ? { state: latest.backend.state, resentAt: latest.backend.resent?.at, returnedAt: latest.backend.returnedAt } : null);
  // A review's verdict with comments releases it and hands it to them: the next revision is theirs to send.
  const toSend = holds && (stage === "SENT" || stage === "RETURNED_CHECK" || stage === "RETURNED_REVIEW" || stage === "RELEASED");
  const at = stage === "RECEIVED" ? 1 : stage === "ACCEPTED" ? 2 : stage === "IN_REVIEW" ? 3 : stage === "RELEASED" ? 4 : 0;
  const note = stage === "SENT" && latest ? <>{org} sent rev {latest.value} to you for an update{latest.backend.resent?.reason ? <>: <em>{latest.backend.resent.reason}</em></> : null}. Send it again: it stays rev {latest.value}.</>
    : stage === "SENT" ? <>Attach your file and send it. It goes in under this number; your own number can stay inside the document.</>
    : stage === "RETURNED_CHECK" ? <>{org} returned rev {latest!.value}{latest!.returnedReason ? <>: <em>{latest!.returnedReason}</em></> : null}. Correct it and send it again: it stays rev {latest!.value}.</>
    : stage === "RETURNED_REVIEW" ? <>The review returned rev {latest!.value}{latest!.returnedReason ? <>: <em>{latest!.returnedReason}</em></> : null}. Send the next revision.</>
    : stage === "RECEIVED" ? <>Received. {org} checks it, then accepts it or returns it with a reason.</>
    : stage === "ACCEPTED" ? <>Accepted by {org}.</>
    : stage === "IN_REVIEW" ? <>With {org}: in review.</>
    : doc?.withSupplier === true ? <>Released with comments to take into the next revision: send the next revision.</>
    : <>Released and in use.</>;

  const items: StepItem[] = [];
  // We asked them to hand it back: they answer.
  if (holds && openAsk && !openAsk.fromSupplier) items.push({
    key: "asked-back",
    primary: true,
    open: true,
    label: `${org} asks for it back`,
    body: (<>
      <p className="whitespace-pre-line rounded-md bg-tint-soft px-3 py-2.5 text-xs leading-5 text-slate-700 ring-1 ring-line">
        <span className="font-semibold text-slate-800">{openAsk.askedBy}</span>, {fmtDate(new Date(openAsk.askedAt))}: {openAsk.reason}
        <span className="mt-1 block text-slate-600">Do you hand it back to {org} to update it? You cannot send it until they send it back to you.</span>
      </p>
      {mayUpload ? (
        <ActionForm action={answerAskAction} submitLabel="Answer" size="sm" hidden={{ askId: openAsk.id, documentId }} className="mt-3 space-y-3">
          <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-slate-700">
            <legend className="sr-only">Hand it back?</legend>
            <label className="flex items-center gap-1.5"><input type="radio" name="accept" value="yes" required /> Hand it back</label>
            <label className="flex items-center gap-1.5"><input type="radio" name="accept" value="no" required /> Keep it</label>
          </fieldset>
          <Field label="Why" hint={`${org} reads it; required to keep it`}>
            <textarea name="answer" rows={2} maxLength={2000} className={inputCls} />
          </Field>
        </ActionForm>
      ) : null}
    </>),
  });
  if (mayUpload && toSend && !(openAsk && !openAsk.fromSupplier)) items.push({
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
  // With us: to update it, they ask for it back.
  if (!holds) items.push({
    key: "ask-back",
    label: openAsk ? "Asked back — waiting for the answer" : `With ${org} — ask for it back`,
    body: openAsk ? (
      <p className="whitespace-pre-line text-xs leading-5 text-slate-600">
        {openAsk.askedBy} asked, {fmtDate(new Date(openAsk.askedAt))}: {openAsk.reason}
        <span className="block text-amber-800">{org}&apos;s Document Control answers; you are told.</span>
      </p>
    ) : mayUpload ? (
      <ActionForm action={askBackAction} submitLabel="Ask" size="sm" hidden={{ documentId }} className="space-y-3">
        <p className="text-xs text-slate-600">{org} holds it: only they change it now. To update it, ask them to hand it back.</p>
        <Field label="Why you need it back" required hint={`${org} reads it, then hands it back or refuses with why`}>
          <textarea name="reason" required rows={2} maxLength={2000} className={inputCls} />
        </Field>
      </ActionForm>
    ) : <p className="text-xs text-slate-600">{org} holds it: only they change it now.</p>,
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
