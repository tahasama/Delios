import { Select } from "@/components/select";
import { FilePreview } from "@/components/file-preview";
import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { notFound } from "next/navigation";
import { isController, isAdmin } from "@/lib/core/auth";
import { TONE } from "@/lib/core/tones";
import { Card, Chip, Banner, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { ADVICE_LABEL, OUTCOME_CONSEQUENCES } from "@/lib/core/standard";
import { verdictEffect, VERDICT_EFFECT_BLURB } from "@/lib/reviews/verdict-effect";
import { fmtDate, fmtDateTime } from "@/lib/core/utils";
import { myAdvice, dueState } from "@/lib/reviews/workflow";
import { reviewCycle, reviewRun, earlierSteps, routeSteps, waitingOn } from "@/lib/reviews/api";
import { holders } from "@/lib/settings/api";
import { noticesAbout, noticeHistory } from "@/lib/actions/api";
import { NotifyPanel } from "@/components/notify-panel";
import { rewindRouteAction } from "@/lib/reviews/forms";
import { requestChoices, authorOf, issuePolicy, decisionLetsItOut } from "@/lib/transmittals/issue-requests";
import { DelegatePanel, DelegateForm, type DelegationRow } from "./delegate-panel";
import { AnswerCard } from "./answer-card";
import { delegateCandidates, delegationFlag, delegationsOn } from "@/lib/reviews/delegation";
import { controlDoes, actIsOff, matrixBinds } from "@/lib/settings/control-activities";
import { RequestIssue } from "@/app/(app)/documents/[id]/request-issue";
import { Timeline } from "@/components/timeline";
import { getActiveSet } from "@/lib/settings/config";
import { decisionOptions, statusOptions } from "@/lib/reviews/decision-options";
import { markDispatchedAction } from "@/lib/reviews/forms";
import { VerdictDecision } from "@/app/(app)/documents/[id]/verdict-status";
import { preflight } from "@/lib/conformance/rules/preflight";
import { Guarded } from "@/components/preflight";
import { issueToReviewAction, withdrawRevisionAction, removeCommentAction, editCommentAction, recordOutcomeAction, returnToOriginatorAction } from "@/lib/documents/forms-revisions";
import { openCopy } from "@/lib/documents/copies";
import { cookies } from "next/headers";
import { PREF, paneWidth } from "@/lib/core/preferences";
import { readersOn } from "@/lib/settings/viewers";
import { FilesChecking } from "@/components/files-checking";
import { stampPlan } from "@/lib/reviews/api";
import { StampPlacer } from "./stamp-placer";
import { checking } from "@/lib/documents/checking";
import { ResizablePane } from "@/components/resizable-pane";
import { ArrowLeft, Bell, ExternalLink, FileText, Pencil } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ReviewCyclePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ open?: string }> }) {
  // A link in the title opens one of the forms below the document: ?open=withdraw or ?open=notify.
  const opened = (await searchParams).open ?? null;
  const ctx = await requireScope();
  const { user } = ctx;
  const { id } = await params;
  const cycle = await reviewCycle(ctx, id);
  if (!cycle) notFound();

  const [outcomes, adviceCodes, statuses] = await Promise.all([
    getActiveSet(cycle.outcomeSetKey ?? "REVIEW_OUTCOMES"),
    getActiveSet("REVIEW_ADVICE"),
    getActiveSet("STATUSES"),
  ]);
  // The steps before this one answered from the advice list, so both lists are
  // read: a code shown with no words against it is the name of a row in a table.
  const verdictLabel = (code: string) =>
    outcomes.find((one) => one.code === code)?.label
    ?? adviceCodes.find((one) => one.code === code)?.label
    ?? ADVICE_LABEL[code]
    ?? OUTCOME_CONSEQUENCES[code]?.label
    ?? code;
  // What the verdict means, read from its meaning in the organization's list (any codes, the same four meanings);
  // an old record's consequence name falls back to the Standard's sentence.
  const verdictBlurb = (code: string) => {
    const row = outcomes.find((one) => one.code === code);
    return row ? VERDICT_EFFECT_BLURB[verdictEffect(row.props)] : OUTCOME_CONSEQUENCES[code]?.blurb;
  };
  const controller = isController(user) || isAdmin(user);
  // Notifying the people the review still waits on, by hand: the control function, or whoever started it.
  // Whoever started the review, or the control function (and above), may take the revision back out of it.
  const mayWithdraw = cycle.revision.state === "IN_REVIEW" && !cycle.withdrawn && (controller || (!!cycle.openedById && cycle.openedById === user.id));
  const notify = cycle.status === "OPEN" && !cycle.withdrawn && (controller || (!!cycle.openedById && cycle.openedById === user.id))
    ? await (async () => {
        const [waiting, everyone, sent] = await Promise.all([
          waitingOn(ctx, id).catch(() => ({ userIds: [] as string[] })),
          holders(ctx.projectId, "READ").catch(() => []),
          noticesAbout(ctx, `review:${id}`),
        ]);
        return {
          waiting: waiting.userIds,
          people: everyone.map((one) => ({ id: one.id, name: one.name, detail: one.functionName })),
          history: noticeHistory(sent),
        };
      })()
    : null;
  const assigned = cycle.assignments.some((assignment) => assignment.userId === user.id);
  const rev = cycle.revision;
  const doc = rev.document;
  // The PDF people open: the stamped copy once its review released (or returned) it, else the PDF as sent.
  const rendition = openCopy(rev.files);
  const newestSubmission = Math.max(0, ...rev.files.map((f) => f.submission ?? 0));
  const source = rev.files.find((f) => f.kind === "NATIVE" && (f.submission ?? 0) === newestSubmission && f.status === "CLEAN") ?? null;
  // The route this step belongs to, if any. Progress draws the whole of it, so
  // there is no separate picture of the route on this page.
  const run = await reviewRun(ctx, cycle.id).catch(() => null);
  // What the steps before this one said. Whoever answers here reads it before
  // answering, and the decider reads all of it.
  const earlierIds = run
    ? run.steps.slice(0, run.steps.findIndex((step) => step.cycleId === cycle.id)).map((step) => step.cycleId).filter((one): one is string => !!one)
    : [];
  const earlier = earlierIds.length ? await earlierSteps(ctx, cycle.id) : [];
  // The deciding step is offered the first request: the person who settles what
  // a revision is for is the likeliest to know who needs it.
  const askWho = (await issuePolicy(ctx)).asked;
  const nextStep = cycle.binding && cycle.final && !cycle.outcome ? await requestChoices(ctx, doc) : null;
  const issueReasons = nextStep ? await getActiveSet("REASONS_FOR_ISSUE") : [];
  const author = nextStep ? await authorOf(ctx, rev.id) : null;
  // The steps still to come on this route: a reservation may be held against
  // one of them rather than against the next revision.
  const here = run?.steps.findIndex((step) => step.cycleId === cycle.id) ?? -1;
  const laterSteps = run && here >= 0
    ? run.steps.slice(here + 1).map((step, index) => ({ number: here + 2 + index, title: step.title ?? `Step ${here + 2 + index}` }))
    : [];
  // Whoever holds the step that is open may send the route back to a step that
  // has already answered — the way out for somebody looking at the wrong file,
  // who otherwise has to answer on a document they know is wrong.
  const myStep = run?.steps.findIndex((step) => step.cycleId === cycle.id) ?? -1;
  const mayRewind = myStep === run?.currentStep && assigned && !cycle.outcome && myStep > 0;
  const rewindTo = mayRewind && run
    ? run.steps.slice(0, myStep).map((step, index) => ({ number: index + 1, title: step.title ?? `Step ${index + 1}` })).filter((_, index) => run.steps[index].status === "done")
    : [];
  const rewindReasons = rewindTo.length ? await getActiveSet("RETURN_REASONS") : [];
  // Handing this step over. What is asked of this step — advice or the decision
  // — is what may be handed over; the matrix recommends who (or decides, if
  // the project makes it the only rule).
  const handVerb: "REVIEW" | "APPROVE" = cycle.binding ? "APPROVE" : "REVIEW";
  const [handCandidates, handThroughControl, handRows, handOff, handStrict] = await Promise.all([
    assigned && cycle.status === "OPEN" ? delegateCandidates(ctx, { target: doc, verb: handVerb, fromUserId: user.id }) : Promise.resolve([]),
    controlDoes(ctx, "DELEGATE"),
    delegationsOn(ctx, cycle.id),
    actIsOff(ctx, "DELEGATE"),
    matrixBinds(ctx),
  ]);
  const handOvers: DelegationRow[] = await Promise.all(handRows.map(async (row) => ({
    id: row.id,
    fromName: row.fromUser.name,
    toName: row.toUser.name,
    status: row.status,
    endDate: row.endDate,
    reason: row.reason,
    refusedReason: row.refusedReason,
    askedByName: row.askedByName,
    grantedByName: row.grantedByName,
    mine: row.fromUserId === user.id,
    flag: await delegationFlag(ctx, { target: doc, verb: row.verb === "APPROVE" ? "APPROVE" : "REVIEW", toUserId: row.toUserId, toName: row.toUser.name }),
  })));

  const reserves = cycle.comments.filter((comment) => comment.progressionPreventing && comment.status === "OPEN");
  const canRecordOutcome = (assigned || controller) && !cycle.outcome && !cycle.withdrawn && Boolean(cycle.issuedToReviewAt);
  // Writing comments: whoever sits on the open step, until they answer it.
  const mayComment = cycle.status === "OPEN" && assigned && !cycle.outcome && !cycle.withdrawn && Boolean(cycle.issuedToReviewAt);
  // Whether an open comment stops the release: the control function, or the revision's author, may change it.
  // A step answered by an outside party that holds no accounts here: one of our
  // people sends the pack and writes down what comes back. The verdict stays
  // theirs; the record says who entered it.
  const byProxy = cycle.party && cycle.party.participation !== "IN_APP";
  const mayCarry = assigned || controller;
  // What the route asked this step to decide between, kept on the step itself.
  let mayDecideOn: string[] = [];
  try { mayDecideOn = cycle.grantsStatuses ? (JSON.parse(cycle.grantsStatuses) as string[]) : []; } catch { mayDecideOn = []; }
  // A step of a route has two moments, not five: it opened, and it was
  // answered. The five custody points belong to a review the control function
  // runs on its own, where each handover is a separate act on a separate day —
  // stamping all five at once made a step look like it had jumped.
  const onARoute = !!run?.steps.some((step) => step.cycleId === cycle.id);
  // Every cycle of this route, so Progress can show the whole journey rather
  // than the two moments of the step you happen to be looking at.
  const routeCycleIds = run ? run.steps.map((step) => step.cycleId).filter((one): one is string => !!one) : [];
  const routeCycles = routeCycleIds.length ? await routeSteps(ctx, cycle.id) : [];
  const byId = new Map(routeCycles.map((one) => [one.id, one]));
  // A decided review that is part of a route has one way back: the control function
  // sends the revision back at the gate, with a reason, and everyone who sat on
  // the route is told. A review the control function ran on its own still ends
  // by handing the outcome to the author.
  // Who carries these two out is the project's answer, and the buttons follow
  // it: see `frontend/lib/settings/control-activities.ts` and Settings → Who does what.
  const [returnIsControl, issueIsControl] = await Promise.all([
    controlDoes(ctx, "RETURN_OUTCOME"),
    controlDoes(ctx, "REVIEW_ISSUE"),
  ]);
  const mayReturn = controller || (!returnIsControl && assigned);
  const mayIssueToReviewers = controller || (!issueIsControl && cycle.openedById === user.id);
  const canReturn = mayReturn && !onARoute && cycle.binding && Boolean(cycle.outcome) && !cycle.returnedToOriginatorAt;
  const custody = onARoute
    ? [
        { label: "Revision opened", at: rev.createdAt, holder: doc.createdByName },
        ...(run?.steps ?? []).map((step, index) => {
          const one = step.cycleId ? byId.get(step.cycleId) : null;
          const last = index === (run?.steps.length ?? 0) - 1;
          return {
            group: "Review route",
            // Every step of a review shares its id: where it stands is the step that is open.
            here: step.status === "active" && rev.state === "IN_REVIEW",
            label: `${index + 1}. ${step.title ?? (last ? "Decision" : `Step ${index + 1}`)} — ${last ? "decides" : "advises"}`,
            at: one?.outcomeAt ?? null,
            holder: one?.outcome
              ? `${verdictLabel(one.outcome)} — ${one.outcomeByName ?? ""}`
              : cycle.withdrawn
                ? "not answered — withdrawn"
              : one
                ? `with ${one.assignments.map((seat) => seat.userName).join(", ") || "nobody yet"}`
                : step.goesTo?.length ? `not started · goes to ${step.goesTo.join(", ")}` : "not started",
          };
        }),
        // Withdrawn: this review ends there. Release, if it comes, comes from a later review.
        ...(cycle.withdrawn ? [
          { group: "Withdrawn", label: "Withdrawn from review", here: true, at: cycle.withdrawn.at, holder: cycle.withdrawn.note ?? null },
          { group: "Withdrawn", label: rev.releasedAt ? "Released — in a later review" : "Released", at: rev.releasedAt, holder: rev.releasedAt ? rev.releasedByName ?? null : "only through a new review" },
        ] : [
        // Decided is when it became Not released; it stays reached once released.
        { group: "The control function", label: "Not released", here: rev.state === "NOT_RELEASED", at: cycle.binding && cycle.outcome ? cycle.returnedFromReviewAt : null,
          holder: rev.state === "NOT_RELEASED" ? (rev.statusCode ? `at ${rev.statusCode}, waiting for the control function` : "waiting for the control function") : cycle.outcome && rev.statusCode ? `decided at ${rev.statusCode}` : null },
        { group: "The control function", label: "Released", at: rev.releasedAt, holder: rev.releasedByName ?? null },
        ]),
      ]
    : [
        { label: "Submitted", at: cycle.submittedAt, holder: cycle.openedByName },
        { label: "Received by control", at: cycle.receivedAt, holder: "The control function" },
        { label: "With reviewers", at: cycle.issuedToReviewAt, holder: cycle.assignments.map((assignment) => assignment.userName).join(", ") || "Unassigned" },
        { label: "Review returned", at: cycle.returnedFromReviewAt, holder: cycle.outcomeByName ?? "the reviewers" },
        { label: "Returned to author", at: cycle.returnedToOriginatorAt, holder: doc.createdByName },
      ];
  const currentCustody = [...custody].reverse().find((point) => point.at) ?? custody[0];
  // Where this review stands, said in the header: on a route, the step it is
  // (not the last step that finished); otherwise the last custody point.
  const routeIndex = run ? run.steps.findIndex((step) => step.cycleId === cycle.id) : -1;
  const standing = run && routeIndex >= 0
    ? `step ${routeIndex + 1} of ${run.steps.length} · ${run.steps[routeIndex].title ?? (routeIndex === run.steps.length - 1 ? "Decision" : `Review ${routeIndex + 1}`)}`
    : currentCustody.label.toLowerCase();
  // How near the reply is. Overdue and at risk are evidence somebody acts on, so
  // they keep their colour in the plate rather than becoming plain words.
  const due = cycle.dueAt ? dueState(cycle.dueAt, cycle.status !== "OPEN") : null;
  // What this page asks of whoever is reading it — the plate's third line. It
  // says what to do, never restates a fact the line above already gave.
  const claim = cycle.outcome
    ? `Answered. The ${cycle.binding ? "verdict" : "advice"} and every comment it gave are kept with it.`
    : !cycle.issuedToReviewAt
      ? "Not with the reviewers yet, so there is nothing to answer."
      : canRecordOutcome
        ? `Read the document, then give your ${cycle.binding ? "verdict" : "advice"}.`
        : "Read the document. The reviewers give their answer here.";

  // Before anything is chosen, "no outcome chosen yet" says nothing the form
  // does not; the check still runs when the answer is given.
  // Decided and waiting to be released: the control function releases it (or sends it back) from here, on the document's
  // own release form, as from the document page (owner: "release do not appear in the review detail").
  const waitsRelease = controller && rev.state === "NOT_RELEASED";
  const letsItOut = waitsRelease ? await decisionLetsItOut(ctx, rev.id) : false;
  const placing = waitsRelease ? await stampPlan(ctx, cycle.id) : null;

  const outcomeCheckRun = cycle.outcome ? null : await preflight("RECORD_OUTCOME", { cycleId: cycle.id });
  const outcomeChecks = outcomeCheckRun ? { ...outcomeCheckRun, warnings: outcomeCheckRun.warnings.filter((one) => one.id !== "OUT-SET") } : null;

  return (
    <div className="space-y-4">
      {/* The plate. A review is read — somebody sits with this document to judge
          it — so it takes the detail style's plate: the name in the serif, the
          facts somebody came for, and what the page asks of them. Its page order
          does not follow the action page's, because there is no table here: the
          thing at the centre is the document itself, read beside the place the
          answer is given. Copying the table-first order would lose that. */}
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col-reverse gap-3 px-5 pt-6 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            {cycle.number ? <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">{cycle.number}</p> : null}
            <h1 className="plate-name mt-1 min-w-0">{doc.title}</h1>
            <p className="plate-meta mt-2">
              Rev <span className="font-mono">{rev.value}</span>
              {cycle.dueAt ? (
                <> &middot; <span className={due === "overdue" ? "font-semibold text-red-700" : due === "at risk" ? "text-amber-700" : undefined}>
                  due {fmtDate(cycle.dueAt)}{cycle.status === "OPEN" ? ` · ${dueState(cycle.dueAt, false)}` : ""}
                </span></>
              ) : null}
              {" · "}
              {cycle.outcome ? `${verdictLabel(cycle.outcome)} — ${cycle.outcomeByName ?? ""}` : `${standing} · ${cycle.assignments.filter((assignment) => assignment.completedAt).length} of ${cycle.assignments.length} answered`}
              {/* The status the revision carries. Whether it is in force is the
                  revision's state, not the status. */}
              {rev.statusCode ? <> &middot; <span className="font-mono font-semibold text-slate-700">{rev.statusCode}</span></> : null}
            </p>
            <p className="mt-1 max-w-2xl text-[11.5px] leading-4 text-slate-400">{claim}</p>
            {/* What this review's answer is worth, said once up here so the card
                where it is given can be about giving it. */}
            <p className="mt-2 max-w-3xl text-[12px] leading-5 text-slate-600">
              <span className="stencil mr-2 text-slate-500">{cycle.binding ? "Binding verdict" : "Advice"}</span>
              {cycle.binding
                ? "The one decision on this revision. A verdict that proceeds is its release approval."
                : "Input for the route's decider; it does not decide on its own."}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <Link href={`/documents/${doc.id}`} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 font-mono text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> {doc.docNumber}</Link>
              <Chip className={cycle.status === "OPEN" ? TONE.waiting : TONE.idle}>Review {cycle.sequence} · {cycle.status === "OPEN" ? "open" : cycle.withdrawn ? "withdrawn" : "closed"}</Chip>
            </div>
            {/* Each opens its folded section under the document. */}
            {mayWithdraw ? <Link href="?open=withdraw#withdraw" className="text-xs font-semibold text-red-700 hover:underline">Withdraw?</Link> : null}
            {notify ? <Link href="?open=notify#notify" className="text-xs font-semibold text-link hover:underline">Notify?</Link> : null}
          </div>
        </div>
      </section>

      {waitsRelease ? (
        <section className="register register-sheet register-sheet-open">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
            <p className="text-[13px] text-slate-700">
              {letsItOut
                ? <>Decided{rev.statusCode ? <> at <span className="font-mono font-semibold">{rev.statusCode}</span></> : null}: rev {rev.value} is <strong>not released</strong> until it is released.</>
                : <>Decided with a verdict that asks for changes: rev {rev.value} is not released, and goes back.</>}
            </p>
            <Link href={`/documents/${doc.id}#step-release`} data-on="true" className="ask">{letsItOut ? `Release rev ${rev.value}` : `Send rev ${rev.value} back`}</Link>
          </div>
        </section>
      ) : null}

      {/* Where the stamp goes, before it is made: the app's clear spot, or put elsewhere by the control function. */}
      {waitsRelease && placing?.open && placing.fileId && placing.page && placing.stamp && placing.found ? (
        <section className="register register-sheet register-sheet-open" aria-labelledby="stamp-place-head">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <h2 id="stamp-place-head" className="stencil mr-1 text-slate-500">Where the stamp goes</h2>
            <span className="text-[11px] text-slate-500">on rev {rev.value}&rsquo;s PDF, once it is {letsItOut ? "released" : "sent back"}</span>
          </div>
          <StampPlacer reviewId={cycle.id} plan={{ ...placing, fileId: placing.fileId, page: placing.page, stamp: placing.stamp, found: placing.found }} />
        </section>
      ) : null}

      {cycle.withdrawn ? <Banner tone="info" title={`Withdrawn${cycle.withdrawn.at ? ` on ${fmtDate(cycle.withdrawn.at)}` : ""}`}>{cycle.withdrawn.note ?? "Taken back out of review to be changed."} Its comments are kept here; the revision goes round a new review once the change is in.</Banner> : null}
      {reserves.length ? <Banner tone="warn" title="Held under reserve">{reserves.length} comment{reserves.length === 1 ? " carries a reserve" : "s carry a reserve"} that the route has still to settle. The decider's verdict is what releases the revision.</Banner> : null}

      {/* The document's column is dragged wider by its right edge (owner: "make the preview resizable"); with no room
          left beside it, the side cards go under it. */}
      <div className="flex flex-wrap items-start gap-4">
        <ResizablePane name={PREF.reviewPane} initial={paneWidth((await cookies()).get(PREF.reviewPane)?.value, 420)} min={420}
          className="w-full min-w-0 space-y-4 xl:w-[calc(100%-380px-1rem)]">
          {/* The document under review, on a sheet of its own. Opening it in a
              tab of its own acts on the whole of it, so it sits in the band. */}
          <section className="register register-sheet">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
              <span className="stencil mr-1 text-slate-400">The document</span>
              <span className="text-[11px] text-slate-400">{rendition ? `revision ${rev.value}, as the reviewers see it` : "no PDF to review yet"}</span>
              {rendition ? <a href={`/api/files/${rendition.id}`} target="_blank" className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-link hover:underline"><ExternalLink className="h-3.5 w-3.5" /> Open PDF</a> : null}
            </div>
            {/* The same Preview as the document's: the PDF, and the source file where the page can show it. */}
            {checking(rev.files).length ? <FilesChecking names={checking(rev.files)} /> : null}
            <FilePreview pdf={rendition} source={source} title={`${doc.docNumber} revision ${rev.value}`} height="h-160" admin={isAdmin(user)} readers={await readersOn(ctx)} viewingNote={(await cookies()).get(PREF.viewingNote)?.value !== "0"} pdfDark={(await cookies()).get(PREF.pdfDark)?.value === "1"}
              empty={<div className="grid h-48 place-items-center bg-canvas/50 p-6 text-center"><div><FileText className="mx-auto h-8 w-8 text-slate-400"/><p className="mt-2 text-sm font-semibold text-slate-700">No PDF attached</p><Link href={`/documents/${doc.id}#workflow`} className="mt-2 inline-block text-xs font-semibold text-link hover:underline">Attach it on the document →</Link></div></div>} />
          </section>

          {/* Whoever started the review, or the control function (and above), takes the revision back out of it to change
              it, with why. The review stays in the register as withdrawn. Folded until asked for. */}
          {mayWithdraw ? (
            <details id="withdraw" open={opened === "withdraw"} className="register register-sheet register-sheet-open scroll-mt-24">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 sm:px-6 [&::-webkit-details-marker]:hidden">
                <span className="text-[13px] text-slate-600">Does the revision have to change first?</span>
                <span className="ask">Withdraw from review</span>
              </summary>
              <div className="border-t border-line px-5 py-4 sm:px-6">
                <ActionForm action={withdrawRevisionAction} submitLabel="Withdraw" variant="danger" size="sm" hidden={{ revisionId: rev.id }}>
                  <Field label="Why" required hint="everyone on the route is told; the review is kept as withdrawn">
                    <textarea name="reason" required rows={2} className={inputCls} placeholder="what has to change" />
                  </Field>
                </ActionForm>
              </div>
            </details>
          ) : null}

          {notify ? (
            <details id="notify" open={opened === "notify"} className="register register-sheet register-sheet-open scroll-mt-24">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 sm:px-6 [&::-webkit-details-marker]:hidden">
                <span className="text-[13px] text-slate-600">Remind the people the review still waits on</span>
                <span className="ask" title="Notify them" aria-label="Notify them"><Bell aria-hidden className="h-3.5 w-3.5" /></span>
              </summary>
              <div className="border-t border-line px-5 py-4 sm:px-6">
                <NotifyPanel
                  subject={`review:${id}:remind`}
                  title={`${doc.docNumber} rev ${rev.value}: your answer is awaited`}
                  body={`${doc.docNumber} rev ${rev.value} — ${doc.title} — waits on your answer${cycle.dueAt ? `; it was due ${fmtDate(cycle.dueAt)}` : ""}. Please answer it on the review's page.`}
                  link={`/reviews/${id}`}
                  people={notify.people}
                  chosen={notify.waiting}
                  history={notify.history}
                  bare
                />
              </div>
            </details>
          ) : null}

          {/* Each time the route was sent back: who, when, why, and what the steps it
              reset had answered. Sending back never erases an answer. */}
          {cycle.sendBacks.length ? (
            <Card title="Sent back" description="What the steps had answered before the route went back.">
              <ul className="space-y-3">
                {cycle.sendBacks.map((back, index) => (
                  <li key={index} className="space-y-1.5 text-xs leading-5">
                    <p className="whitespace-pre-line text-slate-700">
                      <span className="font-semibold text-slate-900">Back to step {back.toStep}</span> — {back.by}, {fmtDateTime(back.at)} · {back.reason}
                      {back.note ? <span className="block text-slate-600">{back.note}</span> : null}
                    </p>
                    {back.answers.length ? (
                      <ul className="space-y-1.5 border-l border-line pl-3">
                        {back.answers.map((one, i) => (
                          <li key={i} className="text-slate-600">
                            <span className="font-semibold text-slate-800">{one.step}. {one.title}</span> · {one.who}
                            {one.answer ? ` · ${verdictLabel(one.answer)}` : ""}{one.status ? ` at ${one.status}` : ""}
                            {one.at ? <span className="text-slate-400"> · {fmtDateTime(one.at)}</span> : null}
                            {one.note ? <span className="block whitespace-pre-line text-slate-600">{one.note}</span> : null}
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-slate-500">No step had answered yet.</p>}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {/* Comments are written with the answer, under the verdict or advice
              that needs them; this lists them.
              the control function, or the revision's author, may change whether an
              open one stops the release; what it was is kept. */}
          {/* Once the step has answered, its comments are shown with its answer: listed here only until then. */}
          {cycle.comments.length && !cycle.outcome ? (
            <Card title="Comments" description="Written with each step's answer.">
              {cycle.comments.length ? (
                <ul className="space-y-2">
                  {cycle.comments.map((comment) => (
                    <li key={comment.id} className={`rounded-md px-3 py-2 text-xs ${comment.progressionPreventing && comment.status === "OPEN" ? "bg-red-50 text-red-900 ring-1 ring-red-200" : "bg-canvas text-slate-700"}`}>
                      <p className="leading-5">{comment.text}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {comment.authorName} · {fmtDateTime(comment.createdAt)}
                        {comment.progressionPreventing ? (comment.status === "OPEN" ? " · stops the release" : " · settled") : null}
                      </p>
                      {/* Reclassified: by whom, when, and why, kept with the comment. */}
                      {comment.reclassified ? (
                        <p className="mt-1 whitespace-pre-line text-[11px] text-slate-600">
                          {comment.progressionPreventing ? "Made to stop the release" : "No longer stops the release"} — {comment.reclassified.by}, {fmtDate(comment.reclassified.at)}
                          {comment.reclassified.note ? `: ${comment.reclassified.note}` : ""}
                        </p>
                      ) : null}
                      {mayComment && comment.authorId === user.id && comment.status === "OPEN" ? (
                        <div className="mt-2 flex flex-wrap items-start gap-3">
                          <details>
                            <summary className="cursor-pointer list-none text-link [&::-webkit-details-marker]:hidden" title="Change your comment" aria-label="Change your comment"><Pencil className="h-3.5 w-3.5" aria-hidden /></summary>
                            <div className="mt-2">
                              <ActionForm action={editCommentAction} submitLabel="Save" size="sm" hidden={{ cycleId: cycle.id, commentId: comment.id }}>
                                <textarea name="text" required rows={3} defaultValue={comment.text} className={inputCls} />
                                <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" name="blocking" defaultChecked={comment.progressionPreventing} /> Stops the release until it is settled</label>
                              </ActionForm>
                            </div>
                          </details>
                          <ActionForm action={removeCommentAction} submitLabel="Take back" variant="danger" size="sm" hidden={{ cycleId: cycle.id, commentId: comment.id }} className="space-y-0" />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}

        </ResizablePane>

        <aside className="min-w-[320px] flex-1 space-y-4">
          {/* A step held by an organization that is not on this system. Our
              people do its work here, in the same screen as any other review:
              the same comments, the same verdict, with proof of what they sent
              back and the record saying it is theirs. */}
          {byProxy && cycle.party ? (
            <Card title={`You are acting for ${cycle.party.name}`} description="They are not on this system. What you record below is theirs, and the record says you wrote it down.">
              {!cycle.dispatchedAt ? (
                mayCarry ? (
                  <ActionForm action={markDispatchedAction} submitLabel="Mark as sent" size="sm" hidden={{ cycleId: cycle.id }}>
                    <p className="text-xs leading-5 text-slate-500">Send them the documents first — their system, or email. Then record it, and the clock starts.</p>
                    <Field label="Where it went" required>
                      <Select name="channel" required defaultValue="" className={inputCls}>
                        <option value="" disabled>Choose…</option>
                        <option value="Their own system">Their own system</option>
                        <option value="Email">Email, or a link we sent them</option>
                      </Select>
                    </Field>
                    <Field label="Date sent"><input type="date" name="sentOn" defaultValue={new Date().toISOString().slice(0, 10)} className={inputCls} /></Field>
                    <Field label="Proof" required hint="the sent email, or the receipt their system gave you"><input type="file" name="evidence" required className="w-full" /></Field>
                    <Field label="Their reference" hint="optional"><input name="reference" className={inputCls} /></Field>
                  </ActionForm>
                ) : <p className="text-xs text-slate-500">Waiting for {cycle.assignments.map((seat) => seat.userName).join(", ") || "whoever carries this exchange"} to send it.</p>
              ) : (
                <p className="text-xs leading-5 text-slate-600">
                  <strong className="font-semibold text-slate-800">Sent {fmtDate(cycle.dispatchedAt)}</strong> by {cycle.dispatchChannel}
                  {cycle.dispatchRef ? <> · <span className="font-mono">{cycle.dispatchRef}</span></> : null}
                  {cycle.transmittal ? <> · <Link href={`/transmittals/${cycle.transmittal.id}`} className="font-mono font-semibold text-link hover:underline">{cycle.transmittal.number}</Link></> : null}.
                  {cycle.outcome ? null : " When they answer, write their comments in and give their verdict below, with what they sent as proof."}
                </p>
              )}
              {cycle.files.length ? (
                <ul className="mt-3 border-t border-line pt-3 text-xs text-slate-500">
                  {cycle.files.map((file) => <li key={file.id} className="truncate">{file.kind === "STAMPED" ? "Stamped copy" : "Proof"}: {file.name}</li>)}
                </ul>
              ) : null}
            </Card>
          ) : null}

          {cycle.status === "OPEN" ? (
            <DelegatePanel rows={handOvers} controller={controller} off={handOff} />
          ) : null}

          {/* A withdrawn review is closed: nothing more is answered on it. */}
          {cycle.withdrawn ? null : (
          <AnswerCard
            title={cycle.binding ? "Binding verdict" : "Advice"}
            answerLabel={cycle.binding ? "Give my verdict" : "Give my advice"}
            delegate={cycle.status === "OPEN" && assigned && !cycle.outcome && !handOff && !handOvers.some((row) => row.status === "ACTIVE" || row.status === "OPEN")
              ? <DelegateForm cycleId={cycle.id} verb={handVerb} candidates={handCandidates} throughControl={handThroughControl} strict={handStrict} />
              : null}
          >
            {cycle.outcome ? <div><p className="text-sm font-semibold text-slate-900">{cycle.binding ? <><span className="font-mono">{cycle.outcome}</span> · {verdictLabel(cycle.outcome)}</> : verdictLabel(cycle.outcome)}</p><p className="mt-1 text-xs leading-5 text-slate-500">{verdictBlurb(cycle.outcome)}</p>              {/* What the verdict said. A verdict that reads "Comments" and
                  shows no comments is not a record of anything. */}
              {cycle.answerNotes.length ? (
                <ul className="mt-3 space-y-2 border-t border-line pt-3">
                  {cycle.answerNotes.map((note, index) => (
                    <li key={index} className="rounded-md bg-tint-soft px-3 py-2 text-xs text-slate-700 ring-1 ring-line">
                      <p className="leading-5">{note.text}</p>
                      <p className="mt-1 text-[11px] text-slate-400">{note.by}{note.at ? ` · ${fmtDateTime(note.at)}` : ""}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
              {cycle.comments.length ? (
                <ul className="mt-3 space-y-2 border-t border-line pt-3">
                  {cycle.comments.map((comment) => (
                    <li key={comment.id} className={`rounded-md px-3 py-2 text-xs ${comment.progressionPreventing && comment.status === "OPEN" ? "bg-red-50 text-red-900 ring-1 ring-red-200" : "bg-canvas text-slate-700"}`}>
                      <p className="leading-5">{comment.text}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {comment.authorName} · {fmtDateTime(comment.createdAt)}
                        {comment.progressionPreventing
                          ? comment.status === "OPEN"
                            ? comment.closesWith === "STEP" && comment.closesWithStep
                              ? ` · settled when step ${comment.closesWithStep} answers`
                              : " · settled by the next revision"
                            : " · settled"
                          : null}
                      </p>
                      {comment.resolution && comment.status === "CLOSED" && comment.resolution !== comment.text
                        ? <p className="mt-1 text-[11px] text-emerald-800">Settled: {comment.resolution}</p>
                        : null}
                    </li>
                  ))}
                </ul>
              ) : null}{canReturn ? <div className="mt-4 border-t border-line pt-4"><ActionForm action={returnToOriginatorAction} submitLabel="Return to author" size="sm" hidden={{ cycleId: cycle.id }}/></div> : null}</div> : <Guarded result={outcomeChecks!}><ActionForm action={recordOutcomeAction} submitLabel={byProxy && cycle.party ? `Record ${cycle.party.name}’s answer` : cycle.binding ? "Give my verdict" : "Give my advice"} hidden={{ cycleId: cycle.id }}><VerdictDecision deciding={cycle.binding} advice={cycle.binding ? null : await myAdvice(ctx, cycle.id, user.id)} verdicts={decisionOptions(cycle.verdictCodes ? outcomes.filter((one) => cycle.verdictCodes!.includes(one.code)) : cycle.adviceCodes ? outcomes.filter((one) => cycle.adviceCodes!.includes(one.code)) : outcomes)} statuses={statusOptions(statuses, mayDecideOn)} carrying={rev.statusCode} laterSteps={laterSteps} request={nextStep ? <RequestIssue onDecision author={author} reasons={issueReasons.map((one) => ({ code: one.code, label: one.label }))} proposed={nextStep.proposed} others={nextStep.others} parties={nextStep.parties} ours={nextStep.ours} askWho={askWho} /> : null} />
              {byProxy && cycle.party ? (
                <div className="mt-3 space-y-3 border-t border-line pt-3">
                  <p className="stencil text-slate-400">Recorded for {cycle.party.name}</p>
                  <Field label="Who answered" hint="optional — the person at their end, as the proof names them">
                    <input name="theirPerson" className={inputCls} placeholder="Name" />
                  </Field>
                  <Field label="Their own code" hint="optional — as they wrote it, e.g. Code 2"><input name="theirCode" className={inputCls} /></Field>
                  <Field label="Proof" required hint="what they sent back"><input type="file" name="evidence" required className="w-full" /></Field>
                </div>
              ) : null}</ActionForm></Guarded>}
            {cycle.outcome ? null : <p className="mt-2 text-xs leading-5 text-slate-500">{!cycle.issuedToReviewAt ? "The control function sends it to the reviewers first." : ""}</p>}
          </AnswerCard>
          )}

          {!cycle.issuedToReviewAt ? <Card title="Send to reviewers">{mayIssueToReviewers ? <ActionForm action={issueToReviewAction} submitLabel="Send to reviewers" hidden={{ cycleId: cycle.id }}/> : <p className="text-xs text-slate-500">{issueIsControl ? "Waiting for the control function." : "Waiting for whoever sent it for review."}</p>}</Card> : null}

          {earlier.length ? (
            <Card title="What the earlier steps said" description="Their verdicts and their comments, in order.">
              <ul className="-my-4 divide-y divide-line">
                {earlier.map((one) => (
                  <li key={one.id} className="py-3">
                    <p className="text-xs font-semibold text-slate-800">
                      {one.number ? <span className="mr-2 font-mono text-slate-400">{one.number}</span> : null}
                      {one.outcome ? verdictLabel(one.outcome) : <span className="text-slate-400">not answered yet</span>}
                    </p>
                    {one.outcomeByName ? <p className="mt-0.5 text-[11px] text-slate-400">{one.outcomeByName}, {fmtDateTime(one.outcomeAt)}</p> : null}
                    {one.comments.length ? (
                      <ul className="mt-2 space-y-1.5">
                        {one.comments.map((comment) => (
                          <li key={comment.id} className={`rounded-md px-2.5 py-1.5 text-xs ${comment.progressionPreventing && comment.status === "OPEN" ? "bg-red-50 text-red-900 ring-1 ring-red-200" : "bg-canvas text-slate-700"}`}>
                            {comment.text}
                            <span className="ml-1 text-[11px] text-slate-400">— {comment.authorName}{comment.progressionPreventing
                              ? comment.status === "OPEN"
                                ? comment.closesWith === "STEP" && comment.closesWithStep ? `, settled when step ${comment.closesWithStep} answers` : ", settled by the next revision"
                                : ", settled"
                              : ""}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {rewindTo.length ? (
            // Rarely needed, so a button; the form opens when it is pressed.
            <details className="register register-sheet register-sheet-open">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 sm:px-6">
                <span className="text-[13px] text-slate-600">Something wrong with the route?</span>
                <span className="ask">Send it back</span>
              </summary>
              <div className="space-y-3 border-t border-line px-5 py-4 sm:px-6">
              <p className="text-[11px] leading-4 text-slate-500">Not with the document — a document that is wrong is answered by the next revision. This sends the same revision back to a step that has already answered.</p>
              <ActionForm action={rewindRouteAction} submitLabel="Send it back" variant="danger" size="sm" hidden={{ runId: run!.id }}>
                <Field label="Back to" required>
                  <Select name="toStep" required defaultValue="" className={inputCls}>
                    <option value="" disabled>Choose a step…</option>
                    {rewindTo.map((step) => <option key={step.number} value={step.number}>{step.number}. {step.title}</option>)}
                  </Select>
                </Field>
                <Field label="What went wrong" required>
                  <Select name="returnReason" required defaultValue="" className={inputCls}>
                    <option value="" disabled>Choose…</option>
                    {rewindReasons.map((one) => <option key={one.code} value={one.code}>{one.label}</option>)}
                  </Select>
                </Field>
                <Field label="Say what happened" required hint="everyone on the route is told, with your name">
                  <textarea name="reason" rows={2} required className={inputCls} placeholder="what you found, and what you want done" />
                </Field>
              </ActionForm>
              </div>
            </details>
          ) : null}

          <Card title="Progress" description={run?.templateName ?? undefined}>
            <Timeline
              points={custody.map((point) => ({
                label: point.label,
                at: point.at,
                group: "group" in point ? point.group : undefined,
                here: "here" in point ? point.here : undefined,
                holder: point.label === "With reviewers" ? null : point.holder,
                detail: point.label === "With reviewers" ? (
                  <ul className="space-y-0.5">
                    {cycle.assignments.map((a) => <li key={a.id}>{a.completedAt ? "\u2713" : "\u25cb"} {a.userName}</li>)}
                    {!cycle.assignments.length ? <li className="text-slate-400">nobody assigned</li> : null}
                  </ul>
                ) : null,
              }))}
            />
          </Card>
        </aside>
      </div>
    </div>
  );
}

