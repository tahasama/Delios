import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { notFound } from "next/navigation";
import { isController, isAdmin } from "@/lib/auth";
import { Card, Chip, Banner, btn, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { OUTCOME_CONSEQUENCES } from "@/lib/standard";
import { fmtDateTime } from "@/lib/utils";
import { getActiveSet } from "@/lib/config";
import { decisionOptions, statusOptions } from "@/lib/decision-options";
import { VerdictDecision } from "@/app/(app)/documents/[id]/verdict-status";
import { preflight } from "@/lib/rules/preflight";
import { Guarded } from "@/components/preflight";
import { issueToReviewAction, addCommentAction, closeCommentAction, recordOutcomeAction, returnToOriginatorAction } from "@/lib/actions/revisions";
import { reclassifyCommentAction } from "@/lib/actions/governance";
import { ArrowLeft, ExternalLink, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ReviewCyclePage({ params }: { params: Promise<{ id: string }> }) {
  const { user, db } = await requireScope();
  const { id } = await params;
  const cycle = await db.reviewCycle.findUnique({
    where: { id },
    include: {
      revision: { include: { document: true, files: true, approvals: true } },
      comments: { orderBy: { createdAt: "asc" } },
      assignments: { orderBy: { order: "asc" } },
      transmittal: true,
    },
  });
  if (!cycle) notFound();

  const [outcomes, commentClasses, statuses] = await Promise.all([getActiveSet(cycle.outcomeSetKey ?? "REVIEW_OUTCOMES"), getActiveSet("COMMENT_CLASSES"), getActiveSet("STATUSES")]);
  const verdictLabel = (code: string) => outcomes.find((o) => o.code === code)?.label ?? OUTCOME_CONSEQUENCES[code]?.label ?? code;
  const controller = isController(user) || isAdmin(user);
  const assigned = cycle.assignments.some((assignment) => assignment.userId === user.id);
  const rev = cycle.revision;
  const doc = rev.document;
  const rendition = rev.files.find((file) => file.kind === "RENDITION") ?? null;
  const blockingOpen = cycle.comments.filter((comment) => comment.progressionPreventing && comment.status === "OPEN");
  const myComments = cycle.comments.filter((comment) => comment.authorId === user.id);
  const canRecordOutcome = (assigned || controller) && !cycle.outcome && Boolean(cycle.issuedToReviewAt);
  const canReturn = controller && Boolean(cycle.outcome) && !cycle.returnedToOriginatorAt;
  const custody = [
    { label: "Submitted", at: cycle.submittedAt, holder: cycle.openedByName },
    { label: "Received by control", at: cycle.receivedAt, holder: "Document Control" },
    { label: "With reviewers", at: cycle.issuedToReviewAt, holder: cycle.assignments.map((assignment) => assignment.userName).join(", ") || "Unassigned" },
    { label: cycle.binding ? "Review returned" : "Advice given", at: cycle.returnedFromReviewAt, holder: cycle.binding ? "Document Control" : cycle.outcomeByName ?? "the reviewers" },
    { label: cycle.binding ? "Returned to author" : "Passed to whoever decides", at: cycle.binding ? cycle.returnedToOriginatorAt : cycle.returnedFromReviewAt, holder: cycle.binding ? doc.createdByName : "the deciding step" },
  ];
  const currentCustody = [...custody].reverse().find((point) => point.at) ?? custody[0];

  return (
    <div className="space-y-4">
      <header className="rounded-2xl border border-slate-200 bg-surface px-5 py-4 shadow-sm">
        <Link href={`/documents/${doc.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline"><ArrowLeft className="h-3.5 w-3.5"/> {doc.docNumber}</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-slate-950">{doc.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono font-bold text-slate-700">Rev {rev.value}</span>
              <Chip className={cycle.status === "OPEN" ? "bg-amber-100 text-amber-800 ring-amber-200" : "bg-slate-100 text-slate-600 ring-slate-200"}>Review {cycle.sequence} · {cycle.status === "OPEN" ? "open" : "closed"}</Chip>
              <span>{cycle.outcome ? `${OUTCOME_CONSEQUENCES[cycle.outcome]?.label ?? cycle.outcome} — ${cycle.outcomeByName ?? ""}` : `${currentCustody.label.toLowerCase()} · ${cycle.assignments.filter((assignment) => assignment.completedAt).length} of ${cycle.assignments.length} reviewers done`}</span>
            </div>
          </div>
          {rendition ? <a href={`/api/files/${rendition.id}`} target="_blank" className={btn("secondary", "sm")}><ExternalLink className="h-4 w-4"/> Open PDF</a> : null}
        </div>
      </header>

      {blockingOpen.length ? <Banner tone="danger" title="Progress is blocked">{blockingOpen.length} blocking comment{blockingOpen.length === 1 ? "" : "s"} must be resolved first.</Banner> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm">
            {rendition ? <iframe src={`/api/files/${rendition.id}`} title={`${doc.docNumber} revision ${rev.value}`} className="h-[640px] w-full"/> : <div className="grid h-48 place-items-center p-6 text-center"><div><FileText className="mx-auto h-8 w-8 text-slate-400"/><p className="mt-2 text-sm font-semibold text-slate-700">No PDF attached</p><Link href={`/documents/${doc.id}#workflow`} className="mt-2 inline-block text-xs font-semibold text-link hover:underline">Attach it on the document →</Link></div></div>}
          </section>

          <Card title={`Comments · ${cycle.comments.length}`}>
            {cycle.comments.length ? <ul className="space-y-3">{cycle.comments.map((comment) => <li key={comment.id} className={`rounded-xl border p-4 ${comment.progressionPreventing && comment.status === "OPEN" ? "border-red-200 bg-red-50/60" : "border-slate-200 bg-slate-50/60"}`}>
              <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-slate-800">{comment.authorName}</span><span className="text-[11px] text-slate-400">{fmtDateTime(comment.createdAt)}</span><Chip className={comment.progressionPreventing ? "bg-red-100 text-red-800 ring-red-200" : "bg-slate-100 text-slate-600 ring-slate-200"}>{comment.progressionPreventing ? "blocking" : "advisory"}</Chip>{comment.status === "CLOSED" ? <Chip className="bg-emerald-100 text-emerald-800 ring-emerald-200">resolved</Chip> : null}</div>
              <p className="mt-2 text-sm leading-6 text-slate-700">{comment.text}</p>{comment.resolution ? <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><strong>Resolution:</strong> {comment.resolution}</p> : null}
              {comment.progressionPreventing && comment.status === "OPEN" && (assigned || controller) ? <div className="mt-3 border-t border-red-100 pt-3"><ActionForm action={closeCommentAction} submitLabel="Resolve comment" size="sm" hidden={{ commentId: comment.id, cycleId: cycle.id }}><input name="resolution" required className={inputCls} placeholder="How was it resolved?"/></ActionForm></div> : null}
              {cycle.status === "OPEN" && (assigned || controller) ? <details className="mt-2"><summary className="cursor-pointer text-[11px] font-semibold text-slate-500">Change impact</summary><div className="mt-2"><ActionForm action={reclassifyCommentAction} submitLabel="Save" size="sm" hidden={{ commentId: comment.id, cycleId: cycle.id }}><label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="prevent" defaultChecked={comment.progressionPreventing}/> Blocks progression</label><input name="note" className={inputCls} placeholder="Why"/></ActionForm></div></details> : null}
            </li>)}</ul> : <p className="text-sm text-slate-400">No comments yet.</p>}
            {cycle.status === "OPEN" && (assigned || controller) ? <div className="mt-4 border-t border-slate-100 pt-4"><ActionForm action={addCommentAction} submitLabel="Add comment" size="sm" hidden={{ cycleId: cycle.id }}><Field label="Comment" required><textarea name="text" rows={3} required className={inputCls} placeholder="What needs to change, and where"/></Field><Field label="Impact" hint="blocking stops release until it is settled; not blocking is answered in the next revision"><select name="classification" className={inputCls} defaultValue={commentClasses.find((item) => item.props.progressionPreventing !== true)?.code ?? "NON_BLOCKING"}>{commentClasses.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></Field></ActionForm></div> : null}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card title={cycle.binding ? "Binding verdict" : "Advice"} description={cycle.binding ? "The one decision on this revision. A verdict that proceeds is its release approval, so only someone who may approve the document can give it." : "Input for the route's decider; it does not decide on its own."}>
            {cycle.outcome ? <div><p className="text-sm font-semibold text-slate-900"><span className="font-mono">{cycle.outcome}</span> · {verdictLabel(cycle.outcome)}</p><p className="mt-1 text-xs leading-5 text-slate-500">{OUTCOME_CONSEQUENCES[cycle.outcome]?.blurb}</p><p className="mt-3 text-xs text-slate-500">{cycle.outcomeByName}, {fmtDateTime(cycle.outcomeAt)}</p>{canReturn ? <div className="mt-4 border-t border-slate-100 pt-4"><ActionForm action={returnToOriginatorAction} submitLabel="Return to author" size="sm" hidden={{ cycleId: cycle.id }}/></div> : null}</div> : <Guarded result={await preflight("RECORD_OUTCOME", { cycleId: cycle.id })}><ActionForm action={recordOutcomeAction} submitLabel={cycle.binding ? "Give my verdict" : "Give my advice"} hidden={{ cycleId: cycle.id }}><VerdictDecision deciding={cycle.binding} verdicts={decisionOptions(outcomes)} statuses={statusOptions(statuses)} own={{ total: myComments.length, blocking: myComments.filter((c) => c.progressionPreventing).length }} /></ActionForm></Guarded>}
            {cycle.outcome ? null : <p className="mt-2 text-xs leading-5 text-slate-500">{!cycle.issuedToReviewAt ? "Document Control sends it to the reviewers first." : ""}</p>}
          </Card>

          {!cycle.issuedToReviewAt ? <Card title="Send to reviewers">{controller ? <ActionForm action={issueToReviewAction} submitLabel="Send to reviewers" hidden={{ cycleId: cycle.id }}/> : <p className="text-xs text-slate-500">Waiting for Document Control.</p>}</Card> : null}

          <Card title="Progress">
            <ol className="relative ml-2 space-y-4 border-l border-slate-200 pl-5">
              {custody.map((point) => (
                <li key={point.label} className="relative">
                  <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ${point.at ? "bg-emerald-500" : "border-2 border-slate-300 bg-surface"}`}/>
                  <p className="text-xs font-semibold text-slate-800">{point.label}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">{point.at ? fmtDateTime(point.at) : "not yet"}{point.label !== "With reviewers" ? ` · ${point.holder}` : ""}</p>
                  {point.label === "With reviewers" ? (
                    <ul className="mt-1 space-y-0.5">
                      {cycle.assignments.map((a) => <li key={a.id} className="text-[11px] text-slate-600">{a.completedAt ? "✓" : "○"} {a.userName}</li>)}
                      {!cycle.assignments.length ? <li className="text-[11px] text-slate-400">nobody assigned</li> : null}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </div>
  );
}

