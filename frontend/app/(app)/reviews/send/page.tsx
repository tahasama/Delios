import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { preparingRevisions, preparingOf } from "@/lib/reviews/api";
import { PageHeader } from "@/components/ui";
import { SendForReview } from "@/components/send-for-review-panel";
import { ArrowLeft, Plus } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Start a review" };

type Search = { revisions?: string; revision?: string | string[]; docs?: string };

/**
 * Starting a review: which documents, then the route and its people. One
 * document or several, through the same form a single document's page uses.
 * Opened from the Reviews register it asks first which documents; opened from
 * a selection in the document register, it already knows.
 */
export default async function StartReviewPage({ searchParams }: { searchParams: Promise<Search> }) {
  const scope = await requireScope();
  const sp = await searchParams;
  const ids = [
    ...(sp.revisions ?? "").split(","),
    ...(Array.isArray(sp.revision) ? sp.revision : sp.revision ? [sp.revision] : []),
  ].map((v) => v.trim()).filter(Boolean);
  // Ticked in the register (opened for this form, as for an action): each document at its revision being prepared.
  const docIds = (sp.docs ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const fromRegister = docIds.length ? await preparingOf(scope, docIds) : { ready: [], not: [] };
  const chosen = ids.length ? await preparingRevisions(scope, ids) : fromRegister.ready;
  // The register, opened for this form: what is chosen starts ticked; "Continue" comes back here with the ticks.
  const pickHref = (docs: string[]) => `/documents?${new URLSearchParams({ pick: `rv:/reviews/send${docs.length ? `?docs=${docs.join(",")}` : ""}`, rev: "IN_PREPARATION" })}`;

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

      {/* Where you are: the two steps as one instrument, as on every form that has steps. */}
      <nav aria-label="Steps" className="seg w-fit max-w-full">
        <Link href="/reviews/send" aria-current={chosen.length ? undefined : "page"} className="segment"><span className="segment-n">1</span> Which documents</Link>
        <span aria-current={chosen.length ? "page" : undefined} aria-disabled={!chosen.length} className={`segment ${chosen.length ? "" : "opacity-45"}`}><span className="segment-n">2</span> Route and people</span>
      </nav>

      <section className={`register register-sheet register-sheet-open ${chosen.length ? "hidden" : ""}`}>
        {band(1, "Which documents", "tick what goes down the same route — a revision being prepared, with its file attached")}
        {chosen.length ? null : (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
            <p className="text-xs leading-5 text-slate-500">
              {fromRegister.not.length
                ? <span className="text-amber-800">Nothing of {fromRegister.not.join(", ")} is being prepared with its file: a revision is started on its document. </span>
                : null}
              Tick them in the register, as for an action: it opens on the revisions being prepared.
            </p>
            <Link href={pickHref(docIds)} className="ask inline-flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Choose documents</Link>
          </div>
        )}
      </section>

      {chosen.length ? (
        <section className="register register-sheet register-sheet-open">
          {band(2, "Route and people", "the route the documents follow, who is on each step, and who is copied in")}
          <div className="asking space-y-2 px-5 py-5 sm:px-6">
            <ul className="divide-y divide-line rounded-md ring-1 ring-line">
              {chosen.map((r) => (
                <li key={r.id} className="px-3 py-2 text-[13px]">
                  <Link href={`/documents/${r.documentId}`} className="doc-number">{r.document.docNumber}</Link>
                  <span className="text-slate-500"> rev {r.value} — {r.document.title}</span>
                  {!r.renditionFileId && !r.nativeFileId ? <span className="ml-2 text-[11px] font-semibold text-amber-700">no file yet — attach it before sending</span> : null}
                </li>
              ))}
            </ul>
            {fromRegister.not.length ? <p className="text-[11px] text-amber-800">Not in it, nothing being prepared: {fromRegister.not.join(", ")}.</p> : null}
            <Link href={pickHref(chosen.map((r) => r.documentId))} className="text-[11px] font-semibold text-link hover:underline">Add or take out documents</Link>
          </div>

          <div className="asking px-5 py-5 sm:px-6">
            <SendForReview revisionIds={chosen.map((r) => r.id)} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
