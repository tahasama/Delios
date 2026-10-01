import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { mayContributeToDocument, type SessionUser } from "@/lib/auth";
import { Chip, Field, inputCls, btn } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ActionForm } from "@/components/form";
import { recordStepOutcomeAction, submitForReleaseAction } from "@/lib/actions/workflow";
import { typeSkipsReview } from "@/lib/review-need";
import { decisionOptions, statusOptions } from "@/lib/decision-options";
import { requestChoices, authorOf, issuePolicy } from "@/lib/issue-requests";
import { RequestIssue } from "./request-issue";
import { ArrowRight } from "lucide-react";
import { ADVICE_LABEL } from "@/lib/standard";
import { getActiveSet } from "@/lib/config";
import { VerdictDecision } from "./verdict-status";
import { Send, CheckCircle2, Rocket } from "lucide-react";
import { getRunForRevision, dueState, myAdvice, type WfRuntimeStep } from "@/lib/workflow";
import { fmtDate } from "@/lib/utils";
import { confirmRecordAction, correctRecordAction } from "@/lib/actions/governance";
import { SendForReview } from "@/components/send-for-review-panel";
import { isController } from "@/lib/auth";

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
export async function WorkflowPanel({ doc, user, lead, extra: after }: { doc: DocLite; user: SessionUser; lead?: React.ReactNode; extra?: React.ReactNode }) {
  // Outside the send panel, the lead steps simply come first.
  const extra = <>{lead}{after}</>;
  if (doc.kind === "RECORD") return <RecordPanel doc={doc} extra={extra} />;

  const ctx = await requireScope();
  const { db } = ctx;
  const revs = await db.revision.findMany({
      where: { documentId: doc.id },
      orderBy: { createdAt: "desc" },
      include: { approvals: { orderBy: { decidedAt: "desc" } } },
    });
  const run = revs[0] ? await getRunForRevision(ctx, revs[0].id) : null;
  const inPrep = revs.find((r) => r.state === "IN_PREPARATION");
  const released = revs.find((r) => r.state === "RELEASED");
  const controller = isController(user);

  if (run && run.status === "ACTIVE") return <RunActivePanel run={run} user={user} extra={extra} />;
  // The latest revision decides what is waiting on whom. A finished run says
  // nothing about that: it stays finished after the revision is released.
  if (run && run.status === "DONE" && revs[0]?.state === "NOT_RELEASED") {
    const decided = await db.reviewCycle.findFirst({
      where: { revisionId: revs[0].id, binding: true, outcome: { not: null } },
      orderBy: { sequence: "desc" },
      select: { outcome: true, outcomeSetKey: true, outcomeByName: true },
    });
    const verdicts = await getActiveSet(decided?.outcomeSetKey ?? "REVIEW_OUTCOMES");
    const said = decided?.outcome ? verdicts.find((one) => one.code === decided.outcome) : null;
    const letsItOut = said ? said.props.proceed === true : true;
    return (
      <Card
        title={`Rev ${revs[0].value} is decided`}
        description={`Route: ${run.templateName}.`}
        className={letsItOut ? "border-emerald-300 bg-emerald-50" : "border-orange-300 bg-orange-50"}
      >
        <p className="flex items-start gap-2 text-sm text-slate-700">
          <CheckCircle2 className={`mt-0.5 h-4 w-4 ${letsItOut ? "text-emerald-600" : "text-orange-600"}`} />
          <span>
            {decided?.outcome ? <><strong>{said?.label ?? decided.outcome}</strong>{decided.outcomeByName ? ` — ${decided.outcomeByName}` : ""}. </> : null}
            {letsItOut
              ? controller ? "Release it below." : "Document Control releases it next."
              : controller ? "It asks for changes, so it is not released. Send it back below." : "It asks for changes, so Document Control will send it back."}
          </span>
        </p>
        {extra}
      </Card>
    );
  }
  if (run && run.status === "RETURNED") {
    return (
      <Card title="Next step: revise" description={`${run.templateName} returned it with changes.`} className="border-orange-300/50 bg-orange-50/40">
        <p className="text-sm text-slate-700">Prepare a new revision with the changes, then send it again. The returned revision keeps its outcome.</p>
        {extra}
      </Card>
    );
  }

  if (inPrep) return <SendPanel doc={doc} revId={inPrep.id} value={inPrep.value} hasFiles={!!(inPrep.renditionFileId || inPrep.nativeFileId)} user={user} lead={lead} extra={after} />;

  if (released) {
    return (
      <Card title="Current and in use" className="border-emerald-300/50 bg-emerald-50/30">
        <p className="text-sm text-slate-700">
          <Rocket className="mr-1.5 inline h-4 w-4 align-[-3px] text-emerald-600" />
          <strong>Rev {released.value}</strong> is released{released.statusCode ? ` as ${released.statusCode}` : ""}. Nothing is waiting on anyone.
        </p>
        {extra}
      </Card>
    );
  }
  if (revs.length > 0) {
    const unreviewed = revs[0].state === "NOT_RELEASED" && (await typeSkipsReview(ctx, doc.docType));
    return (
      <Card title={revs[0].state === "NOT_RELEASED" ? "Next step: release" : revs[0].state === "IN_REVIEW" ? "In review" : "Not in use"} className={revs[0].state === "IN_REVIEW" || revs[0].state === "NOT_RELEASED" ? "border-brand-line/30 bg-tint-soft" : undefined}>
        <p className="text-sm text-slate-700">{revs[0].state === "NOT_RELEASED" ? <>{unreviewed ? `${doc.docType} is not reviewed.` : "The route is finished."} Rev {revs[0].value} is at <strong>{revs[0].statusCode}</strong> and is <strong>not released</strong> until Document Control publishes it.</> : revs[0].state === "IN_REVIEW" ? <>Rev {revs[0].value} is with its reviewers.</> : <>The latest revision (rev {revs[0].value}) is <strong>{revs[0].state.replaceAll("_", " ").toLowerCase()}</strong>.</>}</p>
        {extra}
      </Card>
    );
  }
  return (
    <Card title="Next step: first revision" className="border-brand-line/30 bg-tint-soft">
      <p className="text-sm text-slate-700">The number is reserved. There is no content yet.</p>
      {mayContributeToDocument(user, doc) ? extra : <p className="mt-2 text-xs text-slate-500">Document Control or the author prepares it.</p>}
    </Card>
  );
}

// ── Sending: pick a template, override participants, go ─────────────────────

async function SendPanel({ doc, revId, value, hasFiles, user, lead, extra }: { doc: DocLite; revId: string; value: string; hasFiles: boolean; user: SessionUser; lead?: React.ReactNode; extra?: React.ReactNode }) {
  // Who sends: the author for internal work; Document Control always, and
  // only Document Control for what a supplier or other party produced.
  const isControl = isController(user);
  const external = !!doc.originator;
  const canSend = mayContributeToDocument(user, doc) && (isControl || (!external && user.id === doc.createdById));
  if (!canSend) {
    return (
      <Card title={`Rev ${value} is being prepared`}>
        <p className="text-sm text-slate-700">{external ? "Waiting for Document Control to send it for review." : "Waiting for the author to send it for review."}</p>
        {lead}
        {extra}
      </Card>
    );
  }
  // A type the organization does not review goes from here straight to release:
  // whoever would send it for review settles its status and who receives it.
  const ctx = await requireScope();
  if (await typeSkipsReview(ctx, doc.docType)) {
    const full = await ctx.db.document.findUniqueOrThrow({ where: { id: doc.id } });
    const [statuses, reasons, choices, author] = await Promise.all([
      getActiveSet("STATUSES"),
      getActiveSet("REASONS_FOR_ISSUE"),
      requestChoices(ctx, full),
      authorOf(ctx, revId),
    ]);
    return (
      <Card title="Next step: send on for release" description={`${doc.docType} is not reviewed — it goes from Prepare straight to release.`} className="border-brand-line/30 bg-tint-soft">
        <p className="text-sm text-slate-700"><strong>Rev {value}</strong> is being prepared{hasFiles ? " and has its file" : " — attach its file first: a PDF is what is released"}.</p>
        {lead}
        {hasFiles ? (
          <Action label={<><Rocket className="h-4 w-4" /> Send on for release</>}>
            <ActionForm action={submitForReleaseAction} submitLabel="Send on for release" hidden={{ revisionId: revId }}>
              <Field label="Released at" required>
                <select name="issuedFor" required defaultValue="" className={inputCls}>
                  <option value="" disabled>Choose the status…</option>
                  {statuses.map((one) => <option key={one.code} value={one.code}>{one.code} — {one.label}</option>)}
                </select>
              </Field>
              <RequestIssue onDecision author={author} reasons={reasons.map((one) => ({ code: one.code, label: one.label }))} proposed={choices.proposed} others={choices.others} parties={choices.parties} />
            </ActionForm>
          </Action>
        ) : null}
        {extra}
      </Card>
    );
  }
  return (
    <Card title="Next step: send for review" className="border-brand-line/30 bg-tint-soft">
      <p className="text-sm text-slate-700"><strong>Rev {value}</strong> is being prepared{hasFiles ? " and has its file" : " — no file yet (a PDF is needed before release)"}.</p>
      {lead}
      <Action label={<><Send className="h-4 w-4" /> Send for review / approval</>}>
        <SendForReview revisionIds={[revId]} />
      </Action>
      {extra}
    </Card>
  );
}

// ── Active run: step progress + the user's decision form ────────────────────

async function RunActivePanel({ run, user, extra }: { run: { id: string; templateName: string; steps: WfRuntimeStep[]; currentStep: number }; user: SessionUser; extra?: React.ReactNode }) {
  const ctx = await requireScope();
  const { db } = ctx;
  const step = run.steps[run.currentStep];
  const allParticipantIds = [...new Set(run.steps.flatMap((item) => item.participantIds))];
  const participants = await db.user.findMany({ where: { id: { in: allParticipantIds } }, include: { party: true } });
  const mine = !!step && step.participantIds.includes(user.id);
  const activeCycle = step?.cycleId ? await db.reviewCycle.findUnique({ where: { id: step.cycleId } }) : null;
  // The status the revision arrives at this step carrying, so the person either
  // changes it or confirms it on purpose.
  const carrying = activeCycle
    ? (await db.revision.findUnique({ where: { id: activeCycle.revisionId }, select: { statusCode: true } }))?.statusCode ?? null
    : null;
  const outcomeSetKey = activeCycle?.outcomeSetKey ?? "REVIEW_OUTCOMES";
  const outcomes = await getActiveSet(outcomeSetKey);
  const statuses = await getActiveSet("STATUSES");
  const serialNext = step?.mode === "SERIAL" ? nextSerialParticipant(step) : null;
  const alreadyGave = !!step && step.mode === "ALL" && (step.decidedBy ?? []).includes(user.id);
  const iDecide = !!step && mine && !alreadyGave && (step.mode !== "SERIAL" || serialNext === user.id);
  // The last step decides; the earlier steps' verdicts are advice shown to the decider.
  const deciding = run.currentStep === run.steps.length - 1;
  // The deciding step is offered the first request.
  const nextStep = deciding && activeCycle && !activeCycle.outcome && (await issuePolicy(ctx)).asked
    ? await requestChoices(ctx, (await db.revision.findUniqueOrThrow({ where: { id: activeCycle.revisionId }, select: { document: true } })).document)
    : null;
  const issueReasons = nextStep ? await getActiveSet("REASONS_FOR_ISSUE") : [];
  const author = nextStep && activeCycle ? await authorOf(ctx, activeCycle.revisionId) : null;
  // The steps still to come, for a reservation held against one of them.
  const laterSteps = run.steps.slice(run.currentStep + 1).map((one, index) => ({
    number: run.currentStep + 2 + index,
    title: one.title ?? `Step ${run.currentStep + 2 + index}`,
  }));
  const adviceCycleIds = run.steps.slice(0, run.currentStep).map((s) => s.cycleId).filter((id): id is string => !!id);
  const advice = adviceCycleIds.length
    ? await db.reviewCycle.findMany({
        where: { id: { in: adviceCycleIds } },
        select: { id: true, outcome: true, outcomeByName: true, outcomeNote: true, outcomeSetKey: true, comments: { select: { id: true, authorName: true, text: true, progressionPreventing: true, status: true }, orderBy: { createdAt: "asc" } } },
      })
    : [];
  // An earlier step's answer is worked out from its comments; the words for it
  // come from the organization's published list, the Standard's own only until
  // that list exists.
  const adviceLabels = new Map<string, string>([...Object.entries(ADVICE_LABEL), ...(await getActiveSet("REVIEW_ADVICE")).map((a) => [a.code, a.label] as [string, string])]);
  const outcomeLabel = new Map(outcomes.map((o) => [o.code, o.label]));
  const said = (code: string) => adviceLabels.get(code) ?? outcomeLabel.get(code) ?? code;
  const earlier = advice.some((a) => a.outcome || a.comments.length) ? (
    <div className="mb-3 rounded-lg bg-surface p-2.5 text-xs ring-1 ring-slate-200">
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
  const ownRows = step?.cycleId ? await db.reviewComment.findMany({ where: { cycleId: step.cycleId, authorId: user.id }, select: { progressionPreventing: true } }) : [];
  const ownComments = { total: ownRows.length, blocking: ownRows.filter((c) => c.progressionPreventing).length };

  return (
    <Card title={iDecide ? "Next step: your decision" : "In review"} description={`${run.templateName} · step ${run.currentStep + 1} of ${run.steps.length}`} className="border-brand-line/30 bg-tint-soft">
      <ol className="mb-4 space-y-1.5">
        {run.steps.map((s, i) => {
          const names = participants.filter((p) => s.participantIds.includes(p.id)).map((p) => p.name).join(", ");
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

      {earlier}

      {step && step.status === "active" ? (
        iDecide ? (
          /* A review is answered in one place — the review itself, where the
             document is on screen, the earlier steps are readable and the
             progress is drawn. This card says it is your turn and takes you
             there; a second copy of the form here would be a second place for
             the same act, and two places to answer means two things to keep
             right. */
          <Action label={deciding ? "It is your turn — your verdict decides this revision" : "It is your turn — your advice goes to whoever decides"}>
            {step.cycleId ? (
              <Link href={`/reviews/${step.cycleId}`} className={btn("primary", "sm")}>
                Open the review <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <ActionForm action={recordStepOutcomeAction} submitLabel={deciding ? "Give my verdict" : "Give my advice"} size="sm" hidden={{ runId: run.id }}>
                <VerdictDecision deciding={deciding} advice={!deciding && activeCycle ? await myAdvice(ctx, activeCycle.id, user.id) : null} verdicts={decisionOptions(outcomes)} statuses={statusOptions(statuses, step.grantsStatuses)} carrying={carrying} laterSteps={laterSteps} request={nextStep ? <RequestIssue onDecision author={author} reasons={issueReasons.map((one) => ({ code: one.code, label: one.label }))} proposed={nextStep.proposed} others={nextStep.others} parties={nextStep.parties} /> : null} />
              </ActionForm>
            )}
          </Action>
        ) : (
          <p className="text-sm text-slate-600">
            {alreadyGave ? "Your input is in. " : null}Waiting on <strong>{participants.filter((p) => step.participantIds.includes(p.id) && !(step.mode === "ALL" && (step.decidedBy ?? []).includes(p.id))).map((p) => p.name).join(", ")}</strong>
            {serialNext ? ` — ${participants.find((p) => p.id === serialNext)?.name} goes first` : ""}.
          </p>
        )
      ) : null}
      {step?.cycleId ? <Link href={`/reviews/${step.cycleId}`} className="mt-3 inline-block text-xs font-medium text-brand-ink hover:underline">Comments and markups →</Link> : null}
      {extra}
    </Card>
  );
}

function nextSerialParticipant(step: WfRuntimeStep): string | null {
  for (const p of step.participantIds) {
    if (!(step.decidedBy ?? []).includes(p)) return p;
  }
  return null;
}

// ── Records (§2.2–2.3) ───────────────────────────────────────────────────────

function RecordPanel({ doc, extra }: { doc: DocLite; extra?: React.ReactNode }) {
  const confirmed = doc.state !== "PLANNED";
  return (
    <Card title="This is a record" description="Evidence that something happened. Fixed once confirmed." className="border-violet-300/50 bg-violet-50/30">
      {confirmed ? (
        <p className="text-sm text-slate-700">✓ Confirmed. The content is fixed — it will never be revised. If something is wrong, issue a <strong>correction</strong> (a new record that points to this one).</p>
      ) : (
        <p className="text-sm text-slate-700">Attach the evidence, then confirm. After that it cannot change.</p>
      )}
      <div className="mt-3">
        {confirmed ? (
          <details className="rounded-lg border border-violet-200 bg-surface">
            <summary className="cursor-pointer px-3.5 py-2.5 text-sm font-medium text-violet-800">Issue a correction of this record</summary>
            <div className="border-t border-line p-3.5">
              <ActionForm action={correctRecordAction} submitLabel="Create correction record" size="sm" hidden={{ documentId: doc.id }}>
                <Field label="Title of the correction" required>
                  <input name="title" required className={inputCls} placeholder="e.g. Correction to minutes of 12 March — attendance corrected" />
                </Field>
              </ActionForm>
            </div>
          </details>
        ) : (
          <ActionForm action={confirmRecordAction} submitLabel="Confirm this record (fixed forever)" size="sm" hidden={{ documentId: doc.id }} confirmText="Once confirmed, a record is never altered. Continue?" />
        )}
      </div>
      {extra}
    </Card>
  );
}

/** The Next step block: one compact box, title and context on one line. */
function Card({ title, description, className, children }: { title: string; description?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-2xl border border-line bg-surface px-5 py-3.5 shadow-sm", className)}>
      <p className="text-sm font-semibold text-slate-900">
        {title}
        {description ? <span className="ml-2 text-xs font-normal text-slate-500">{description}</span> : null}
      </p>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

/**
 * An action in the Next step box: a button that opens its form in place.
 * Only rendered for people allowed to take it, so what you see is what you can do.
 */
export function Action({ label, secondary, children }: { label: React.ReactNode; secondary?: boolean; children: React.ReactNode }) {
  return (
    <details className="group mt-2 open:w-full">
      <summary className={`inline-flex cursor-pointer list-none items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${secondary ? "border border-line-strong bg-surface text-slate-700 hover:bg-slate-50" : "bg-brand text-white hover:bg-brand-hover"}`}>
        {label}
      </summary>
      <div className="mt-2 rounded-lg border border-line bg-surface p-3.5">{children}</div>
    </details>
  );
}
