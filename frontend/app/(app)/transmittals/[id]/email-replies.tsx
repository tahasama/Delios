import Link from "next/link";
import { ActionForm } from "@/components/form";
import { Field, ToneChip, inputCls } from "@/components/ui";
import { fmtDateTime } from "@/lib/core/utils";
import type { EmailReply } from "@/lib/transmittals/api";
import { recordEmailReplyAction, setAsideEmailReplyAction } from "@/lib/transmittals/forms-email-replies";

/**
 * Replies by email to this transmittal, from an organization not on DELIOS: Document Control's to record as received
 * (a transmittal following this one, its files checked as anything that arrives) or to set aside, with why. Nothing
 * of a reply is filed by itself, and its files are not opened before the check.
 */
export function EmailReplies({ replies, transmittalId }: { replies: EmailReply[]; transmittalId: string }) {
  if (!replies.length) return null;
  const waiting = replies.filter((one) => one.state === "WAITING").length;
  return (
    <section id="email-replies" className="register register-sheet register-sheet-open">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span className="stencil mr-1 text-slate-500">Replies by email</span>
        <span className="text-[11px] text-slate-500">
          {waiting ? `${waiting} waiting: record it as received, or set it aside with why` : "each recorded as received, or set aside with why"}
        </span>
      </div>
      <ul className="divide-y divide-line">
        {replies.map((one) => (
          <li key={one.id} className="space-y-3 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-sm font-semibold text-slate-800">
                {one.subject || "No subject"}
                <span className="ml-1.5 text-xs font-normal text-slate-500">{one.fromName ? `${one.fromName}, ` : ""}{one.fromAddress} · {fmtDateTime(one.receivedAt)}</span>
              </p>
              {one.state === "WAITING" ? <ToneChip tone="waiting">to record</ToneChip>
                : one.state === "RECORDED" ? <ToneChip tone="done">recorded</ToneChip>
                : <ToneChip tone="idle">set aside</ToneChip>}
            </div>
            {one.text ? <p className="whitespace-pre-line text-xs leading-5 text-slate-600">{one.text}</p> : null}
            <div className="rounded-md bg-tint-soft px-3 py-2.5 text-xs leading-5 ring-1 ring-line">
              {one.files.length ? (
                <>
                  <p className="font-semibold text-slate-800">{one.files.length} file{one.files.length === 1 ? "" : "s"} came with it</p>
                  <ul>{one.files.map((file) => <li key={file.id} className="text-slate-600">{file.name} <span className="text-slate-400">({Math.max(1, Math.round(file.size / 1024))} KB)</span></li>)}</ul>
                  <p className="text-slate-500">Opened only once recorded and checked clean.</p>
                </>
              ) : <p className="text-slate-600">No files: the words are the reply.</p>}
            </div>
            {one.state === "RECORDED" && one.recordedTransmittalId ? (
              <p className="text-xs text-slate-600">
                Recorded by {one.handledByName}, {one.handledAt ? fmtDateTime(one.handledAt) : ""}:{" "}
                <Link href={`/transmittals/${one.recordedTransmittalId}`} className="font-semibold text-link hover:underline">the transmittal it became</Link>.
              </p>
            ) : null}
            {one.state === "SET_ASIDE" ? (
              <p className="whitespace-pre-line text-xs leading-5 text-slate-600">Set aside by {one.handledByName}, {one.handledAt ? fmtDateTime(one.handledAt) : ""}{"\n"}{one.setAsideReason}</p>
            ) : null}
            {one.state === "WAITING" ? (
              <div className="flex flex-wrap items-start gap-2">
                <ActionForm action={recordEmailReplyAction} submitLabel="Record it as received" size="sm" hidden={{ replyId: one.id }} className="space-y-0" />
                <details className="open:basis-full">
                  <summary className="ask">Set it aside</summary>
                  <div className="mt-2 max-w-xl">
                    <ActionForm action={setAsideEmailReplyAction} submitLabel="Set it aside" size="sm" variant="secondary" hidden={{ replyId: one.id, transmittalId }}>
                      <Field label="Why" required hint="kept with the reply, on this transmittal">
                        <textarea name="reason" rows={2} required className={inputCls} placeholder="not about this transmittal, a duplicate…" />
                      </Field>
                    </ActionForm>
                  </div>
                </details>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
