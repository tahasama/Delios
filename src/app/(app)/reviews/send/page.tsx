import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader } from "@/components/ui";
import { SendForReview } from "@/components/send-for-review-panel";
import { RevisionChecklist } from "@/components/revision-checklist";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Start a review" };

type Search = { revisions?: string; revision?: string | string[] };

/**
 * Starting a review: which documents, then the route and its people. One
 * document or several, through the same form a single document's page uses.
 * Opened from the Reviews register it asks first which documents; opened from
 * a selection in the document register, it already knows.
 */
export default async function StartReviewPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { db } = await requireScope();
  const sp = await searchParams;
  const ids = [
    ...(sp.revisions ?? "").split(","),
    ...(Array.isArray(sp.revision) ? sp.revision : sp.revision ? [sp.revision] : []),
  ].map((v) => v.trim()).filter(Boolean);
  const chosen = ids.length
    ? await db.revision.findMany({ where: { id: { in: ids }, state: "IN_PREPARATION" }, include: { document: true } })
    : [];

  // What may be sent: a revision being prepared, with its file, and nothing
  // already running. One with no file cannot be reviewed, so it is not offered.
  const preparing = chosen.length ? [] : await db.revision.findMany({
    where: { state: "IN_PREPARATION", workflowRuns: { none: { status: "ACTIVE" } } },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { document: { select: { docNumber: true, title: true } } },
  });
  const ready = preparing.filter((r) => r.renditionFileId || r.nativeFileId);
  const waitingForFile = preparing.length - ready.length;

  const band = (n: number, title: string, says: string) => (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
      <span className="font-mono text-[11px] text-slate-400">{n}</span>
      <span className="stencil text-slate-600">{title}</span>
      <span className="text-[11px] text-slate-500">{says}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Start a review"
        subtitle="Which documents, then the route they follow and who is on each step. Each document goes down the route on its own."
        actions={<Link href="/reviews" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Reviews</Link>}
      />

      <section className="register register-sheet register-sheet-open">
        {band(1, "Which documents", "tick what goes down the same route — a revision being prepared, with its file attached")}
        {chosen.length ? (
          <div className="asking space-y-2 px-5 py-5 sm:px-6">
            <ul className="divide-y divide-line rounded-lg border border-line">
              {chosen.map((r) => (
                <li key={r.id} className="px-3 py-2 text-[13px]">
                  <Link href={`/documents/${r.documentId}`} className="doc-number">{r.document.docNumber}</Link>
                  <span className="text-slate-500"> rev {r.value} — {r.document.title}</span>
                  {!r.renditionFileId && !r.nativeFileId ? <span className="ml-2 text-[11px] font-semibold text-amber-700">no file yet — attach it before sending</span> : null}
                </li>
              ))}
            </ul>
            <Link href="/reviews/send" className="text-[11px] font-semibold text-link hover:underline">Choose other documents</Link>
          </div>
        ) : ready.length ? (
          // Ticking and going on reloads this page with the documents named, so
          // the routes offered are the ones that apply to all of them.
          <form method="get">
            <RevisionChecklist
              name="revision"
              rows={ready.map((r) => ({ id: r.id, number: r.document.docNumber, rev: r.value, status: r.statusCode, title: r.document.title }))}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
              <Link href="/reviews" className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
              <div className="flex items-center gap-3">
                {waitingForFile ? <span className="text-[11px] text-slate-400">{waitingForFile} more being prepared without a file yet</span> : null}
                <button type="submit" data-on="true" className="ask">Continue</button>
              </div>
            </div>
          </form>
        ) : (
          <p className="px-5 py-5 text-sm text-slate-500 sm:px-6">
            {waitingForFile
              ? `${waitingForFile} revision${waitingForFile === 1 ? " is" : "s are"} being prepared, but none has its file yet. Attach the file on the document, then send it.`
              : "No revision is being prepared, so there is nothing to send for review. A revision is started from its document."}
          </p>
        )}
      </section>

      {chosen.length ? (
        <section className="register register-sheet register-sheet-open">
          {band(2, "Route and people", "the route the documents follow, who is on each step, and who is copied in")}
          <div className="asking px-5 py-5 sm:px-6">
            <SendForReview revisionIds={chosen.map((r) => r.id)} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
