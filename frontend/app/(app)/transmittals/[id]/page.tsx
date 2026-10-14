import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { notFound } from "next/navigation";
import { isController, isAdmin } from "@/lib/core/auth";
import { Card, Chip, Banner } from "@/components/ui";
import { TONE } from "@/lib/core/tones";
import { ActionForm } from "@/components/form";
import { REASON_LABEL, type ReasonForIssue } from "@/lib/core/standard";
import { fmtDate, fmtDateTime } from "@/lib/core/utils";
import {
  issueTransmittalAction,
  acceptTransmittalAction,
  attachTransmittalFilesAction,
  chaseTransmittalAction,
  markRecipientSentAction,
} from "@/lib/transmittals/forms";
import { preflight } from "@/lib/conformance/rules/preflight";
import { PreflightPanel } from "@/components/preflight";
import { ReceiptTracker } from "./receipt-tracker";
import { NotifyAgain } from "./notify-again";
import { CarriedTable, type CarriedRow } from "./carried-table";
import { Timeline } from "@/components/timeline";
import { SendForReview } from "@/components/send-for-review-panel";
import { ArrowLeft } from "lucide-react";
import { getActiveSet } from "@/lib/settings/config";
import { carriersOf as carriersOfTransmittal, transmittalPage, emailReplies } from "@/lib/transmittals/api";
import { EmailReplies } from "./email-replies";
import { activityDetail } from "@/lib/actions/api";

export const dynamic = "force-dynamic";

/**
 * One transmittal, in the detail style.
 *
 * A transmittal is an act, not a folder: named documents went to named people
 * on a day, for a stated reason, and something is expected back. So the page is
 * ordered as that act is read — what it is and what it carries, who was asked
 * and who was only kept informed, what came back, and what was done about it on arrival
 * — with the whole history beside it.
 *
 * Nothing that was recorded is hidden to make the page tidy: the acceptance
 * check keeps its condition-by-condition answer, and what Document Control
 * wrote when they accepted it is shown where they wrote it.
 */
export default async function TransmittalDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ issueError?: string }> }) {
  const ctx = await requireScope();
  const { user } = ctx;
  const { id } = await params;
  const sp = await searchParams;
  const page = await transmittalPage(ctx, id);
  if (!page) notFound();
  const t = page.transmittal;
  const status = page.status;
  const incoming = t.direction === "INCOMING";
  // The reviews it led to, one per document at most.
  const reviews = page.carried.flatMap((one) => (one.review ? [one.review] : []));

  const controller = isController(user) || isAdmin(user);
  // A request to add a document to a schedule action: answered on the action's page.
  const ask = t.activity;
  const askedOf = ask ? (await activityDetail(ctx, ask.id))?.activity ?? null : null;
  const mine = t.recipients.find((recipient) => recipient.userId === user.id) ?? null;
  const readyToRoute = page.carried.filter((one) => one.revisionState === "IN_PREPARATION" && one.revisionId).map((one) => one.revisionId!);
  // Whether the reason it was sent for asks for a review at all (§11.11). Where
  // it does not, acceptance is the end of it and "Sent for review" is skipped.
  const reviewExpected = ((await getActiveSet("REASONS_FOR_ISSUE")).find((one) => one.code === t.reason)?.props as Record<string, unknown> | undefined)?.reviewCycle === true;

  // Addressed to, and copied in. Seen is read from the first list only: being
  // copied in is being kept informed, not being asked, so a transmittal is not seen
  // because somebody kept informed happened to look at it.
  const addressed = t.recipients.filter((one) => one.kind !== "CC");
  const copied = t.recipients.filter((one) => one.kind === "CC");
  // An organization with no accounts here cannot open it, so it is never seen:
  // for them, the receipt is one of our people recording that it was sent on.
  const outside = (one: (typeof t.recipients)[number]) => !!one.partyId && !one.userId;
  const theirSystem = (partyId: string | null) => (partyId ? page.parties[partyId]?.externalSystem : null) ?? null;
  const inApp = addressed.filter((one) => !outside(one));
  const sentOn = addressed.filter(outside);
  const seen = inApp.filter((one) => one.openedAt).length;
  const sentCount = sentOn.filter((one) => one.dispatchedAt).length;
  const allSeen = addressed.length > 0 && seen === inApp.length && sentCount === sentOn.length;
  const waiting = addressed.filter((one) => !one.openedAt && one.userId);
  const mayNotify = controller && waiting.length > 0 && status !== "DRAFT";
  const issueCheck = status === "DRAFT" && controller ? await preflight("ISSUE", { transmittalId: t.id }) : null;
  // Who of ours carries each of those organizations, and whether that is you.
  const carriersOf = await carriersOfTransmittal(ctx, t);

  const replyOverdue = !t.answers.length && t.responseRequired && !!t.responseDue && new Date(t.responseDue).getTime() < Date.now();
  // Anybody it reached may answer it — the people it was addressed to, the
  // people copied in who have a question of their own, and whoever raised it.
  // One way to answer or complete it: a new transmittal that follows it. Ours, it carries its documents and people;
  // theirs, it goes back to whoever sent it.
  const followHref = `/transmittals/new?follows=${t.id}`;

  const reason = (REASON_LABEL[t.reason as ReasonForIssue] ?? t.reason).toLowerCase();
  // The reference tones: a draft not yet out, sent and waiting, accepted, rejected.
  const statusColors: Record<string, string> = { DRAFT: TONE.idle, ISSUED: TONE.waiting, ACCEPTED: TONE.done, REJECTED: TONE.refused };

  // How often each document went out before this transmittal: the third issue of a drawing is a fact about the drawing.
  const carried: CarriedRow[] = page.carried.map((item) => ({
    id: item.id,
    documentId: item.documentId,
    docNumber: item.number,
    title: item.title,
    revision: item.revision,
    status: item.status ?? item.revisionState.replaceAll("_", " ").toLowerCase(),
    neededFor: item.neededFor,
    pdfId: item.files.find((one) => one.kind === "STAMPED")?.id ?? item.files.find((one) => one.kind === "RENDITION")?.id ?? null,
    nativeId: item.files.find((one) => one.kind === "NATIVE")?.id ?? null,
    nativeName: item.files.find((one) => one.kind === "NATIVE")?.name ?? null,
    supersededSince: !!item.currentRevision && item.currentRevision !== item.revision,
    currentRevision: item.currentRevision,
    sentBefore: item.sentBefore,
    reviewId: item.review?.id ?? null,
    reviewOpen: !!item.review?.open,
  }));

  return (
    <div className="space-y-4">
      {mine && status !== "DRAFT" ? <ReceiptTracker transmittalId={t.id} /> : null}

      <CarriedTable
        rows={carried}
        exportHref={`/api/export/transmittals?ids=${t.id}`}
        plate={
          <div className="flex flex-col-reverse gap-3 border-b border-line px-5 pt-6 pb-3 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">{t.number}</p>
              <h1 className="plate-name mt-1 min-w-0">{t.subject || <span className="text-slate-400">No subject</span>}</h1>
              {/* Who, to whom, when, and what for — the sentence a transmittal
                  register entry is, said as facts rather than as prose. */}
              <p className="plate-meta mt-2">
                {t.direction === "OUTGOING"
                  ? <>{t.issuedBy} sent it {fmtDate(t.issuedAt)} to {addressed.map((one) => one.name).join(", ") || "nobody yet"}</>
                  : <>{page.issuingParty} sent it {fmtDate(t.issuedAt)}, and it arrived {fmtDate(t.issuedAt)}</>}
                {" "}&middot; {page.carried.length} document{page.carried.length === 1 ? "" : "s"} &middot; for {reason}
              </p>
              <p className="mt-1 max-w-2xl text-[11.5px] leading-4 text-slate-400">
                {[...new Set(addressed.map((one) => one.organization).filter(Boolean))].join(", ") || (incoming ? page.issuingParty : "no company named")}
                {copied.length ? <> &middot; {copied.length} copied in: {copied.map((one) => one.name).join(", ")}</> : null}
                {" · "}
                {status === "DRAFT"
                  ? "Nothing has been sent yet — it carries no date of issue until it is issued."
                  : t.responseRequired
                    ? t.answers.length
                      ? `Answered ${fmtDate(t.answers[0].issuedAt)} by ${t.answers[0].number}${t.answer === "LATE" ? `, late: it was due ${fmtDate(t.responseDue)}` : t.answer === "ON_TIME" && t.responseDue ? ", in time" : ""}.`
                      : `An answer is due by ${fmtDate(t.responseDue)} — write it down under “The answer”.`
                    : "No answer is needed. Opening it is the receipt."}
              </p>
            </div>
            {/* The way back and where it stands — nothing else, as on every
                detail page. What can be done to it lives in the sheet it
                concerns: issuing, in the draft bar below. */}
            <div className="flex shrink-0 items-center gap-2">
              <Link href="/transmittals" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Transmittals</Link>
              <Chip className={statusColors[status] ?? ""}>{status.toLowerCase()}</Chip>
            </div>
          </div>
        }
      />

      {/* A draft has been sent to nobody. Saying so, with the one thing that
          changes it, in a bar of its own. */}
      {status === "DRAFT" ? (
        <section className="register register-sheet register-sheet-open">
          <div className="asking flex flex-wrap items-center gap-x-4 gap-y-2 bg-tint-soft px-5 py-3 sm:px-6">
            <span className="stencil text-slate-500">Draft</span>
            <span className="text-xs text-slate-600">Nothing has been sent — issuing it notifies everyone it is addressed to, and dates it.</span>
            {controller ? (
              issueCheck!.ok ? (
                <span className="ml-auto flex items-center gap-3">
                  <span className="text-[11px] text-slate-400">{issueCheck!.passed.length} check{issueCheck!.passed.length === 1 ? "" : "s"} passed</span>
                  <ActionForm action={issueTransmittalAction} hideSubmit hidden={{ transmittalId: t.id }} className="space-y-0">
                    <button data-on="true" className="ask">Issue</button>
                  </ActionForm>
                </span>
              ) : null
            ) : <span className="ml-auto text-[11px] text-slate-400">Document Control issues it.</span>}
          </div>
          {controller && (!issueCheck!.ok || issueCheck!.warnings.length) ? (
            <div className="border-t border-line px-5 py-3 sm:px-6"><PreflightPanel result={issueCheck!} /></div>
          ) : null}
        </section>
      ) : null}
      {sp.issueError ? <Banner tone="warn" title="Created, but not sent">{sp.issueError} Issue it above once that is settled.</Banner> : null}
      {ask && askedOf ? (
        <Banner tone={ask.answeredAt ? "info" : "warn"} title={`Asks for ${ask.kind === "DISCIPLINE" ? "a missing discipline" : "a document"} to be added to ${askedOf.code}`}>
          {ask.answeredAt
            ? <>Answered by {ask.answeredBy}, {fmtDate(ask.answeredAt)}: {ask.answer} </>
            : ask.checkedAt
              ? <>{askedOf.name}. Checked by {ask.checkedBy}, {fmtDate(ask.checkedAt)}; with {ask.confirmerName} to confirm. </>
              : <>{askedOf.name}. Not answered yet{ask.confirm ? "; Document Control checks it, then management confirms it" : ""}. </>}
          {(() => {
            const yours = !ask.answeredAt && !!ask.checkedAt && ask.confirmerId === ctx.user.id;
            const toCheck = !ask.answeredAt && !ask.checkedAt && ctx.can("CONTROL");
            return (
              <Link href={`/actions/${askedOf.code}${yours ? "#your-confirmation" : toCheck ? "#asked" : ""}`} className="font-semibold text-link hover:underline">
                {yours ? "Confirm or refuse it on the action" : toCheck ? (ask.confirm ? "Check it on the action" : "Answer it on the action") : "Open the action"}
              </Link>
            );
          })()}
        </Banner>
      ) : null}
      {status === "REJECTED" ? (
        <Banner tone="danger" title="Rejected">{page.returnedReason} — the documents it carried were not accepted, and no review has started.</Banner>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          {/* What came with it that is not a register document: their letter,
              the email, what they attached. Kept as the record of what arrived;
              one becomes a document only when somebody makes it one — and then
              it is found in the register by its own content. */}
          {/* Only when files came with it: a transmittal sent through the system carries its documents, nothing loose. */}
          {incoming && page.files.length ? (
            <section id="files" className="register register-sheet register-sheet-open">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
                <span className="stencil mr-1 text-slate-400">Files that came with it</span>
                <span className="text-[11px] text-slate-400">kept as they arrived — not in the register unless made a document</span>
                <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-500">{page.files.length}</span>
              </div>
              {page.files.length ? (
                <ul className="divide-y divide-line">
                  {page.files.map((file) => {
                    const registered = page.carried.find((item) => item.files.some((one) => one.sha256 === file.sha256));
                    return (
                      <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 sm:px-6">
                        <div className="min-w-0">
                          <a href={`/api/files/${file.id}`} target="_blank" className="text-[13px] font-medium text-link hover:underline">{file.name}</a>
                          <p className="text-[11px] text-slate-400">
                            {Math.max(1, Math.round(file.size / 1024))} kB &middot; kept by {file.keptBy}, {fmtDate(file.keptAt)}
                          </p>
                        </div>
                        {registered ? (
                          <Link href={`/documents/${registered.documentId}`} className="text-[11px] text-slate-500 hover:text-link">
                            in the register as <span className="font-mono font-semibold">{registered.number}</span> rev {registered.revision}
                          </Link>
                        ) : controller ? (
                          <Link href={`/documents/new?received=1&fromFile=${file.id}`} className="text-[11px] font-semibold text-link hover:underline">Make it a document &rarr;</Link>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="px-5 py-3 text-xs text-slate-400 sm:px-6">Nothing kept with it yet.</p>
              )}
              {controller ? (
                <ActionForm action={attachTransmittalFilesAction} hideSubmit hidden={{ transmittalId: t.id }} className="space-y-0">
                  <div className="asking flex flex-wrap items-center gap-3 border-t border-line px-5 py-2.5 sm:px-6">
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">Files to keep with it</span>
                      <input type="file" name="attachments" multiple className="w-full" />
                    </label>
                    <button className="ask">Keep with it</button>
                  </div>
                </ActionForm>
              ) : null}
            </section>
          ) : null}

          {t.message || page.issueRequests.length ? (
            <section className="register register-sheet register-sheet-open">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
                <span className="stencil mr-1 text-slate-400">Why it was sent</span>
                <span className="text-[11px] text-slate-400">the reason for issue, and what was written to them</span>
                <span className="ml-auto text-[11px] font-medium text-slate-500">for {reason}</span>
              </div>
              {t.message ? (
                <p className="whitespace-pre-line px-5 py-3.5 text-sm leading-relaxed text-slate-700 sm:px-6">{t.message}</p>
              ) : null}
              {page.issueRequests.length ? (
                <p className="border-t border-line px-5 py-2 text-[11px] text-slate-400 sm:px-6">
                  Raised from {page.issueRequests.length} issue request{page.issueRequests.length === 1 ? "" : "s"} — whoever released the revision asked for it to go out.
                  {page.issueRequests.map((one) => one.note).filter(Boolean).length
                    ? <> They said: {page.issueRequests.map((one) => one.note).filter(Boolean).join(" · ")}</>
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
                opening it while signed in is the receipt{sentOn.length ? <>; for an organization not on the system, our sending it on is</> : null} &mdash; copies are kept informed, not asked
              </span>
              <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-500">
                {allSeen
                  ? sentOn.length ? "all seen or sent on" : "all seen"
                  : [inApp.length ? `${seen} of ${inApp.length} seen` : null, sentOn.length ? `${sentCount} of ${sentOn.length} sent on` : null].filter(Boolean).join(" · ")}
                {copied.length ? <span className="ml-1.5 font-sans text-slate-400">+{copied.length} copied in</span> : null}
              </span>
            </div>
            <ul className="divide-y divide-line">
              {[...addressed, ...copied].map((person) => (
                <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 sm:px-6">
                  <div className="flex min-w-0 items-start gap-3">
                    {/* Who may be notified again: addressed, has an account, has
                        not opened it. The box belongs to the strip below. */}
                    {mayNotify ? (
                      waiting.some((one) => one.id === person.id)
                        ? <input type="checkbox" name="recipientIds" value={person.id} form={`notify-again-${t.id}`} aria-label={`Notify ${person.name} again`} className="mt-1" />
                        : <span className="w-3.25 shrink-0" aria-hidden />
                    ) : null}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700">
                      {person.name}
                      {person.organization ? <span className="font-normal text-slate-400"> &middot; {person.organization}</span> : null}
                      {person.kind === "CC" ? <span className="ml-1.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">copy</span> : null}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {outside(person)
                        ? person.dispatchedAt
                          ? <>
                              Sent to them by {person.dispatchChannel} {fmtDate(person.dispatchedAt)}, by {person.dispatchedBy}
                              {person.dispatchRef ? <> &middot; their reference <span className="font-mono">{person.dispatchRef}</span></> : null}
                              {person.proofFileId ? <> &middot; <a href={`/api/files/${person.proofFileId}`} target="_blank" className="font-semibold text-link hover:underline">proof: proof of sending</a></> : null}
                            </>
                          : status === "DRAFT"
                            ? "Not on this system — sent on by us once it is issued"
                            : <>Not on this system &mdash; {carriersOf.get(person.partyId!)?.names} sends it to them and records it here</>
                        : person.openedAt
                          ? <>Opened it {fmtDateTime(person.openedAt)}{person.viewCount > 1 ? <>, and {person.viewCount} times since &mdash; last {fmtDateTime(person.lastViewedAt ?? person.openedAt)}</> : null}</>
                          : person.notifiedAt
                            ? <>Notified {fmtDateTime(person.notifiedAt)} &mdash; not opened yet</>
                            : "Waiting to be issued"}
                    </p>
                  </div>
                  </div>
                  {outside(person) ? (
                    person.dispatchedAt ? (
                      <Chip className={person.kind === "CC" ? "bg-slate-50/40 text-slate-600 ring-slate-300" : "bg-emerald-100 text-emerald-800 ring-emerald-300"}>sent on</Chip>
                    ) : status === "DRAFT" ? (
                      <Chip className="bg-slate-100 text-slate-500 ring-slate-200">not sent yet</Chip>
                    ) : (
                      <Chip className="bg-amber-100 text-amber-800 ring-amber-300">to send</Chip>
                    )
                  ) : person.openedAt ? (
                    <Chip className={person.kind === "CC" ? "bg-slate-50/40 text-slate-600 ring-slate-300" : "bg-emerald-100 text-emerald-800 ring-emerald-300"}>seen</Chip>
                  ) : person.notifiedAt ? (
                    <Chip className="bg-amber-100 text-amber-800 ring-amber-300">notified</Chip>
                  ) : (
                    <Chip className="bg-slate-100 text-slate-500 ring-slate-200">not sent yet</Chip>
                  )}
                  {/* Whoever carries this organization says it went, with what
                      proves it. The form takes the whole line under the row. */}
                  {outside(person) && !person.dispatchedAt && status !== "DRAFT" && carriersOf.get(person.partyId!)?.mine ? (
                    <ActionForm action={markRecipientSentAction} hideSubmit hidden={{ recipientId: person.id }} className="w-full">
                      <div className="asking grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,9rem)_minmax(0,1fr)_minmax(0,9rem)_auto] sm:items-center">
                        <label className="min-w-0">
                          <span className="sr-only">How it went</span>
                          <select name="channel" required defaultValue="" className="plain w-full">
                            <option value="" disabled>How it went…</option>
                            <option value="email">Email</option>
                            <option value={theirSystem(person.partyId) ? `their system (${theirSystem(person.partyId)})` : "their own system"}>
                              {theirSystem(person.partyId) ? `Their system — ${theirSystem(person.partyId)}` : "Their own system"}
                            </option>
                            <option value="post or by hand">Post, or by hand</option>
                          </select>
                        </label>
                        <label className="min-w-0">
                          <span className="sr-only">The day it went</span>
                          <input type="date" name="sentOn" defaultValue={new Date().toISOString().slice(0, 10)} className="plain w-full" />
                        </label>
                        <label className="min-w-0">
                          <span className="sr-only">Proof it went</span>
                          <input type="file" name="evidence" required={(person.partyId ? page.parties[person.partyId]?.evidenceRequired : null) ?? true} className="w-full" title="The email you sent, or the receipt their system gave you" />
                        </label>
                        <label className="min-w-0">
                          <span className="sr-only">Their reference</span>
                          <input name="reference" placeholder="Their reference" className="plain w-full" />
                        </label>
                        <button className="ask">Mark as sent</button>
                      </div>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
            {mayNotify ? <NotifyAgain action={chaseTransmittalAction} transmittalId={t.id} waiting={waiting.length} /> : null}
          </section>

          {/* What was sent after it. A transmittal is never changed once it
              went: a person or a document left out goes on a supplement, and a
              package they rejected goes again on one that replaces it. */}
          {status !== "DRAFT" || t.follows ? (
            <section id="followed" className="register register-sheet register-sheet-open">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
                <span className="stencil mr-1 text-slate-400">Follow-ups</span>
                <span className="text-[11px] text-slate-400">
                  {t.followedBy.length + t.answers.length
                    ? `${t.followedBy.length + t.answers.length} sent after it, each mentioning it`
                    : "a sent transmittal never changes — an answer, or anything missed, goes on a new one that follows it, listed here"}
                </span>
                {status !== "DRAFT" ? (
                  status === "REJECTED" && controller && t.direction === "OUTGOING"
                    ? <Link href={`/transmittals/new?follows=${t.id}&kind=REPLACES`} className="ask ml-auto">Send the corrected package</Link>
                    : <Link href={followHref} className="ask ml-auto">Follow up</Link>
                ) : null}
              </div>
              {t.follows ? (
                <p className="border-b border-line px-5 py-2 text-[11px] text-slate-500 sm:px-6">
                  {t.followKind === "REPLACES" ? "This replaces " : "This follows "}
                  <Link href={`/transmittals/${t.follows.id}`} className="font-mono font-semibold text-link hover:underline">{t.follows.number}</Link>
                  {t.follows.subject ? <> &mdash; {t.follows.subject}</> : null}.
                </p>
              ) : null}
              {t.followedBy.length ? (
                <ul className="divide-y divide-line">
                  {t.followedBy.map((one) => (
                    <li key={one.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 sm:px-6">
                      <div className="min-w-0">
                        <p className="text-sm">
                          <span className="stencil mr-2 text-slate-400">{one.followKind === "REPLACES" ? "Replaced by" : "Followed by"}</span>
                          <Link href={`/transmittals/${one.id}`} className="doc-number">{one.number}</Link>
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {fmtDate(one.issuedAt)}
                          {" "}&middot; {one.items} document{one.items === 1 ? "" : "s"} &middot; {one.recipients} recipient{one.recipients === 1 ? "" : "s"}
                        </p>
                      </div>
                      <Chip className={statusColors.ISSUED}>issued</Chip>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {/* Replies by email from an organization not on DELIOS: Document Control records or sets each aside. */}
          {controller ? <EmailReplies replies={await emailReplies(ctx, t.id)} transmittalId={t.id} /> : null}

          {/* What came back. Each answer is correspondence in its own right, so
              this says what they are and where they are, and does not try to
              hold them. */}
          {status !== "DRAFT" ? (
            <section id="reply" className="register register-sheet register-sheet-open">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
                <span className="stencil mr-1 text-slate-400">The exchange</span>
                <span className={`text-[11px] ${replyOverdue ? "font-semibold text-red-700" : "text-slate-400"}`}>
                  {t.answers.length
                    ? `${t.answers.length} answer${t.answers.length === 1 ? "" : "s"} came back against it`
                    : t.responseRequired
                      ? replyOverdue
                        ? `an answer was due ${fmtDate(t.responseDue)} and none has come back`
                        : `an answer is due by ${fmtDate(t.responseDue)}`
                      : "no answer is owed — anybody it reached may still send one"}
                </span>
              </div>

              {t.inReplyTo ? (
                <p className="border-b border-line px-5 py-2 text-[11px] text-slate-500 sm:px-6">
                  This follows{" "}
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
                          {answer.direction === "OUTGOING" ? answer.issuedBy : answer.from ?? answer.issuedBy} &middot; {fmtDate(answer.issuedAt)}
                          {answer.items ? <> &middot; {answer.items} document{answer.items === 1 ? "" : "s"}</> : <> &middot; words only</>}
                        </p>
                      </div>
                      <Chip className={statusColors.ISSUED}>issued</Chip>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-3.5 text-xs text-slate-500 sm:px-6">
                  Nothing has come back yet. An answer is a transmittal of its own — Follow up opens one addressed to whoever sent this,
                  with the people copied in carried over, and you can change any of that before it goes.
                </p>
              )}
            </section>
          ) : null}

          {/* On arrival: Document Control accepts what came in, or rejects it
              with a reason the sender reads. How they judge it is their
              procedure; the record keeps the decision, who made it, when, and
              what they wrote. A check recorded condition by condition before
              that is kept as it was — it is evidence. */}
          {incoming ? (
            <section id="check" className="register register-sheet register-sheet-open">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
                <span className="stencil mr-1 text-slate-400">On arrival</span>
                <span className="text-[11px] text-slate-400">
                  {status === "ACCEPTED" || status === "REJECTED"
                    ? <>{status === "ACCEPTED" ? "accepted" : "rejected"} by {page.checkedBy}, {fmtDate(page.checkedAt)}</>
                    : t.direction === "INCOMING"
                      ? "Document Control accepts it, or rejects it with a reason the sender reads"
                      : "their document control checks what we send"}
                </span>
              </div>

              {t.receiptNote && status !== "REJECTED" ? (
                <p className="px-5 py-3 text-xs text-slate-600 sm:px-6">
                  <span className="text-slate-400">They wrote: </span>{t.receiptNote}
                </p>
              ) : null}

              {incoming && status === "ISSUED" ? (
                controller ? (
                  <div className="px-5 py-3.5 sm:px-6">
                    <PreflightPanel result={await preflight("ACCEPT_TRANSMITTAL", { transmittalId: t.id })} className="mb-3" />
                    <ActionForm action={acceptTransmittalAction} hideSubmit hidden={{ transmittalId: t.id }} className="space-y-0">
                      <div className="asking grid grid-cols-1 items-center gap-x-3 gap-y-2.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                        <label className="min-w-0">
                          <span className="sr-only">A note, or why it is rejected</span>
                          <input name="notes" className="plain w-full" placeholder="A note — required to reject: the sender reads why" />
                        </label>
                        {/* Two buttons, not one: turning something away is a
                            decision of its own, never a box left unticked. */}
                        <button name="decision" value="reject" className="ask">Reject</button>
                        <button name="decision" value="accept" data-on="true" className="ask">Accept</button>
                      </div>
                    </ActionForm>
                    <p className="mt-2 text-[11px] text-slate-400">Accepting starts any response period. Rejecting returns it to the sender with your reason.</p>
                  </div>
                ) : (
                  <p className="px-5 py-2.5 text-xs text-slate-500 sm:px-6">Document Control checks what arrives.</p>
                )
              ) : null}
            </section>
          ) : null}

          {incoming && status === "ACCEPTED" && controller && readyToRoute.length ? (
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
          <Card
            title="Progress"
            actions={controller ? (
              <span className="flex items-center gap-3 text-[11px] font-semibold">
                {/* The project's log is Document Control's; the audit trail is
                    the administrator's. Nobody is shown a door they cannot open. */}
                <Link href={`/?view=log&q=${encodeURIComponent(t.number)}`} className="text-link hover:underline" title="What has happened to this transmittal, in the project's own log">Log &rarr;</Link>
                {isAdmin(user) ? <Link href={`/settings/audit?q=${encodeURIComponent(t.number)}`} className="text-link hover:underline" title="Every recorded act on this transmittal, in the audit trail">Audit &rarr;</Link> : null}
              </span>
            ) : undefined}
          >
            <Timeline
              points={t.direction === "OUTGOING" ? [
                { label: "Raised", at: t.issuedAt, holder: t.issuedBy },
                { label: "Issued — they were notified", at: status === "DRAFT" ? null : t.issuedAt, holder: status === "DRAFT" ? "nothing has been sent yet" : t.issuedBy },
                {
                  label: "Seen",
                  at: addressed.map((one) => one.openedAt ?? one.dispatchedAt).filter(Boolean).sort((x, y) => new Date(x!).getTime() - new Date(y!).getTime())[0] ?? null,
                  holder: [inApp.length ? `${seen} of ${inApp.length} it was addressed to` : null, sentOn.length ? `${sentCount} of ${sentOn.length} sent on by us` : null].filter(Boolean).join(" · "),
                },
                ...(t.responseRequired || t.answers.length ? [{
                  label: t.answers.length ? "Answered" : "An answer is due",
                  at: t.answers[0]?.issuedAt ?? null,
                  holder: t.answers.length ? t.answers[0].number : t.responseDue ? fmtDate(t.responseDue) : "no date",
                }] : []),
              ] : [
                { label: "They sent it", at: t.issuedAt, holder: page.issuingParty },
                { label: "It arrived", at: t.issuedAt, holder: t.to },
                {
                  label: status === "REJECTED" ? "Rejected" : "Accepted",
                  at: page.checkedAt,
                  holder: page.checkedBy,
                  detail: status === "REJECTED" ? page.returnedReason : t.receiptNote,
                },
                { label: "Sent for review", at: reviews[0]?.startedAt ?? null, holder: reviews.length ? `${reviews.length} review${reviews.length === 1 ? "" : "s"}` : null, skipped: status === "ACCEPTED" && !reviews.length && !reviewExpected },
                ...(t.responseRequired || t.answers.length ? [{
                  label: t.answers.length ? "Answered" : "An answer is due",
                  at: t.answers[0]?.issuedAt ?? null,
                  holder: t.answers.length ? t.answers[0].number : t.responseDue ? fmtDate(t.responseDue) : "no date",
                }] : []),
              ]}
            />
          </Card>
        </aside>
      </div>
    </div>
  );
}
