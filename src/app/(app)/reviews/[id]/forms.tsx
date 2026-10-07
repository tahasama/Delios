"use client";

import { useActionState, useState } from "react";
import { FileUpload } from "@/components/file-upload";
import { btn, inputCls } from "@/components/ui";
import type { ActResult } from "@/lib/actions/document-acts";
import { answerAction, closeCommentAction, commentAction, dispatchAction, releaseAction, returnAction, rewindAction } from "@/lib/actions/review-acts";

type Opt = { code: string; label: string };

function Result({ state }: { state: ActResult | undefined }) {
  if (!state) return null;
  return state.ok
    ? <p className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{state.message ?? "Done."}</p>
    : <p role="alert" className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{state.message}</p>;
}

function Form({ action, reviewId, label, children, tone = "primary" }: {
  action: (prev: ActResult | undefined, form: FormData) => Promise<ActResult>;
  reviewId: string; label: string; children?: React.ReactNode; tone?: "primary" | "secondary" | "danger";
}) {
  const [state, run, pending] = useActionState(action, undefined);
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      {children}
      <Result state={state} />
      <button type="submit" disabled={pending} className={btn(tone, "sm")}>{pending ? "…" : label}</button>
    </form>
  );
}

function Select({ name, options, blank, defaultValue }: { name: string; options: Opt[]; blank?: string; defaultValue?: string }) {
  return (
    <select name={name} className={inputCls} defaultValue={defaultValue ?? (blank !== undefined ? "" : options[0]?.code)}>
      {blank !== undefined ? <option value="">{blank}</option> : null}
      {options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
    </select>
  );
}

/** A comment on the open step: its class (blocking or not) from the organization's list, and which later step settles it. */
export function CommentForm({ reviewId, classes, laterSteps }: { reviewId: string; classes: Opt[]; laterSteps: Opt[] }) {
  return (
    <Form action={commentAction} reviewId={reviewId} label="Add comment" tone="secondary">
      <textarea name="text" rows={3} className={inputCls} placeholder="What you found" />
      <div className="grid gap-2 sm:grid-cols-2">
        <Select name="class" options={classes} />
        <Select name="closesWithStep" options={laterSteps} blank="Settled by the next revision" />
      </div>
    </Form>
  );
}

/** Settles an open comment, saying how. */
export function CloseComment({ reviewId, commentId }: { reviewId: string; commentId: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-[11px] font-semibold text-link hover:underline">Settle</button>;
  return (
    <Form action={closeCommentAction} reviewId={reviewId} label="Settle it" tone="secondary">
      <input type="hidden" name="commentId" value={commentId} />
      <input name="resolution" className={inputCls} placeholder="How it was settled" />
    </Form>
  );
}

/** The answer on the open step. On the deciding step: a verdict and the status it grants. Otherwise: advice, read from one's comments. */
export function AnswerForm({ reviewId, deciding, verdicts, statuses }: { reviewId: string; deciding: boolean; verdicts: Opt[]; statuses: Opt[] }) {
  return (
    <Form action={answerAction} reviewId={reviewId} label={deciding ? "Give my verdict" : "Give my advice"}>
      {deciding ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Select name="verdict" options={verdicts} />
          <Select name="status" options={statuses} blank="No status (a verdict that does not proceed)" />
        </div>
      ) : <p className="text-xs text-slate-500">Your advice is read from your comments: none, some, or blocking.</p>}
      <textarea name="note" rows={2} className={inputCls} placeholder="A note (optional)" />
    </Form>
  );
}

/** For a step another organization answers in its own system: Document Control records that it was sent. */
export function DispatchForm({ reviewId, party }: { reviewId: string; party: string }) {
  return (
    <Form action={dispatchAction} reviewId={reviewId} label={`Record it as sent to ${party}`}>
      <div className="grid gap-2 sm:grid-cols-2">
        <input name="channel" className={inputCls} placeholder="How it went (their portal, email…)" />
        <input name="reference" className={inputCls} placeholder="Their reference (optional)" />
      </div>
    </Form>
  );
}

/** For that step: their answer as they wrote it, mapped to a verdict and status, with their own copy as proof. */
export function ProxyAnswerForm({ reviewId, party, verdicts, statuses }: { reviewId: string; party: string; verdicts: Opt[]; statuses: Opt[] }) {
  const [evidence, setEvidence] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-xs font-semibold text-slate-600">Their answer, as proof (their stamped copy, their letter)</p>
        {evidence ? <p className="text-xs text-emerald-700">Proof uploaded.</p> : (
          <FileUpload target={{ reviewId }} multiple={false} label="Upload the proof" onUploaded={async (ids) => { setEvidence(ids[0]); return null; }} />
        )}
      </div>
      <Form action={answerAction} reviewId={reviewId} label={`Record ${party}'s answer`}>
        <input type="hidden" name="evidenceFileId" value={evidence ?? ""} />
        <input name="foreignAnswer" className={inputCls} placeholder={`What ${party} wrote, in their words`} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Select name="verdict" options={verdicts} />
          <Select name="status" options={statuses} blank="No status" />
        </div>
      </Form>
    </div>
  );
}

/** Document Control's release of a decided review, with its outcome from its own list. */
export function ReleaseForm({ reviewId, outcomes }: { reviewId: string; outcomes: Opt[] }) {
  return (
    <Form action={releaseAction} reviewId={reviewId} label="Release">
      {outcomes.length ? <Select name="outcome" options={outcomes} /> : null}
    </Form>
  );
}

/** Document Control sends it back: to its author (a correction, or the next revision), or the route back to a step. */
export function ReturnForm({ reviewId, outcomes, steps, reasons }: { reviewId: string; outcomes: Opt[]; steps: Opt[]; reasons: Opt[] }) {
  return (
    <Form action={returnAction} reviewId={reviewId} label="Send back" tone="danger">
      <textarea name="note" rows={2} className={inputCls} placeholder="What is wrong (required)" />
      <Select name="toStep" options={steps} blank="To its author" />
      <div className="grid gap-2 sm:grid-cols-2">
        <Select name="outcome" options={outcomes} blank="Outcome: as the verdict says" />
        <Select name="reason" options={reasons} blank="Reason (needed to go back to a step)" />
      </div>
    </Form>
  );
}

/** Whoever holds the open step may send the route back to a step that answered, with a reason. */
export function RewindForm({ reviewId, steps, reasons }: { reviewId: string; steps: Opt[]; reasons: Opt[] }) {
  return (
    <Form action={rewindAction} reviewId={reviewId} label="Send the route back" tone="danger">
      <div className="grid gap-2 sm:grid-cols-2">
        <Select name="toStep" options={steps} />
        <Select name="reason" options={reasons} />
      </div>
      <input name="note" className={inputCls} placeholder="What happened" />
    </Form>
  );
}
