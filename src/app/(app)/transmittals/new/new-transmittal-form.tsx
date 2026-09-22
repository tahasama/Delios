"use client";

import { useState } from "react";
import { ActionForm } from "@/components/form";
import { Field, inputCls, Card } from "@/components/ui";
import { createTransmittalAction } from "@/lib/actions/transmittals";

type Opt = { code: string; label: string; props: Record<string, unknown> };
type RevOpt = { id: string; label: string; released: boolean };
type UserOpt = { id: string; name: string; role: string };
/** Anything the form can start filled in with — from a link such as "Send rev B to them". */
export type Prefill = { revisionIds?: string[]; userIds?: string[]; outsiders?: string; reason?: string; party?: string; subject?: string; message?: string };

/**
 * One column, in the order a person thinks: which way, why, what, to whom.
 * Fields that do not apply to the current choice are not shown — outgoing
 * lists only released revisions, and reviewers appear only when the reason
 * starts a review.
 */
export function NewTransmittalForm({
  reasons, revisions, users, reviewers, defaultDirection, preselectedRevisionIds, prefill,
}: {
  reasons: Opt[];
  revisions: RevOpt[];
  users: UserOpt[];
  reviewers: UserOpt[];
  defaultDirection: "OUTGOING" | "INCOMING";
  preselectedRevisionIds?: string[];
  prefill?: Prefill;
}) {
  const [direction, setDirection] = useState(defaultDirection);
  const [reasonCode, setReasonCode] = useState(prefill?.reason && reasons.some((r) => r.code === prefill.reason) ? prefill.reason : "");
  const needsReview = reasons.find((r) => r.code === reasonCode)?.props.reviewCycle === true;
  const choices = direction === "OUTGOING" ? revisions.filter((r) => r.released) : revisions;

  return (
    <Card className="max-w-3xl">
      <ActionForm action={createTransmittalAction} submitLabel={direction === "OUTGOING" ? "Create transmittal" : "Record receipt"}>
        <div className="flex gap-2">
          {(["OUTGOING", "INCOMING"] as const).map((d) => (
            <label key={d} className={`cursor-pointer rounded-lg border px-3 py-2 text-xs font-medium ${direction === d ? "border-brand-line bg-tint text-brand-ink" : "border-slate-300 text-slate-500"}`}>
              <input type="radio" name="direction" value={d} checked={direction === d} onChange={() => setDirection(d)} className="mr-1.5" />
              {d === "OUTGOING" ? "We are sending" : "We received"}
            </label>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={direction === "OUTGOING" ? "Sent to" : "Received from"} required>
            <input name="issuingParty" required className={inputCls} placeholder="Company name" defaultValue={prefill?.party ?? ""} />
          </Field>
          <Field label="Why" required hint="what the recipient should do with it">
            <select name="reasonForIssue" required className={inputCls} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              <option value="" disabled>Choose…</option>
              {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </Field>
          <Field label={direction === "OUTGOING" ? "Date sent" : "Date received"} required>
            <input type="date" name="dateOfIssue" required className={inputCls} defaultValue={new Date().toISOString().slice(0, 10)} />
          </Field>
          {direction === "INCOMING" ? (
            <Field label="Note">
              <input name="notes" className={inputCls} placeholder="optional" />
            </Field>
          ) : null}
        </div>

        {direction === "OUTGOING" ? (
          <>
            <Field label="Subject" required hint="what the recipient reads first">
              <input name="subject" required className={inputCls} defaultValue={prefill?.subject ?? ""} placeholder="Pump house — ventilation layout, rev B for construction" />
            </Field>
            <Field label="Message" hint="optional — anything the recipients should know about these documents">
              <textarea name="message" rows={4} className={inputCls} defaultValue={prefill?.message ?? ""} placeholder="Please find enclosed…" />
            </Field>
          </>
        ) : null}

        <Field label="Documents" required hint={direction === "OUTGOING" ? "only released revisions can be sent — Ctrl/Cmd-click for several" : "Ctrl/Cmd-click for several"}>
          <select name="revisionIds" multiple className={`${inputCls} h-40`} defaultValue={[...(preselectedRevisionIds ?? []), ...(prefill?.revisionIds ?? [])]}>
            {choices.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="People here who get a copy">
            <select name="recipientUsers" multiple className={`${inputCls} h-28`} defaultValue={prefill?.userIds ?? []}>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="Outside recipients" hint="one per line: name (company)">
            <textarea name="recipientNames" rows={4} className={inputCls} defaultValue={prefill?.outsiders ?? ""} placeholder={"John Doe (MADASUD)\nA. Smith (ECGS)"} />
          </Field>
        </div>

        {needsReview ? (
          <Field label="Reviewers" hint="this reason starts a review of each document">
            <select name="reviewerIds" multiple className={`${inputCls} h-24`} defaultValue={[]}>
              {reviewers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        ) : null}

        {direction === "INCOMING" ? <p className="text-[11px] text-slate-500">You will check and accept it on the next screen; any reply period starts from acceptance.</p> : null}
      </ActionForm>
    </Card>
  );
}
