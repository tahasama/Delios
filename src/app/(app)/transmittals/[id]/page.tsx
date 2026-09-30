import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { notFound } from "next/navigation";
import { isController, isAdmin } from "@/lib/auth";
import { Card, Chip, Banner } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { ACCEPTANCE_CONDITIONS, ENCLOSURE_CONDITIONS, REASON_LABEL, type ReasonForIssue } from "@/lib/standard";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import {
  issueTransmittalAction,
  acceptanceCheckAction,
  chaseTransmittalAction,
} from "@/lib/actions/transmittals";
import { preflight } from "@/lib/rules/preflight";
import { PreflightPanel, Guarded } from "@/components/preflight";
import { ReceiptTracker } from "./receipt-tracker";
import { CarriedTable, type CarriedRow } from "./carried-table";
import { Timeline } from "@/components/timeline";
import { SendForReview } from "@/components/send-for-review-panel";
import { ArrowLeft } from "lucide-react";
import { getActiveSet } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * One transmittal, in the detail style.
 *
 * A transmittal is an act, not a folder: named documents went to named people
 * on a day, for a stated reason, and something is expected back. So the page is
 * ordered as that act is read — what it is and what it carries, who was asked
 * and who was only told, what came back, and what was done about it on arrival
 * — with the whole history beside it.
 *
 * Nothing that was recorded is hidden to make the page tidy: the acceptance
 * check keeps its condition-by-condition answer, and what Document Control
 * wrote when they accepted it is shown where they wrote it.
 */
export default async function TransmittalDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ issueError?: string }> }) {
  const { user, db } = await requireScope();
  const { id } = await params;
  const sp = await searchParams;
  const t = await db.transmittal.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          revision: {
            include: {
              files: { select: { id: true, name: true, kind: true } },
              document: {
                include: {
                  revisions: { orderBy: { createdAt: "desc" }, take: 1, select: { value: true } },
                  baselineEntries: { include: { action: { select: { code: true, name: true } } } },
                },
              },
            },
          },
        },
      },
      recipients: { orderBy: [{ kind: "asc" }, { name: "asc" }] },
      // The thread: what this answers, and what has come back against it. An
      // answer is a transmittal of its own, with its own number and its own
      // enclosures, so it is linked to rather than copied in here.
      inReplyTo: { select: { id: true, number: true, subject: true } },
      answers: {
        orderBy: { dateOfIssue: "asc" },
        select: {
          id: true, number: true, subject: true, dateOfIssue: true, status: true,
          createdByName: true, issuingParty: true, direction: true,
          _count: { select: { items: true } },
        },
      },
      cycles: { select: { id: true, status: true, revisionId: true, submittedAt: true } },
      issueRequests: { select: { id: true, reason: true, note: true } },
    },
  });
  if (!t) notFound();

  const controller = isController(user) || isAdmin(user);
  const mine = t.recipients.find((recipient) => recipient.userId === user.id) ?? null;
  const conditions: { key: string; pass: boolean; notApplicable?: boolean }[] = t.conditionsResult ? JSON.parse(t.conditionsResult) : [];
  const readyToRoute = t.items.filter((one) => one.revision.state === "IN_PREPARATION").map((one) => one.revisionId);
  // Whether the reason it was sent for asks for a review at all (§11.11). Where
  // it does not, acceptance is the end of it and "Sent for review" is skipped.
  const reviewExpected = ((await getActiveSet("REASONS_FOR_ISSUE")).find((one) => one.code === t.reasonForIssue)?.props as Record<string, unknown> | undefined)?.reviewCycle === true;

  // Addressed to, and copied in. Seen is read from the first list only: being
  // copied in is being told, not being asked, so a transmittal is not seen
  // because somebody kept informed happened to look at it.
  const addressed = t.recipients.filter((one) => one.kind !== "CC");
  const copied = t.recipients.filter((one) => one.kind === "CC");
  const seen = addressed.filter((one) => one.openedAt).length;
  const allSeen = addressed.length > 0 && seen === addressed.length;
  const waiting = addressed.filter((one) => !one.openedAt && one.userId);

  const replyOverdue = !t.answers.length && t.responseRequired && !!t.responseDueDate && t.responseDueDate.getTime() < Date.now();
  // Anybody it reached may answer it — the people it was addressed to, the
  // people copied in who have a question of their own, and whoever raised it.
  const replyHref = `/transmittals/new?replyTo=${t.id}`;

  // How often each of these documents has gone out before this transmittal —
  // the third issue of a drawing is a fact about the drawing, not a detail.
  const documentIds = [...new Set(t.items.map((one) => one.revision.documentId))];
  const earlier = documentIds.length
    ? await db.transmittalItem.findMany({
        where: {
          revision: { documentId: { in: documentIds } },
          transmittalId: { not: t.id },
          transmittal: { dateOfIssue: { lt: t.dateOfIssue }, status: { not: "DRAFT" } },
        },
        select: { revision: { select: { documentId: true } } },
      })
    : [];
  const sentBefore = new Map<string, number>();
  for (const one of earlier) {
    sentBefore.set(one.revision.documentId, (sentBefore.get(one.revision.documentId) ?? 0) + 1);
  }

  const reason = (REASON_LABEL[t.reasonForIssue as ReasonForIssue] ?? t.reasonForIssue).toLowerCase();
  const statusColors: Record<string, string> = {
    DRAFT: "bg-slate-100 text-slate-600 ring-slate-300",
    ISSUED: "bg-amber-100 text-amber-800 ring-amber-300",
    ACCEPTED: "bg-emerald-100 text-emerald-800 ring-emerald-300",
    REJECTED: "bg-red-100 text-red-800 ring-red-300",
  };

  const carried: CarriedRow[] = t.items.map((item) => {
    const cycle = t.cycles.find((one) => one.revisionId === item.revisionId) ?? null;
    const files = item.revision.files;
    const current = item.revision.document.revisions[0]?.value ?? null;
    return {
      id: item.id,
      documentId: item.revision.documentId,
      docNumber: item.revision.document.docNumber,
      title: item.revision.document.title,
      revision: item.revision.value,
      status: item.revision.statusCode ?? item.revision.state.replaceAll("_", " ").toLowerCase(),
      neededFor: [...new Map(item.revision.document.baselineEntries.map((entry) => [entry.action.code, entry.action])).values()],
      pdfId: files.find((one) => one.kind === "STAMPED")?.id ?? files.find((one) => one.kind === "RENDITION")?.id ?? null,
      nativeId: files.find((one) => one.kind === "NATIVE")?.id ?? null,
      nativeName: files.find((one) => one.kind === "NATIVE")?.name ?? null,
      supersededSince: item.markedSuperseded || (!!current && current !== item.revision.value),
      currentRevision: current,
      sentBefore: sentBefore.get(item.revision.documentId) ?? 0,
      reviewId: cycle?.id ?? null,
      reviewOpen: cycle?.status === "OPEN",
    };
  });

  return (
    <div className="space-y-4">
      {mine && t.status !== "DRAFT" ? <ReceiptTracker transmittalId={t.id} /> : null}

      <CarriedTable
        rows={carried}
        exportHref={`/api/export/transmittals?ids=${t.id}`}
        plate={
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 pt-6 pb-3 sm:px-6">
            <div className="min-w-0">
              <h1 className="plate-name min-w-0">
                <span className="font-mono text-[0.8em] font-medium tracking-tight text-slate-400">{t.number}</span>
                {t.subject ? <> {t.subject}</> : null}
              </h1>
              {/* Who, to whom, when, and what for — the sentence a transmittal
                  register entry is, said as facts rather than as prose. */}
              <p className="plate-meta mt-1.5">
                {t.direction === "OUTGOING"
                  ? <>{t.createdByName} sent it {fmtDate(t.dateOfIssue)} to {addressed.map((one) => one.name).join(", ") || "nobody yet"}</>
                  : <>{t.issuingParty} sent it {fmtDate(t.dateOfIssue)}{t.receivedDate ? <>, and it arrived {fmtDate(t.receivedDate)}</> : null}</>}
                {" "}&middot; {t.items.length} document{t.items.length === 1 ? "" : "s"} &middot; for {reason}
              </p>
              <p className="mt-1 max-w-2xl text-[11.5px] leading-4 text-slate-400">
                {[...new Set(addressed.map((one) => one.organization).filter(Boolean))].join(", ") || (t.direction === "INCOMING" ? t.issuingParty : "no company named")}
                {copied.length ? <> &middot; {copied.length} copied in: {copied.map((one) => one.name).join(", ")}</> : null}
                {" · "}
                {t.status === "DRAFT"
                  ? "Nothing has been sent yet — it carries no date of issue until it is issued."
                  : t.responseRequired
                    ? t.answers.length
                      ? `Answered ${fmtDate(t.answers[0].dateOfIssue)} by ${t.answers[0].number}.`
                      : `An answer is due by ${fmtDate(t.responseDueDate)} — write it down under “The answer”.`
                    : "No answer is needed. Opening it is the receipt."}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Link href="/transmittals" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Transmittals</Link>
              <Link href={`/?view=log&q=${encodeURIComponent(t.number)}`} className="text-[11px] font-semibold text-link hover:underline" title="What has happened to this transmittal, in the project's own log">What is going on &rarr;</Link>
              <Link href={`/admin/audit?q=${encodeURIComponent(t.number)}`} className="text-[11px] font-semibold text-link hover:underline" title="Every recorded act on this transmittal, in the audit trail">History &rarr;</Link>
              <Chip className={statusColors[t.status] ?? ""}>{t.status.toLowerCase()}</Chip>
              {t.status === "DRAFT" && controller ? (
                <Guarded result={await preflight("ISSUE", { transmittalId: t.id })}>
                  <ActionForm action={issueTransmittalAction} submitLabel="Issue" size="sm" hidden={{ transmittalId: t.id }} />
                </Guarded>
              ) : null}
            </div>
          </div>
        }
      />

      {sp.issueError ? <Banner tone="warn" title="Created, but not sent">{sp.issueError} Issue it above once that is settled.</Banner> : null}
      {t.status === "REJECTED" ? (
        <Banner tone="danger" title="Rejected">{t.rejectionReason} — the documents it carried were not accepted, and no review has started.</Banner>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          {t.message || t.issueRequests.length ? (
            <section className="register register-sheet register-sheet-open">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
                <span className="stencil mr-1 text-slate-400">Why it was sent</span>
                <span className="text-[11px] text-slate-400">the reason for issue, and what was written to them</span>
                <span className="ml-auto text-[11px] font-medium text-slate-500">for {reason}</span>
              </div>
              {t.message ? (
                <p className="whitespace-pre-line px-5 py-3.5 text-sm leading-relaxed text-slate-700 sm:px-6">{t.message}</p>
              ) : null}
              {t.issueRequests.length ? (
                <p className="border-t border-line px-5 py-2 text-[11px] text-slate-400 sm:px-6">
                  Raised from {t.issueRequests.length} issue request{t.issueRequests.length === 1 ? "" : "s"} — whoever released the revision asked for it to go out.
                  {t.issueRequests.map((one) => one.note).filter(Boolean).length
                    ? <> They said: {t.issueRequests.map((one) => one.note).filter(Boolean).join(" · ")}</>
                    : null}
                </p>
              ) : null}
            </section>
          ) : null}

          {/* Who it went to, who was kept informed, whether they looked — and
              the one thing anybody does about somebody who has not. */}
          <section id="people" className="register register-sheet register-sheet-open">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
              <span className="stencil mr-1 text-slate-400">Sent to</span>
              <span className="text-[11px] text-slate-400">
                opening it while signed in is the receipt &mdash; copies are told, not asked
              </span>
              <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-500">
                {allSeen ? "all seen" : `${seen} of ${addressed.length} seen`}
                {copied.length ? <span className="ml-1.5 font-sans text-slate-400">+{copied.length} copied in</span> : null}
              </span>
            </div>
            <ul className="divide-y divide-line">
              {[...addressed, ...copied].map((person) => (
                <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 sm:px-6">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700">
                      {person.name}
                      {person.organization ? <span className="font-normal text-slate-400"> &middot; {person.organization}</span> : null}
                      {person.kind === "CC" ? <span className="ml-1.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">copy</span> : null}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {person.openedAt
                        ? <>Opened it {fmtDateTime(person.openedAt)}{person.viewCount > 1 ? <>, and {person.viewCount} times since &mdash; last {fmtDateTime(person.lastViewedAt ?? person.openedAt)}</> : null}</>
                        : person.notifiedAt
                          ? <>Told {fmtDateTime(person.notifiedAt)} &mdash; not opened yet</>
                          : "Waiting to be issued"}
                    </p>
                  </div>
                  {person.openedAt ? (
                    <Chip className={person.kind === "CC" ? "bg-slate-100 text-slate-600 ring-slate-200" : "bg-emerald-100 text-emerald-800 ring-emerald-300"}>seen</Chip>
                  ) : person.notifiedAt ? (
                    <Chip className="bg-amber-100 text-amber-800 ring-amber-300">told</Chip>
                  ) : (
                    <Chip className="bg-slate-100 text-slate-500 ring-slate-200">not sent yet</Chip>
                  )}
                </li>
              ))}
            </ul>
            {controller && waiting.length && t.status !== "DRAFT" ? (
              <ActionForm action={chaseTransmittalAction} hideSubmit hidden={{ transmittalId: t.id }}>
                <div className="asking flex flex-wrap items-center gap-3 px-5 py-3 sm:px-6">
                  <span className="text-[11px] text-slate-500">
                    {waiting.length === 1 ? `${waiting[0].name} has` : `${waiting.length} of them have`} not opened it. Telling them again is recorded.
                  </span>
                  <button className="ask ml-auto">Tell them again</button>
                </div>
              </ActionForm>
            ) : null}
          </section>

          {/* What came back. Each answer is correspondence in its own right, so
              this says what they are and where they are, and does not try to
              hold them. */}
          {t.status !== "DRAFT" ? (
            <section id="reply" className="register register-sheet register-sheet-open">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
                <span className="stencil mr-1 text-slate-400">The exchange</span>
                <span className={`text-[11px] ${replyOverdue ? "font-semibold text-red-700" : "text-slate-400"}`}>
                  {t.answers.length
                    ? `${t.answers.length} answer${t.answers.length === 1 ? "" : "s"} came back against it`
                    : t.responseRequired
                      ? replyOverdue
                        ? `an answer was due ${fmtDate(t.responseDueDate)} and none has come back`
                        : `an answer is due by ${fmtDate(t.responseDueDate)}`
                      : "no answer is owed — anybody it reached may still send one"}
                </span>
                <Link href={replyHref} className="ask ml-auto">Reply</Link>
              </div>

              {t.inReplyTo ? (
                <p className="border-b border-line px-5 py-2 text-[11px] text-slate-500 sm:px-6">
                  This is itself an answer to{" "}
                  <Link href={`/transmittals/${t.inReplyTo.id}`} className="font-mono font-semibold text-link hover:underline">{t.inReplyTo.number}</Link>
                  {t.inReplyTo.subject ? <> &mdash; {t.inReplyTo.subject}</> : null}.
                </p>
              ) : null}

              {t.answers.length ? (
                <ul className="divide-y divide-line">
                  {t.answers.map((answer) => (
                    <li key={answer.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 sm:px-6">
                      <div className="min-w-0">
                        <p className="text-sm">
                          <Link href={`/transmittals/${answer.id}`} className="doc-number">{answer.number}</Link>
                          {answer.subject ? <span className="ml-2 font-medium text-slate-700">{answer.subject}</span> : null}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {answer.direction === "OUTGOING" ? answer.createdByName : answer.issuingParty} &middot; {fmtDate(answer.dateOfIssue)}
                          {answer._count.items ? <> &middot; {answer._count.items} document{answer._count.items === 1 ? "" : "s"}</> : <> &middot; words only</>}
                        </p>
                      </div>
                      <Chip className={statusColors[answer.status] ?? ""}>{answer.status.toLowerCase()}</Chip>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-3.5 text-xs text-slate-500 sm:px-6">
                  Nothing has come back yet. An answer is a transmittal of its own — Reply opens one addressed to whoever sent this,
                  with the people copied in carried over, and you can change any of that before it goes.
                </p>
              )}
            </section>
          ) : null}

          {/* The check on arrival: the five conditions, the answer to each, and
              who gave it. Kept whole — it is the evidence that what arrived was
              fit to be used, and an audit reads it condition by condition. */}
          {t.direction === "INCOMING" || conditions.length ? (
            <section id="check" className="register register-sheet register-sheet-open">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
                <span className="stencil mr-1 text-slate-400">Checked on arrival</span>
                <span className="text-[11px] text-slate-400">
                  {conditions.length
                    ? <>{t.checkedByName}, {fmtDate(t.acceptanceCheckedAt)}</>
                    : "right documents, complete, readable, correctly numbered — accept to send it on to review, reject to return it"}
                </span>
                {conditions.length ? (
                  <span className={`ml-auto font-mono text-[11px] tabular-nums ${conditions.every((one) => one.pass) ? "text-emerald-700" : "text-red-700"}`}>
                    {conditions.filter((one) => one.pass).length}/{conditions.length} passed
                  </span>
                ) : null}
              </div>

              <ul className="divide-y divide-line">
                {ACCEPTANCE_CONDITIONS.map((condition) => {
                  const answer = conditions.find((one) => one.key === condition.key);
                  return (
                    <li key={condition.key} className="flex items-start gap-2.5 px-5 py-2 text-xs sm:px-6">
                      <span className={`mt-0.5 font-semibold ${!answer ? "text-slate-300" : answer.notApplicable ? "text-slate-400" : answer.pass ? "text-emerald-600" : "text-red-600"}`}>
                        {!answer ? "·" : answer.notApplicable ? "—" : answer.pass ? "✓" : "✗"}
                      </span>
                      <span className="text-slate-600">
                        {condition.label}
                        {answer?.notApplicable ? <span className="text-slate-400"> — nothing was enclosed, so this was not asked</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {t.acceptanceNotes ? (
                <p className="border-t border-line px-5 py-2 text-[11px] text-slate-500 sm:px-6">
                  They wrote: <span className="text-slate-700">{t.acceptanceNotes}</span>
                </p>
              ) : null}

              {t.direction === "OUTGOING" && !conditions.length ? (
                <p className="border-t border-line px-5 py-2 text-[11px] text-slate-400 sm:px-6">
                  Their document control runs this same check on what we send. Anything failing comes back with a reason.
                </p>
              ) : null}

              {t.direction === "INCOMING" && t.status === "ISSUED" ? (
                controller ? (
                  <div className="border-t border-line px-5 py-3.5 sm:px-6">
                    <PreflightPanel result={await preflight("ACCEPT_TRANSMITTAL", { transmittalId: t.id })} className="mb-3" />
                    <ActionForm action={acceptanceCheckAction} hideSubmit hidden={{ transmittalId: t.id }}>
                      <div className="asking grid grid-cols-1 gap-x-4 gap-y-2.5">
                        {ACCEPTANCE_CONDITIONS
                          .filter((condition) => t.items.length > 0 || !(ENCLOSURE_CONDITIONS as readonly string[]).includes(condition.key))
                          .map((condition) => (
                            <label key={condition.key} className="flex items-start gap-2 text-xs font-medium text-slate-700">
                              <input type="checkbox" name={`cond_${condition.key}`} className="mt-0.5" />
                              {condition.label}
                            </label>
                          ))}
                        <label className="min-w-0">
                          <span className="sr-only">Note, or the reason it is rejected</span>
                          <input name="notes" className="plain w-full" placeholder="A note — or, if anything above is unticked, why it is going back; the sender reads this" />
                        </label>
                        <div className="flex justify-end">
                          <button className="ask">Record the check</button>
                        </div>
                      </div>
                    </ActionForm>
                    <p className="mt-2 text-[11px] text-slate-400">
                      Every condition ticked accepts it and starts the response period. Anything left unticked returns it to the sender with your reason.
                    </p>
                  </div>
                ) : (
                  <p className="border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">Document Control checks what arrives.</p>
                )
              ) : null}
            </section>
          ) : null}

          {t.direction === "INCOMING" && t.status === "ACCEPTED" && controller && readyToRoute.length ? (
            <section className="register register-sheet register-sheet-open">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
                <span className="stencil mr-1 text-slate-400">Send for review</span>
                <span className="text-[11px] text-slate-400">
                  {readyToRoute.length} accepted document{readyToRoute.length === 1 ? "" : "s"} waiting to be routed
                </span>
              </div>
              <div className="px-5 py-3.5 sm:px-6">
                <SendForReview revisionIds={readyToRoute} />
              </div>
            </section>
          ) : null}
        </div>

        {/* What has happened to it, and what is still to come. */}
        <aside>
          <Card title="Progress">
            <Timeline
              points={t.direction === "OUTGOING" ? [
                { label: "Raised", at: t.createdAt, holder: t.createdByName },
                { label: "Issued — they were told", at: t.status === "DRAFT" ? null : t.dateOfIssue, holder: t.status === "DRAFT" ? "nothing has been sent yet" : t.createdByName },
                {
                  label: "Seen",
                  at: addressed.map((one) => one.openedAt).filter(Boolean).sort((x, y) => x!.getTime() - y!.getTime())[0] ?? null,
                  holder: `${seen} of ${addressed.length} it was addressed to`,
                },
                ...(t.responseRequired || t.answers.length ? [{
                  label: t.answers.length ? "Answered" : "An answer is due",
                  at: t.answers[0]?.dateOfIssue ?? null,
                  holder: t.answers.length ? t.answers[0].number : t.responseDueDate ? fmtDate(t.responseDueDate) : "no date",
                }] : []),
              ] : [
                { label: "They sent it", at: t.dateOfIssue, holder: t.issuingParty },
                { label: "It arrived", at: t.receivedDate, holder: t.receivedByParty ?? null },
                {
                  label: "Checked on arrival",
                  at: t.acceptanceCheckedAt,
                  holder: t.checkedByName ?? null,
                  detail: t.status === "REJECTED" ? t.rejectionReason : t.acceptanceNotes,
                },
                { label: "Sent for review", at: t.cycles[0]?.submittedAt ?? null, holder: t.cycles.length ? `${t.cycles.length} review${t.cycles.length === 1 ? "" : "s"}` : null, skipped: t.status === "ACCEPTED" && !t.cycles.length && !reviewExpected },
                ...(t.responseRequired || t.answers.length ? [{
                  label: t.answers.length ? "Answered" : "An answer is due",
                  at: t.answers[0]?.dateOfIssue ?? null,
                  holder: t.answers.length ? t.answers[0].number : t.responseDueDate ? fmtDate(t.responseDueDate) : "no date",
                }] : []),
              ]}
            />
          </Card>
        </aside>
      </div>
    </div>
  );
}
