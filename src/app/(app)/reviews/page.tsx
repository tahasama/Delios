import Link from "next/link";
import { after } from "next/server";
import { requireScope } from "@/lib/scope";
import { dueState } from "@/lib/workflow";
import { warnLateReviews } from "@/lib/review-risk";
import { getSet } from "@/lib/config";
import { PageHeader, DataTable, Th, Td, Chip, EmptyState, Info } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { OUTCOME_CONSEQUENCES } from "@/lib/standard";
import { ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews" };

const VIEWS = [
  { id: "ALL", label: "All" },
  { id: "OPEN", label: "Open" },
  { id: "CLOSED", label: "Closed" },
] as const;

/**
 * Every review ever made, one row per review — a document appears once for
 * each time it was reviewed. The deciding review of a route carries the
 * binding verdict; earlier steps are advice to it.
 */
export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireScope();
  const { db } = ctx;
  // One automatic warning per review that is about to miss its date. After that
  // it is Document Control's call, and their chase is a transmittal.
  after(() => warnLateReviews(ctx).catch(() => {}));
  const sp = await searchParams;
  const status = VIEWS.some((v) => v.id === sp.status) ? sp.status! : "ALL";
  const q = (sp.q ?? "").trim();
  const [cycles, counts, verdicts, adviceValues] = await Promise.all([
    db.reviewCycle.findMany({
      where: {
        ...(status === "ALL" ? {} : { status }),
        ...(q ? { revision: { document: { OR: [{ docNumber: { contains: q } }, { title: { contains: q } }] } } } : {}),
      },
      orderBy: { submittedAt: "desc" },
      take: 500,
      include: {
        revision: { select: { id: true, value: true, state: true, releasedAt: true, document: { select: { id: true, docNumber: true, title: true } } } },
        assignments: { orderBy: { order: "asc" } },
        comments: { where: { progressionPreventing: true, status: "OPEN" }, select: { id: true } },
      },
    }),
    db.reviewCycle.groupBy({ by: ["status"], _count: true }),
    getSet("REVIEW_OUTCOMES"),
    getSet("REVIEW_ADVICE"),
  ]);
  const count = (s: string) => (s === "ALL" ? counts.reduce((n, c) => n + c._count, 0) : counts.find((c) => c.status === s)?._count ?? 0);
  // Codes from the organization's list; older records may carry the Standard's
  // own consequence names (APPROVED, REVISE_AND_RESUBMIT…).
  const verdictLabel = new Map<string, string>([...Object.entries(OUTCOME_CONSEQUENCES).map(([k, v]) => [k, v.label] as [string, string]), ...verdicts.map((v) => [v.code, v.label] as [string, string]), ...adviceValues.map((v) => [v.code, v.label] as [string, string])]);
  const proceeds = new Map<string, boolean>([...Object.entries(OUTCOME_CONSEQUENCES).map(([k, v]) => [k, v.proceed] as [string, boolean]), ...verdicts.map((v) => [v.code, v.props.proceed === true] as [string, boolean])]);

  return (
    <div className="space-y-5">
      <PageHeader title="Reviews" subtitle="Every review ever made — a document appears once for each time it was reviewed. A decision releases the revision or sends it back; advice is input to that decision; a client review happens after we released it, and is answered by a new revision." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 rounded-xl bg-slate-100 p-1" aria-label="Which reviews">
          {VIEWS.map((v) => (
            <Link key={v.id} href={`/reviews?status=${v.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`} aria-current={status === v.id ? "page" : undefined} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${status === v.id ? "bg-surface text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
              {v.label} <span className="font-normal text-slate-400">{count(v.id)}</span>
            </Link>
          ))}
        </nav>
        <form className="flex gap-2">
          <input type="hidden" name="status" value={status} />
          <input name="q" defaultValue={q} placeholder="Document number or title" className="h-9 w-64 rounded-xl border border-slate-200 bg-surface px-3 text-xs outline-none focus:border-brand-line" />
        </form>
      </div>

      {cycles.length === 0 ? (
        <EmptyState title={status === "OPEN" ? "No review is open" : "No reviews"} body="A review starts when a revision is sent down a review route." />
      ) : (
        <DataTable
          id="reviews"
          defaultHidden={["Opened by", "Closed"]}
          head={
            <tr>
              <Th>Document</Th>
              <Th>Rev</Th>
              <Th>Kind <Info>A decision is the last step of a route and releases the revision or sends it back. Advice is any earlier step. A client review happens after we released it, and is answered by a new revision.</Info></Th>
              <Th>Verdict <Info>On a decision, the code the decider gave. On an advisory step, what that person’s comments amounted to — advisers are not asked for a code.</Info></Th>
              <Th>Reviewers</Th>
              <Th title="When this step has to be answered. It comes from the days the route gives the step.">Due</Th>
              <Th>Opened</Th>
              <Th>Opened by</Th>
              <Th>Closed</Th>
              <Th>Blocking <Info>Comments marked as stopping the release and not yet settled. While one is open the revision cannot be released, whatever the verdict says.</Info></Th>
              <Th />
            </tr>
          }
        >
          {cycles.map((c) => {
            // A review that starts after its revision was released is the recipient's, not ours.
            const postRelease = !!c.revision.releasedAt && c.submittedAt > c.revision.releasedAt;
            const done = c.assignments.filter((a) => a.completedAt).length;
            const state = dueState(c.dueAt, c.status !== "OPEN");
            const waitingOn = c.assignments.filter((a) => !a.completedAt);
            return (
              <tr key={c.id}>
                <Td className="min-w-[240px]">
                  <Link href={`/documents/${c.revision.document.id}`} className="font-mono text-xs font-bold text-link hover:underline">{c.revision.document.docNumber}</Link>
                  <span className="block max-w-72 truncate text-xs text-slate-500" title={c.revision.document.title}>{c.revision.document.title}</span>
                </Td>
                <Td className="font-mono text-xs font-semibold text-slate-800">{c.revision.value}</Td>
                <Td className="whitespace-nowrap">
                  <Chip className={postRelease ? "bg-violet-100 text-violet-800 ring-violet-300" : c.binding ? "bg-emerald-100 text-emerald-800 ring-emerald-300" : "bg-sky-100 text-sky-800 ring-sky-300"}
                    title={postRelease ? "The recipient reviewed a revision we had already released. Their verdict never changes it; a new revision answers it." : c.binding ? "The last step of the route. Its verdict releases the revision, or sends it back." : "An earlier step of the route. Input for whoever decides."}>
                    {postRelease ? "client review" : c.binding ? "decision" : "advice"}
                  </Chip>
                </Td>
                <Td className="whitespace-nowrap text-xs">
                  {c.outcome ? (
                    <span className={c.binding ? (proceeds.get(c.outcome) ? "text-emerald-700" : "text-red-700") : "text-slate-600"}>
                      {c.binding && verdictLabel.get(c.outcome) && verdictLabel.get(c.outcome) !== c.outcome && !(c.outcome in OUTCOME_CONSEQUENCES) ? <><span className="font-mono font-bold">{c.outcome}</span> {verdictLabel.get(c.outcome)}</> : <span className="font-semibold">{verdictLabel.get(c.outcome) ?? c.outcome}</span>}
                      {c.outcomeByName ? <span className="block text-[11px] text-slate-400">{c.outcomeByName}</span> : null}
                    </span>
                  ) : c.status === "OPEN" ? <span className="text-amber-700">waiting</span> : <span className="text-slate-300">—</span>}
                </Td>
                <Td className="text-xs">
                  {c.assignments.length ? <span title={c.assignments.map((a) => `${a.completedAt ? "✓" : "○"} ${a.userName}`).join("\n")}>{c.assignments.map((a) => a.userName).join(", ")}</span> : <span className="text-slate-400">unassigned</span>}
                  {c.status === "OPEN" && c.assignments.length > 1 ? <span className="block text-[11px] text-slate-400">{done} of {c.assignments.length} done</span> : null}
                </Td>
                <Td className="whitespace-nowrap text-xs tabular-nums">
                  {c.dueAt ? (
                    <>
                      <span className={state === "overdue" ? "font-semibold text-red-700" : state === "at risk" ? "font-semibold text-amber-700" : "text-slate-500"}>{fmtDate(c.dueAt)}</span>
                      <span className={`block font-sans text-[11px] ${state === "overdue" ? "text-red-600" : state === "at risk" ? "text-amber-700" : "text-slate-400"}`}>
                        {c.status === "OPEN" ? state : "answered"}
                      </span>
                      {c.status === "OPEN" && state !== "on time" ? (
                        <Link
                          href={`/transmittals/new?revisions=${c.revision.id}&users=${waitingOn.map((a) => a.userId).join(",")}&reason=REVIEW&subject=${encodeURIComponent(`${c.revision.document.docNumber} rev ${c.revision.value} — review still open`)}&message=${encodeURIComponent(`This review was due on ${fmtDate(c.dueAt)}. Please answer it.${c.riskNotifiedAt ? ` An automatic warning went out on ${fmtDate(c.riskNotifiedAt)}.` : ""}`)}`}
                          className="mt-0.5 block font-sans text-[11px] font-semibold text-link hover:underline"
                        >
                          Notify
                        </Link>
                      ) : null}
                      {c.riskNotifiedAt ? <span className="block font-sans text-[10px] text-slate-400">warned {fmtDate(c.riskNotifiedAt)}</span> : null}
                    </>
                  ) : (
                    <span className="text-slate-300" title="The route gives this step no time limit">—</span>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-xs tabular-nums text-slate-500">{fmtDate(c.submittedAt)}</Td>
                <Td className="whitespace-nowrap text-xs text-slate-500">{c.openedByName}</Td>
                <Td className="whitespace-nowrap text-xs tabular-nums text-slate-500">{c.outcomeAt ? fmtDate(c.outcomeAt) : "—"}</Td>
                <Td>{c.comments.length ? <Chip className="bg-red-100 text-red-800 ring-red-300">{c.comments.length} open</Chip> : <span className="text-xs text-slate-300">—</span>}</Td>
                <Td className="text-right"><Link href={`/reviews/${c.id}`} className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-link">Open <ArrowRight className="h-3.5 w-3.5" /></Link></Td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </div>
  );
}
