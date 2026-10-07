import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { api, ApiProblem } from "@/lib/api/client";
import type { DocumentView, ListValue, ReviewMe, ReviewView } from "@/lib/api/types";
import { requireSession, projectPath } from "@/lib/session";
import { LISTS } from "@/lib/lists";
import { Card, Chip, PageHeader } from "@/components/ui";
import { AnswerForm, CloseComment, CommentForm, DispatchForm, ProxyAnswerForm, ReleaseForm, ReturnForm, RewindForm } from "./forms";

export const dynamic = "force-dynamic";

function day(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";
}

const STEP_STATE: Record<string, string> = { WAITING: "waiting", OPEN: "open", DONE: "done" };
const REVIEW_STATE: Record<string, string> = { IN_PROGRESS: "In progress", DECIDED: "Decided", RELEASED: "Released", RETURNED: "Returned" };

/**
 * One review: its route step by step (who answered what, and when), the
 * comments, and what the signed-in person may do now: comment, answer,
 * record another organization's answer, release, return or send the route back.
 */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  let review: ReviewView;
  try {
    review = await api<ReviewView>(projectPath(session, `/reviews/${id}`));
  } catch (e) {
    if (e instanceof ApiProblem && e.status === 404) notFound();
    throw e;
  }
  const [me, doc, lists] = await Promise.all([
    api<ReviewMe>(projectPath(session, `/reviews/${id}/me`)),
    api<DocumentView>(projectPath(session, `/documents/${review.documentId}`)),
    api<Record<string, ListValue[]>>("/api/values", {
      query: { sets: [LISTS.verdicts, LISTS.statuses, LISTS.commentClasses, LISTS.returnReasons, LISTS.controlOutcomes, LISTS.advice].join(",") },
    }),
  ]);
  const active = (set: string) => (lists[set] ?? []).filter((v) => v.status === "ACTIVE");
  const opts = (set: string) => active(set).map((v) => ({ code: v.code, label: `${v.code}: ${v.label}` }));
  const label = (set: string, code: string | null) => (code ? lists[set]?.find((v) => v.code === code)?.label ?? code : "");
  /** An answer's name: a verdict on the deciding step, advice on the others. */
  const answerName = (code: string) => lists[LISTS.verdicts]?.find((v) => v.code === code)?.label ?? lists[LISTS.advice]?.find((v) => v.code === code)?.label ?? code;
  const outcomesFor = (act: string) => active(LISTS.controlOutcomes).filter((v) => v.props?.act === act).map((v) => ({ code: v.code, label: v.label }));

  const revision = doc.revisions.find((r) => r.id === review.revisionId);
  const open = review.steps.find((s) => s.state === "OPEN") ?? null;
  const running = review.state === "IN_PROGRESS";
  const decided = review.state === "DECIDED";
  const byProxy = open?.participation === "BY_PROXY";
  const answeredSteps = review.steps.filter((s) => s.state === "DONE").map((s) => ({ code: String(s.number), label: `Step ${s.number}: ${s.title}` }));
  const reachedSteps = review.steps.filter((s) => s.state !== "WAITING").map((s) => ({ code: String(s.number), label: `Step ${s.number}: ${s.title}` }));
  const laterSteps = open ? review.steps.filter((s) => s.number > open.number).map((s) => ({ code: String(s.number), label: `Settled at step ${s.number}: ${s.title}` })) : [];
  const grants = (open?.grantsStatuses ?? []).map((code) => ({ code, label: `${code}: ${label(LISTS.statuses, code)}` }));
  const pdf = revision?.files.find((f) => f.kind === "RENDITION" && f.status === "CLEAN" && f.submission === revision.submission);

  return (
    <div className="space-y-4">
      <Link href={`/documents/${review.documentId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"><ArrowLeft className="h-3.5 w-3.5" /> {doc.number}</Link>
      <PageHeader eyebrow={review.number} title={doc.title}
        subtitle={`${doc.number} rev ${revision?.value ?? "?"} · ${review.route} · started by ${review.startedBy}, ${day(review.startedAt)}`}
        actions={<>
          <Chip>{REVIEW_STATE[review.state] ?? review.state}</Chip>
          {review.verdict ? <Chip title={label(LISTS.verdicts, review.verdict)}>{review.verdict}{review.grantedStatus ? ` → ${review.grantedStatus}` : ""}</Chip> : null}
          {pdf ? <a href={`/api/files/${pdf.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline"><Download className="h-3.5 w-3.5" /> {pdf.name}</a> : null}
        </>} />
      {review.returnNote ? <p className="rounded bg-amber-50 px-4 py-2 text-sm text-amber-900">Sent back: {review.returnNote}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card title="The route" description="Step by step">
            <ol className="space-y-3">
              {review.steps.map((s) => (
                <li key={s.number} className={`rounded border px-3 py-2 ${s.state === "OPEN" ? "border-link/40 bg-tint-soft" : "border-line"}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-800">{s.number}. {s.title}{s.deciding ? " · decides" : ""}</span>
                    <span className="text-[11px] text-slate-500">{STEP_STATE[s.state] ?? s.state}{s.dueDate ? ` · due ${day(s.dueDate)}` : ""}</span>
                  </div>
                  <p className="text-[11px] text-slate-500">{s.party ? `${s.party}${s.participation === "BY_PROXY" ? " (answers in its own system; Document Control records it)" : ""}` : s.function}</p>
                  {s.participants.length ? (
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {s.participants.map((p) => (
                        <li key={p.name}>{p.name}: {p.answeredAt ? <><span className="font-semibold">{p.answer ? answerName(p.answer) : "answered"}</span>{p.grantedStatus ? ` → ${p.grantedStatus}` : ""} · {day(p.answeredAt)}{p.note ? ` · ${p.note}` : ""}</> : <span className="text-slate-400">waiting</span>}</li>
                      ))}
                    </ul>
                  ) : null}
                  {s.dispatchedAt ? <p className="mt-1 text-[11px] text-slate-500">Sent {day(s.dispatchedAt)} by {s.dispatchChannel}{s.dispatchRef ? ` (their reference ${s.dispatchRef})` : ""}{s.dispatchedBy ? `, recorded by ${s.dispatchedBy}` : ""}</p> : null}
                  {s.foreignAnswer ? <p className="mt-1 text-xs">They wrote: “{s.foreignAnswer}”{s.recordedBy ? `, recorded by ${s.recordedBy}` : ""}{s.evidenceFileId ? <> · <a href={`/api/files/${s.evidenceFileId}`} className="font-semibold text-link hover:underline">their copy</a></> : null}</p> : null}
                </li>
              ))}
            </ol>
          </Card>

          <Card title="Comments" description={review.comments.length ? `${review.comments.filter((c) => c.status === "OPEN").length} open` : undefined}>
            {review.comments.length === 0 ? <p className="text-sm text-slate-500">No comment.</p> : (
              <ul className="divide-y divide-line">
                {review.comments.map((c) => (
                  <li key={c.id} className="py-2 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-xs text-slate-500">Step {c.step} · {c.author} · {day(c.createdAt)} · {label(LISTS.commentClasses, c.class)}</span>
                      {c.status === "OPEN" ? (c.blocking ? <Chip className="bg-red-50 text-red-800 ring-red-200">blocking</Chip> : <Chip>open</Chip>) : <Chip className="bg-emerald-50 text-emerald-800 ring-emerald-200">settled</Chip>}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-slate-800">{c.text}</p>
                    {c.resolution ? <p className="mt-1 text-xs text-slate-500">Settled by {c.closedBy}: {c.resolution}</p> : null}
                    {c.status === "OPEN" && (me.seated || me.control) ? <CloseComment reviewId={review.id} commentId={c.id} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {running && open && me.seated && !me.answered && !byProxy ? (
            <Card title={open.deciding ? "Your verdict" : "Your answer"} description={open.title}>
              <AnswerForm reviewId={review.id} deciding={open.deciding} verdicts={opts(LISTS.verdicts)} statuses={grants} />
            </Card>
          ) : null}
          {running && open && (me.seated || me.control) && !byProxy ? (
            <Card title="Comment">
              <CommentForm reviewId={review.id} classes={active(LISTS.commentClasses).map((v) => ({ code: v.code, label: v.label }))} laterSteps={laterSteps} />
            </Card>
          ) : null}
          {running && open && byProxy && me.control ? (
            <Card title={`Acting for ${open.party}`} description="They answer in their own system. What you record is theirs, under your name.">
              {!open.dispatchedAt
                ? <DispatchForm reviewId={review.id} party={open.party ?? "them"} />
                : <ProxyAnswerForm reviewId={review.id} party={open.party ?? "them"} verdicts={opts(LISTS.verdicts)} statuses={grants} />}
            </Card>
          ) : null}
          {decided && me.control ? (
            <Card title="Document Control" description="Release it, or send it back">
              <div className="space-y-4">
                <ReleaseForm reviewId={review.id} outcomes={outcomesFor("release")} />
                <div className="border-t border-line pt-3">
                  <ReturnForm reviewId={review.id} outcomes={outcomesFor("return")} steps={reachedSteps} reasons={opts(LISTS.returnReasons)} />
                </div>
              </div>
            </Card>
          ) : null}
          {running && me.control && !decided ? (
            <Card title="Send it back" description="Document Control, at any point of the route">
              <ReturnForm reviewId={review.id} outcomes={outcomesFor("return")} steps={reachedSteps} reasons={opts(LISTS.returnReasons)} />
            </Card>
          ) : null}
          {running && me.seated && answeredSteps.length && open && open.number > 1 ? (
            <Card title="Send the route back" description="To a step that answered, if something there was wrong">
              <RewindForm reviewId={review.id} steps={answeredSteps.filter((s) => Number(s.code) < open.number)} reasons={opts(LISTS.returnReasons)} />
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
