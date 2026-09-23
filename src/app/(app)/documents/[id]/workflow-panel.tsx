import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { mayContributeToDocument, type SessionUser } from "@/lib/auth";
import { Chip, Field, inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ActionForm } from "@/components/form";
import { recordStepOutcomeAction } from "@/lib/actions/workflow";
import { verdictEffect, VERDICT_EFFECT_SHORT } from "@/lib/verdict-effect";
import { getActiveSet } from "@/lib/config";
import { Send, CheckCircle2, Rocket } from "lucide-react";
import { getRunForRevision, type WfRuntimeStep } from "@/lib/workflow";
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
  if (run && run.status === "DONE") {
    return (
      <Card title="Next step: release" description={`${run.templateName} is complete.`} className="border-emerald-300/50 bg-emerald-50/40">
        <p className="flex items-center gap-2 text-sm text-slate-700">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Everyone has signed off. {controller ? "Release it below." : "Document Control releases it next."}
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
    return (
      <Card title={revs[0].state === "IN_REVIEW" ? "In review" : "Not in use"} className={revs[0].state === "IN_REVIEW" ? "border-brand-line/30 bg-tint-soft" : undefined}>
        <p className="text-sm text-slate-700">{revs[0].state === "IN_REVIEW" ? <>Rev {revs[0].value} is with its reviewers.</> : <>The latest revision (rev {revs[0].value}) is <strong>{revs[0].state.replaceAll("_", " ").toLowerCase()}</strong>.</>}</p>
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
  const { db } = await requireScope();
  const step = run.steps[run.currentStep];
  const allParticipantIds = [...new Set(run.steps.flatMap((item) => item.participantIds))];
  const participants = await db.user.findMany({ where: { id: { in: allParticipantIds } }, include: { party: true } });
  const mine = !!step && step.participantIds.includes(user.id);
  const activeCycle = step?.cycleId ? await db.reviewCycle.findUnique({ where: { id: step.cycleId } }) : null;
  const outcomeSetKey = activeCycle?.outcomeSetKey ?? "REVIEW_OUTCOMES";
  const outcomes = await getActiveSet(outcomeSetKey);
  const serialNext = step?.mode === "SERIAL" ? nextSerialParticipant(step) : null;
  const alreadyGave = !!step && step.mode === "ALL" && (step.decidedBy ?? []).includes(user.id);
  const iDecide = !!step && mine && !alreadyGave && (step.mode !== "SERIAL" || serialNext === user.id);
  // The last step decides; the earlier steps' verdicts are advice shown to the decider.
  const deciding = run.currentStep === run.steps.length - 1;
  const adviceCycleIds = run.steps.slice(0, run.currentStep).map((s) => s.cycleId).filter((id): id is string => !!id);
  const advice = deciding && adviceCycleIds.length
    ? await db.reviewCycle.findMany({ where: { id: { in: adviceCycleIds } }, select: { id: true, outcome: true, outcomeByName: true, outcomeNote: true } })
    : [];
  const outcomeLabel = new Map(outcomes.map((o) => [o.code, o.label]));

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
              <Chip className={i === run.steps.length - 1 ? "bg-emerald-100 text-emerald-800 ring-emerald-300" : "bg-sky-100 text-sky-800 ring-sky-300"}>{i === run.steps.length - 1 ? "decision" : "advice"}</Chip>
              <span className="text-xs text-slate-500">{names}</span>
              {s.status === "active" ? <Chip className="bg-amber-100 text-amber-800 ring-amber-300">waiting</Chip> : null}
              {s.status === "declined" ? <Chip className="bg-red-100 text-red-800 ring-red-300">declined</Chip> : null}
            </li>
          );
        })}
      </ol>

      {step && step.status === "active" ? (
        iDecide ? (
          <Action label={deciding ? "Your verdict decides this revision" : "Your advice goes to whoever decides"}>
            {advice.some((a) => a.outcome) ? (
              <div className="mb-3 rounded-lg bg-surface p-2.5 text-xs ring-1 ring-slate-200">
                <p className="mb-1 font-semibold text-slate-700">Advice from the earlier steps</p>
                <ul className="space-y-0.5 text-slate-600">
                  {advice.filter((a) => a.outcome).map((a) => <li key={a.id}><span className="font-mono font-semibold">{a.outcome}</span> {outcomeLabel.get(a.outcome!) ?? ""} — {a.outcomeByName}{a.outcomeNote ? `: “${a.outcomeNote}”` : ""}</li>)}
                </ul>
              </div>
            ) : null}
            <ActionForm action={recordStepOutcomeAction} submitLabel={deciding ? "Give my verdict" : "Give my advice"} size="sm" hidden={{ runId: run.id }}>
              <Field label={deciding ? "Verdict" : "Your verdict"} required hint={deciding ? "binding — a verdict that proceeds is the release approval" : "advice for the decider"}>
                <select name="outcome" required className={inputCls} defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {outcomes.map((o) => <option key={o.code} value={o.code}>{o.code} — {o.label} ({VERDICT_EFFECT_SHORT[verdictEffect(o.props)]})</option>)}
                </select>
              </Field>
              <Field label="Comment" hint="required if it goes back to the author">
                <textarea name="note" rows={2} className={inputCls} placeholder="what you checked / what must change" />
              </Field>
            </ActionForm>
            <p className="mt-2 text-[11px] text-slate-400">Recorded under your name. Verdicts come from your organization&apos;s list — <Link href="/guide/codes#outcome" className="underline">what each one means</Link>.</p>
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
            <div className="border-t border-slate-100 p-3.5">
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
    <section className={cn("rounded-2xl border border-slate-200 bg-surface px-5 py-3.5 shadow-sm", className)}>
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
      <summary className={`inline-flex cursor-pointer list-none items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${secondary ? "border border-slate-300 bg-surface text-slate-700 hover:bg-slate-50" : "bg-brand text-white hover:bg-brand-hover"}`}>
        {label}
      </summary>
      <div className="mt-2 rounded-lg border border-slate-200 bg-surface p-3.5">{children}</div>
    </details>
  );
}
