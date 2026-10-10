import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { mayContributeToDocument, type SessionUser } from "@/lib/auth";
import { Chip, Field, inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ActionForm } from "@/components/form";
import { recordStepOutcomeAction, submitForReleaseAction } from "@/lib/actions/workflow";
import { typeSkipsReview } from "@/lib/review-need";
import { decisionOptions, statusOptions } from "@/lib/decision-options";
import { requestChoices, authorOf, issuePolicy } from "@/lib/issue-requests";
import { RequestIssue } from "./request-issue";
import { ADVICE_LABEL } from "@/lib/standard";
import { getActiveSet } from "@/lib/config";
import { VerdictDecision } from "./verdict-status";
import { Send, Rocket } from "lucide-react";
import { NextStepBody, StagePath, type StepItem } from "./next-step";
import { getRunForRevision, dueState, myAdvice, type WfRuntimeStep } from "@/lib/workflow";
import { fmtDate } from "@/lib/utils";
import { confirmRecordAction, correctRecordAction } from "@/lib/actions/governance";
import { SendForReview } from "@/components/send-for-review-panel";
import { isController } from "@/lib/auth";
import { legacyDocument, backendReview, backendDocument } from "@/lib/api/legacy";

type DocLite = {
  id: string;
  docNumber: string;
  title: string;
  discipline: string;
  docType: string;
  criticality: string | null;
  state: string;
  kind: string;
  originator: string | null;
  createdById: string;
};

/**
 * "Where this document stands" — the workflow panel. Always shows the single
 * next action: pick a template and send, record your step's outcome/approval
 * (from the published sets bound to the template), or wait.
 */
// The life of a revision, as the stage line in the Next step sheet shows it.
const REVIEWED = ["Prepare", "Review", "Release", "Issue"];
const UNREVIEWED = ["Prepare", "Release", "Issue"];

export async function WorkflowPanel({ doc, user, lead = [], extra: after = [] }: { doc: DocLite; user: SessionUser; lead?: StepItem[]; extra?: StepItem[] }) {
  // Outside the send panel, the lead steps simply come first.
  const extra = [...lead, ...after];
  if (doc.kind === "RECORD") return <RecordPanel doc={doc} extra={extra} />;

  const ctx = await requireScope();
  const revs = (await legacyDocument(ctx, doc.id))?.revisions ?? [];
  const run = revs[0] ? await getRunForRevision(ctx, revs[0].id) : null;
  const inPrep = revs.find((r) => r.state === "IN_PREPARATION");
  const released = revs.find((r) => r.state === "RELEASED");
  const controller = isController(user);

  if (run && run.status === "ACTIVE") return <RunActivePanel run={run} user={user} extra={extra} />;
  // A revision back in preparation is sent again, whatever its last review said:
  // withdrawn to be changed, it goes round a new review once the change is in.
  if (inPrep && revs[0]?.id === inPrep.id) {
    const withdrawn = run?.status === "WITHDRAWN" ? (await backendReview(ctx, run.id)).returnNote : null;
    return <SendPanel doc={doc} revId={inPrep.id} value={inPrep.value} hasFiles={!!(inPrep.renditionFileId || inPrep.nativeFileId)} user={user} lead={lead} extra={after} withdrawn={withdrawn} />;
  }
  // The latest revision decides what is waiting on whom. A finished run says
  // nothing about that: it stays finished after the revision is released.
  if (run && run.status === "DONE" && revs[0]?.state === "NOT_RELEASED") {
    const decided = [...revs[0].cycles].reverse().find((one) => one.binding && one.outcome)
      ?? null as { outcome: string | null; outcomeByName: string | null } | null;
    const verdicts = await getActiveSet("REVIEW_OUTCOMES");
    const said = decided?.outcome ? verdicts.find((one) => one.code === decided.outcome) : null;
    const letsItOut = said ? said.props.proceed === true : true;
    return (
      <Card
        title={`Rev ${revs[0].value} is decided`}
        description={`Route: ${run.templateName}.`}
        className={letsItOut ? "border-emerald-300 bg-emerald-50" : "border-orange-300 bg-orange-50"}
        items={extra}
        status={
          <StagePath
            stages={REVIEWED}
            at={letsItOut ? 2 : 1}
            note={<>
              {decided?.outcome ? <><strong className="text-slate-800">{said?.label ?? decided.outcome}</strong>{decided.outcomeByName ? ` — ${decided.outcomeByName}` : ""}. </> : null}
              {letsItOut
                ? controller ? "Ready to release." : "Document Control releases it next."
                : controller ? "It asks for changes, so it is not released — send it back." : "It asks for changes, so Document Control will send it back."}
            </>}
          />
        }
      />
    );
  }
  if (run && run.status === "RETURNED") {
    return (
      <Card
        title="Next step: revise"
        description={`${run.templateName} returned it with changes.`}
        className="border-orange-300/50 bg-orange-50/40"
        items={extra}
        status={<StagePath stages={REVIEWED} at={0} note="Returned with changes: the next revision carries them, then goes through review again. The returned revision keeps its outcome." />}
      />
    );
  }

  if (inPrep) return <SendPanel doc={doc} revId={inPrep.id} value={inPrep.value} hasFiles={!!(inPrep.renditionFileId || inPrep.nativeFileId)} user={user} lead={lead} extra={after} />;

  if (released) {
    return (
      <Card
        title="Current and in use"
        className="border-emerald-300/50 bg-emerald-50/30"
        items={extra}
        status={<StagePath stages={["Prepare", "Review", "Released"]} at={2} note={<><strong className="text-slate-800">Rev {released.value}</strong> is in use{released.statusCode ? ` as ${released.statusCode}` : ""}. Nothing is waiting on anyone.</>} />}
      />
    );
  }
  if (revs.length > 0) {
    const unreviewed = revs[0].state === "NOT_RELEASED" && (await typeSkipsReview(ctx, doc.docType));
    return (
      <Card
        title={revs[0].state === "NOT_RELEASED" ? "Next step: release" : revs[0].state === "IN_REVIEW" ? "In review" : "Not in use"}
        className={revs[0].state === "IN_REVIEW" || revs[0].state === "NOT_RELEASED" ? "border-brand-line/30 bg-tint-soft" : undefined}
        items={extra}
        status={revs[0].state === "NOT_RELEASED" ? (
          <StagePath
            stages={unreviewed ? UNREVIEWED : REVIEWED}
            at={unreviewed ? 1 : 2}
            note={<>{unreviewed ? `${doc.docType} is not reviewed.` : "The route is finished."} Rev {revs[0].value} is at <strong className="text-slate-800">{revs[0].statusCode}</strong> and is not released until Document Control publishes it.</>}
          />
        ) : revs[0].state === "IN_REVIEW" ? (
          <StagePath stages={REVIEWED} at={1} note={<>Rev {revs[0].value} is with its reviewers.</>} />
        ) : (
          <p className="text-[13px] text-slate-600">The latest revision (rev {revs[0].value}) is <strong className="text-slate-800">{revs[0].state.replaceAll("_", " ").toLowerCase()}</strong>.</p>
        )}
      />
    );
  }
  const may = mayContributeToDocument(user, doc);
  return (
    <Card
      title="Next step: first revision"
      className="border-brand-line/30 bg-tint-soft"
      items={may ? extra : []}
      status={<StagePath stages={REVIEWED} at={0} note={may ? "The number is reserved. There is no content yet." : "The number is reserved. Document Control or the author prepares it."} />}
    />
  );
}

// ── Sending: pick a template, override participants, go ─────────────────────

async function SendPanel({ doc, revId, value, hasFiles, user, lead, extra, withdrawn }: { doc: DocLite; revId: string; value: string; hasFiles: boolean; user: SessionUser; lead: StepItem[]; extra: StepItem[]; withdrawn?: string | null }) {
  // Who sends: the author for internal work; Document Control always, and
  // only Document Control for what a supplier or other party produced.
  const isControl = isController(user);
  const external = !!doc.originator;
  const canSend = mayContributeToDocument(user, doc) && (isControl || (!external && user.id === doc.createdById));
  const ctx = await requireScope();
  const unreviewed = await typeSkipsReview(ctx, doc.docType);
  const file = <>
    {hasFiles
      ? <><strong className="text-slate-800">Rev {value}</strong> has its file.</>
      : <><strong className="text-slate-800">Rev {value}</strong> has no file yet — a PDF is needed before it goes further.</>}
    {withdrawn ? <span className="mt-1 block text-[11px] text-slate-500">Its last review was withdrawn — {withdrawn.replace(/^Withdrawn for update by /, "by ")}. Send it again once the change is in.</span> : null}
  </>;
  if (!canSend) {
    return (
      <Card
        title={`Rev ${value} is being prepared`}
        items={[...lead, ...extra]}
        status={<StagePath stages={unreviewed ? UNREVIEWED : REVIEWED} at={0} note={<>{file} {external ? "Document Control sends it on." : "The author sends it on."}</>} />}
      />
    );
  }
  // A type the organization does not review goes from here straight to release:
  // whoever would send it for review settles its status and who receives it.
  if (unreviewed) {
    const found = await backendDocument(ctx, doc.id);
    const full = { ...found!, id: doc.id, subProject: found!.subproject };
    const [statuses, reasons, choices, author] = await Promise.all([
      getActiveSet("STATUSES"),
      getActiveSet("REASONS_FOR_ISSUE"),
      requestChoices(ctx, full),
      authorOf(ctx, revId),
    ]);
    const send: StepItem[] = hasFiles ? [{
      key: "send-on",
      primary: true,
      label: <><Rocket className="h-4 w-4" /> Send on for release</>,
      body: (
        <ActionForm action={submitForReleaseAction} submitLabel="Send on for release" hidden={{ revisionId: revId }}>
          <Field label="Released at" required>
            <select name="issuedFor" required defaultValue="" className={inputCls}>
              <option value="" disabled>Choose the status…</option>
              {statuses.map((one) => <option key={one.code} value={one.code}>{one.code} — {one.label}</option>)}
            </select>
          </Field>
          <RequestIssue onDecision author={author} reasons={reasons.map((one) => ({ code: one.code, label: one.label }))} proposed={choices.proposed} others={choices.others} parties={choices.parties} ours={choices.ours} askWho={(await issuePolicy(ctx)).asked} />
        </ActionForm>
      ),
    }] : [];
    return (
      <Card
        title="Next step: send on for release"
        description={`${doc.docType} is not reviewed — it goes from Prepare straight to release.`}
        className="border-brand-line/30 bg-tint-soft"
        items={[...lead, ...send, ...extra]}
        status={<StagePath stages={UNREVIEWED} at={0} note={file} />}
      />
    );
  }
  return (
    <Card
      title="Next step: send for review"
      className="border-brand-line/30 bg-tint-soft"
      items={[
        ...lead,
        { key: "send", primary: hasFiles, label: <><Send className="h-4 w-4" /> Send for review / approval</>, body: <SendForReview revisionIds={[revId]} /> },
        ...extra,
      ]}
      status={<StagePath stages={REVIEWED} at={0} note={file} />}
    />
  );
}

// ── Active run: step progress + the user's decision form ────────────────────

async function RunActivePanel({ run, user, extra }: { run: { id: string; templateName: string; steps: WfRuntimeStep[]; currentStep: number }; user: SessionUser; extra: StepItem[] }) {
  const ctx = await requireScope();
  const step = run.steps[run.currentStep];
  const review = await backendReview(ctx, run.id);
  const participants = [...new Map(review.steps.flatMap((item) => item.participants).map((one) => [one.userId, { id: one.userId, name: one.name }])).values()];
  const mine = !!step && step.participantIds.includes(user.id);
  const openStep = review.steps.find((one) => one.state === "OPEN");
  const activeCycle = step?.cycleId
    ? { id: review.id, revisionId: review.revisionId, outcome: review.verdict, outcomeSetKey: "REVIEW_OUTCOMES", dueAt: openStep?.dueDate ? new Date(openStep.dueDate) : null }
    : null;
  // The status the revision arrives at this step carrying, so the person either
  // changes it or confirms it on purpose.
  const carrying = activeCycle
    ? (await legacyDocument(ctx, review.documentId))?.revisions.find((one) => one.id === activeCycle.revisionId)?.statusCode ?? null
    : null;
  // The last step answers from the verdicts; every earlier one from the advice list.
  const outcomeSetKey = run.currentStep === run.steps.length - 1 ? activeCycle?.outcomeSetKey ?? "REVIEW_OUTCOMES" : "REVIEW_ADVICE";
  const outcomes = await getActiveSet(outcomeSetKey);
  const statuses = await getActiveSet("STATUSES");
  const serialNext = step?.mode === "SERIAL" ? nextSerialParticipant(step) : null;
  const alreadyGave = !!step && step.mode === "ALL" && (step.decidedBy ?? []).includes(user.id);
  const iDecide = !!step && mine && !alreadyGave && (step.mode !== "SERIAL" || serialNext === user.id);
  // The last step decides; the earlier steps' verdicts are advice shown to the decider.
  const deciding = run.currentStep === run.steps.length - 1;
  // The deciding step is offered the first request.
  const askWho = (await issuePolicy(ctx)).asked;
  const nextStep = deciding && activeCycle && !activeCycle.outcome
    ? await requestChoices(ctx, (await legacyDocument(ctx, review.documentId))!)
    : null;
  const issueReasons = nextStep ? await getActiveSet("REASONS_FOR_ISSUE") : [];
  const author = nextStep && activeCycle ? await authorOf(ctx, activeCycle.revisionId) : null;
  // The steps still to come, for a reservation held against one of them.
  const laterSteps = run.steps.slice(run.currentStep + 1).map((one, index) => ({
    number: run.currentStep + 2 + index,
    title: one.title ?? `Step ${run.currentStep + 2 + index}`,
  }));
  // Each earlier step of the review: its answer, who gave it, and its comments.
  const advice = review.steps.slice(0, run.currentStep).map((one) => {
    const answered = one.participants.filter((p) => p.answeredAt);
    return {
      id: `${review.id}-${one.number}`, outcome: one.answer, outcomeByName: answered.map((p) => p.name).join(", ") || null,
      outcomeNote: answered.map((p) => p.note).filter(Boolean).join(" ") || null, outcomeSetKey: "REVIEW_ADVICE",
      comments: review.comments.filter((c) => c.step === one.number)
        .map((c) => ({ id: c.id, authorName: c.author, text: c.text, progressionPreventing: c.blocking, status: c.status })),
    };
  });
  // An earlier step's answer is worked out from its comments; the words for it
  // come from the organization's published list, the Standard's own only until
  // that list exists.
  const adviceLabels = new Map<string, string>([...Object.entries(ADVICE_LABEL), ...(await getActiveSet("REVIEW_ADVICE")).map((a) => [a.code, a.label] as [string, string])]);
  const outcomeLabel = new Map(outcomes.map((o) => [o.code, o.label]));
  const said = (code: string) => adviceLabels.get(code) ?? outcomeLabel.get(code) ?? code;
  const earlier = advice.some((a) => a.outcome || a.comments.length) ? (
    <div className="rounded-lg bg-surface p-2.5 text-xs ring-1 ring-slate-200">
      <p className="mb-1 font-semibold text-slate-700">What the earlier steps said</p>
      <ul className="space-y-1.5 text-slate-600">
        {advice.map((a) => (
          <li key={a.id}>
            {a.outcome ? <><span className="font-semibold">{said(a.outcome)}</span> — {a.outcomeByName}{a.outcomeNote ? `: “${a.outcomeNote}”` : ""}</> : <span className="text-slate-400">no advice recorded yet</span>}
            {a.comments.length ? (
              <ul className="mt-1 space-y-0.5 border-l border-line pl-2">
                {a.comments.map((c) => (
                  <li key={c.id} className={c.progressionPreventing ? "text-red-700" : "text-slate-500"}>
                    {c.progressionPreventing ? "blocking" : "comment"} · {c.authorName}: {c.text}
                    {c.progressionPreventing && c.status === "CLOSED" ? " (settled)" : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  ) : null;
  // An adviser's own comments, so the form can hold their advice to them.
  const ownRows = step?.cycleId
    ? review.comments.filter((c) => c.authorId === user.id && c.step === run.currentStep + 1).map((c) => ({ progressionPreventing: c.blocking }))
    : [];
  const ownComments = { total: ownRows.length, blocking: ownRows.filter((c) => c.progressionPreventing).length };

  const waitingOn = step && step.status === "active"
    ? participants.filter((p) => step.participantIds.includes(p.id) && !(step.mode === "ALL" && (step.decidedBy ?? []).includes(p.id)))
    : [];
  // The step line already names who is on the step; the sheet says more only
  // when that is not the whole story — someone has answered, or the order matters.
  const partly = !!step && waitingOn.length < step.participantIds.length;

  const items: StepItem[] = [];
  if (step && step.status === "active" && iDecide) {
    /* A review is answered in one place — the review itself, where the
       document is on screen, the earlier steps are readable and the
       progress is drawn. This sheet says it is your turn and takes you
       there; a second copy of the form here would be a second place for
       the same act, and two places to answer means two things to keep
       right. */
    items.push(step.cycleId
      ? { key: "answer", primary: true, label: deciding ? "Give your verdict" : "Give your advice", href: `/reviews/${step.cycleId}` }
      : {
          key: "answer",
          primary: true,
          open: true,
          label: deciding ? "Give your verdict" : "Give your advice",
          body: (
            <ActionForm action={recordStepOutcomeAction} submitLabel={deciding ? "Give my verdict" : "Give my advice"} size="sm" hidden={{ runId: run.id }}>
              <VerdictDecision deciding={deciding} advice={!deciding && activeCycle ? await myAdvice(ctx, activeCycle.id, user.id) : null} verdicts={decisionOptions(outcomes)} statuses={statusOptions(statuses, step.grantsStatuses)} carrying={carrying} laterSteps={laterSteps} request={nextStep ? <RequestIssue onDecision author={author} reasons={issueReasons.map((one) => ({ code: one.code, label: one.label }))} proposed={nextStep.proposed} others={nextStep.others} parties={nextStep.parties} ours={nextStep.ours} askWho={askWho} /> : null} />
            </ActionForm>
          ),
        });
  } else if (step?.cycleId) {
    items.push({ key: "comments", label: "Comments and markups", href: `/reviews/${step.cycleId}` });
  }
  items.push(...extra);

  return (
    <Card
      title={iDecide ? "Next step: your decision" : "In review"}
      description={`${run.templateName} · step ${run.currentStep + 1} of ${run.steps.length}`}
      className="border-brand-line/30 bg-tint-soft"
      items={items}
      status={<>
        <ol className="space-y-1.5">
          {run.steps.map((s, i) => {
            const names = participants.filter((p) => s.participantIds.includes(p.id)).map((p) => p.name).join(", ")
              || (s.goesTo?.length ? `goes to ${s.goesTo.join(", ")}` : "");
            return (
              <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${s.status === "done" ? "bg-emerald-500 text-white" : s.status === "active" ? "bg-amber-500 text-white" : s.status === "declined" ? "bg-red-500 text-white" : "bg-slate-200 text-slate-500"}`}>
                  {s.status === "done" ? "✓" : i + 1}
                </span>
                <span className="font-medium text-slate-800">{s.title || (i === run.steps.length - 1 ? "Decision" : `Review ${i + 1}`)}</span>
                <Chip className={i === run.steps.length - 1 ? "bg-emerald-100 text-emerald-800 ring-emerald-300" : "bg-sky-100 text-sky-800 ring-sky-300"}>{i === run.steps.length - 1 ? "decision" : "advice"}</Chip>
                <span className="text-xs text-slate-500">{names}</span>
                {s.status === "active" ? <Chip className="bg-amber-100 text-amber-800 ring-amber-300">waiting</Chip> : null}
                {s.status === "active" && activeCycle?.dueAt ? (
                  <Chip className={dueState(activeCycle.dueAt, false) === "overdue" ? "bg-red-100 text-red-800 ring-red-300" : dueState(activeCycle.dueAt, false) === "at risk" ? "bg-amber-100 text-amber-900 ring-amber-400" : "bg-slate-100 text-slate-600 ring-slate-300"}>
                    due {fmtDate(activeCycle.dueAt)}
                  </Chip>
                ) : null}
                {s.status === "declined" ? <Chip className="bg-red-100 text-red-800 ring-red-300">declined</Chip> : null}
              </li>
            );
          })}
        </ol>

        {earlier ? <div className="mt-3">{earlier}</div> : null}

        {iDecide ? (
          <p className="mt-3 text-[13px] font-semibold text-brand-ink">
            It is your turn — {deciding ? "your verdict decides this revision." : "your advice goes to whoever decides."}
          </p>
        ) : alreadyGave || partly || serialNext ? (
          <p className="mt-3 text-[13px] text-slate-600">
            {alreadyGave ? "Your input is in. " : null}
            {partly || serialNext ? <>Still waiting on <strong className="text-slate-800">{waitingOn.map((p) => p.name).join(", ")}</strong>{serialNext ? ` — ${participants.find((p) => p.id === serialNext)?.name} goes first` : ""}.</> : null}
          </p>
        ) : null}
      </>}
    />
  );
}

function nextSerialParticipant(step: WfRuntimeStep): string | null {
  for (const p of step.participantIds) {
    if (!(step.decidedBy ?? []).includes(p)) return p;
  }
  return null;
}

// ── Records (§2.2–2.3) ───────────────────────────────────────────────────────

function RecordPanel({ doc, extra }: { doc: DocLite; extra: StepItem[] }) {
  const confirmed = doc.state !== "PLANNED";
  const own: StepItem = confirmed
    ? {
        key: "correct",
        label: "Issue a correction",
        body: (
          <ActionForm action={correctRecordAction} submitLabel="Create correction record" size="sm" hidden={{ documentId: doc.id }}>
            <Field label="Title of the correction" required>
              <input name="title" required className={inputCls} placeholder="e.g. Correction to minutes of 12 March — attendance corrected" />
            </Field>
          </ActionForm>
        ),
      }
    : {
        key: "confirm",
        primary: true,
        label: "Confirm this record",
        body: <ActionForm action={confirmRecordAction} submitLabel="Confirm this record (fixed forever)" size="sm" hidden={{ documentId: doc.id }} confirmText="Once confirmed, a record is never altered. Continue?" />,
      };
  return (
    <Card
      title="This is a record"
      description="Evidence that something happened. Fixed once confirmed."
      className="border-violet-300/50 bg-violet-50/30"
      items={[own, ...extra]}
      status={
        <p className="text-[13px] text-slate-600">
          {confirmed
            ? <>✓ Confirmed. The content is fixed — it will never be revised. If something is wrong, issue a <strong className="text-slate-800">correction</strong>: a new record that points to this one.</>
            : "Attach the evidence, then confirm. After that it cannot change."}
        </p>
      }
    />
  );
}

/**
 * Where the document stands, as a sheet of the register: a band naming the step
 * and saying what it is about, the body underneath, and a rail down the left in
 * the colour the register gives that state. The colour is read from the tone a
 * caller already asks for, so every state keeps the meaning it had.
 */
function Card({ title, description, className, status, items }: { title: string; description?: string; className?: string; status: React.ReactNode; items: StepItem[] }) {
  const tone = className ?? "";
  const rail = tone.includes("orange") ? "rail-prep"
    : tone.includes("emerald") ? "rail-released"
    : tone.includes("violet") ? "rail-superseded"
    : tone.includes("brand") ? "rail-review"
    : "rail-none";
  return (
    <section className={cn("register register-sheet register-sheet-open relative", rail)}>
      <span className="absolute inset-y-0 left-0 w-0.75 rounded-l-[0.875rem] bg-(--rail)" aria-hidden />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span className="stencil text-slate-600">{title}</span>
        {description ? <span className="text-[11px] text-slate-500">{description}</span> : null}
      </div>
      <NextStepBody status={status} items={items} />
    </section>
  );
}
