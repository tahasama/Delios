import Link from "next/link";
import { Chip, StateChip, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { REV_STATE_COLOR, type RevState } from "@/lib/core/standard";
import { fmtDate } from "@/lib/core/utils";
import {
  voidRevisionAction, unvoidRevisionAction
} from "@/lib/forms/revisions";
import { type LegacyRevision } from "@/lib/api/legacy";
import { withdrawApprovalAction } from "@/lib/forms/governance";
import { ChevronRight } from "lucide-react";

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-6 text-center text-xs text-slate-400">{children}</p>;
}

export function UsedIn({ kind, href, code, text, children }: { kind: string; href: string; code: string; text: string; children?: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-2 py-2.5">
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{kind}</p>
        <Link href={href} className="font-mono text-xs font-bold text-link hover:underline">{code}</Link>
        <p className="truncate text-xs text-slate-600">{text}</p>
      </div>
      {children}
    </li>
  );
}

export function prettyState(value: string) { return value.replaceAll("_", " ").toLowerCase(); }

export type RevData = LegacyRevision;

/** One line per revision; its record and its per-revision controls open in place. */
export function RevisionRow({ rev, latest, followedBy, statusLabel, stateLabel, controller, userId, userRole, voidIsControl, held = false }: { rev: RevData; latest: boolean; followedBy: { value: string; why: string | null } | null; statusLabel: string | null; stateLabel: string; controller: boolean; userId: string; userRole: string; voidIsControl: boolean; held?: boolean }) {
  const state = rev.state as RevState;
  const pdf = rev.files.find((f) => f.kind === "RENDITION");
  const native = rev.files.find((f) => f.kind === "NATIVE");
  const approval = rev.approvals[0];
  const facts: [string, string | null][] = [
    ["Why", rev.reasonForRevision],
    ["What changed", rev.changeDescription],
    ["Phase", rev.phase],
    ["Due", rev.plannedSubmissionDate ? fmtDate(rev.plannedSubmissionDate) : null],
    ["Issued", rev.issueDate ? fmtDate(rev.issueDate) : null],
    ["Authorised", rev.authorizationReason ? `${rev.authorizationReason}${rev.authorizedByName ? ` — ${rev.authorizedByName}` : ""}` : null],
  ];

  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-slate-50">
          <ChevronRight className="h-3.5 w-3.5 text-slate-400 transition group-open:rotate-90" />
          <span className="font-mono text-sm font-bold text-slate-900">Rev {rev.value}</span>
          <StateChip label={stateLabel} color={REV_STATE_COLOR[state] ?? ""} />
          {rev.statusCode ? <span className="text-xs text-slate-500">{rev.statusCode} · {statusLabel}</span> : null}
          <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{rev.changeDescription ?? ""}</span>
          <span className="text-[11px] text-slate-400">{fmtDate(rev.releasedAt ?? rev.createdAt)}</span>
          {/* Why the next one exists, kept with this one: read where it is
              asked, without opening the next revision. */}
          {followedBy?.why ? (
            <span className="basis-full pl-6 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-600">Rev {followedBy.value} followed</span> — {followedBy.why}
            </span>
          ) : null}
        </summary>
        <div className="space-y-3 bg-slate-50/60 px-5 py-4 pl-11">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {facts.filter(([, v]) => v).map(([k, v]) => (
              <div key={k}><dt className="text-[11px] text-slate-400">{k}</dt><dd className="text-xs text-slate-800">{v}</dd></div>
            ))}
          </dl>

          {/* Each submission Document Control judged, with what it said when it sent one back. */}
          {rev.backend.submissions.some((one) => one.note) ? (
            <ul className="space-y-1 text-xs leading-5">
              {rev.backend.submissions.filter((one) => one.note).map((one) => (
                <li key={one.number} className="whitespace-pre-line text-slate-600">
                  <span className="font-semibold text-slate-800">Submission {one.number}</span>
                  {one.outcome ? ` · ${prettyState(one.outcome)}` : ""}{one.decidedBy ? ` by ${one.decidedBy}` : ""}{one.decidedAt ? `, ${fmtDate(one.decidedAt)}` : ""}: {one.note}
                </li>
              ))}
            </ul>
          ) : null}

          {/* On hold, and why: kept on the row once a later revision is the one shown at the top. */}
          {rev.heldAt && rev.heldReason ? (
            <p className="whitespace-pre-line text-xs leading-5 text-red-800">
              <span className="font-semibold">On hold</span> since {fmtDate(rev.heldAt)}{rev.heldByName ? ` by ${rev.heldByName}` : ""}: {rev.heldReason}
            </p>
          ) : null}

          {/* The void on this revision, and its taking back, each with who, when and why. */}
          {rev.voidReason && rev.voidedAt ? (
            <div className="space-y-1 text-xs leading-5">
              <p className={`whitespace-pre-line ${state === "VOID" ? "text-red-800" : "text-slate-500"}`}>
                <span className="font-semibold">Voided</span> {fmtDate(rev.voidedAt)}{rev.voidAuthority ? ` by ${rev.voidAuthority}` : ""}: {rev.voidReason}
                {rev.voidReassessment ? <span className="block text-slate-600">Impact on work already done: {rev.voidReassessment}</span> : null}
              </p>
              {state !== "VOID" && rev.backend.unvoided ? (
                <p className="whitespace-pre-line text-emerald-800">
                  <span className="font-semibold">Void taken back</span> {fmtDate(rev.backend.unvoided.at)} by {rev.backend.unvoided.by}: {rev.backend.unvoided.reason}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 text-xs">
            {pdf ? <a href={`/api/files/${pdf.id}`} target="_blank" className="font-semibold text-link hover:underline">PDF</a> : <span className="text-slate-400">no PDF</span>}
            {native ? <a href={`/api/files/${native.id}?dl=1`} className="font-semibold text-link hover:underline">Source file</a> : null}
          </div>


          {approval ? (
            <p className="text-xs text-slate-600">
              {approval.withdrawnAt
                ? <><span className="font-semibold text-red-700">Approval withdrawn</span> by {approval.withdrawnBy}, {fmtDate(approval.withdrawnAt)} — {approval.withdrawnReason}</>
                : <><span className="font-semibold text-slate-800">Approved</span> by {approval.approverName}, {fmtDate(approval.decidedAt)}</>}
            </p>
          ) : null}

          {approval && !approval.withdrawnAt && latest && controller ? (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-red-700">Withdraw this approval…</summary>
              <div className="mt-2 max-w-md">
                <ActionForm action={withdrawApprovalAction} submitLabel="Withdraw approval" variant="danger" size="sm" hidden={{ revisionId: rev.id }}>
                  <input name="reason" required className={inputCls} placeholder="Why, and who asked for it" />
                </ActionForm>
              </div>
            </details>
          ) : null}

          {/* Voiding is for the newest revision only: a revision already
              replaced is frozen as it was issued, and voiding it would change
              nothing anybody works from.

              Two occasions. One that was released in error, which somebody may
              already have worked from. And one that was never reviewed at all —
              opened, left, and now in the way of the next one: voiding it says
              it never counted, which is the truth, and clears the document. */}
          {/* A void taken back, with a reason: only the newest revision, not while held. */}
          {!held && controller && latest && state === "VOID" ? (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-slate-600">Take the void back…</summary>
              <div className="mt-2 max-w-md">
                <ActionForm action={unvoidRevisionAction} submitLabel="Take the void back" size="sm" variant="secondary" hidden={{ revisionId: rev.id }}>
                  <p className="text-xs text-slate-600">Rev {rev.value} counts again, as {rev.releasedAt ? "released" : "in preparation"}. Everyone who received it is told.</p>
                  <Field label="Why" required><input name="reason" required className={inputCls} placeholder="e.g. Voided against the wrong revision" /></Field>
                </ActionForm>
              </div>
            </details>
          ) : null}
          {!held && (controller || (!voidIsControl && (rev.authoredById === userId || rev.uploadedById === userId))) && latest && (state === "RELEASED" || (state === "IN_PREPARATION" && !rev.cycles.length)) ? (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-red-700">{state === "RELEASED" ? "Void — issued in error…" : "Void — it was never reviewed…"}</summary>
              <div className="mt-2 max-w-md">
                <ActionForm action={voidRevisionAction} submitLabel="Void revision" variant="danger" size="sm" hidden={{ revisionId: rev.id }}>
                  <Field label="Reason" required><input name="voidReason" className={inputCls} placeholder="e.g. issued against the wrong contract" /></Field>
                  <Field label="Impact on work already done" hint="can be added later"><input name="reassessment" className={inputCls} /></Field>
                </ActionForm>
              </div>
            </details>
          ) : null}

          {state === "SUPERSEDED" ? <Chip className="bg-violet-50 text-violet-700 ring-violet-200">replaced — do not use</Chip> : null}
          {state === "VOID" ? <Chip className="bg-red-50 text-red-700 ring-red-200">void — never valid</Chip> : null}
        </div>
      </details>
    </li>
  );
}
