import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { notFound } from "next/navigation";
import { parseSnapshotPayload, summarizeSnapshotChange } from "@/lib/history";
import { fmtDateTime } from "@/lib/utils";
import { ArrowLeft, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DocumentHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { db } = await requireScope();
  const { id } = await params;
  const document = await db.document.findUnique({ where: { id }, select: { id: true, docNumber: true, title: true, state: true } });
  if (!document) notFound();
  const snapshots = await db.documentSnapshot.findMany({ where: { documentId: id }, orderBy: { capturedAt: "asc" } });
  const enriched = snapshots.map((snapshot, index) => {
    const payload = parseSnapshotPayload(snapshot.payload);
    const previous = index > 0 ? parseSnapshotPayload(snapshots[index - 1].payload) : null;
    return { snapshot, payload, changes: summarizeSnapshotChange(payload, previous) };
  }).reverse();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-6">
        <div><h1 className="text-2xl font-semibold tracking-tight text-slate-950">{document.docNumber} — as it was</h1><p className="mt-1.5 text-sm text-slate-500">Navigate the document as it existed at each controlled event—not only as it looks today.</p></div>
        <Link href={`/documents/${id}`} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700"><ArrowLeft className="h-4 w-4" /> Current document</Link>
      </div>


      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-100 px-6 py-5"><h2 className="text-base font-semibold text-slate-900">History navigator</h2><p className="mt-1 text-xs text-slate-500">Select any point to inspect its metadata, revisions, review evidence, files, schedule links and distribution context.</p></header>
        {enriched.length ? (
          <ol className="relative mx-6 border-l border-slate-200 py-2">
            {enriched.map(({ snapshot, payload, changes }, index) => {
              const selectedRevision = snapshot.revisionId ? payload.document.revisions.find((revision) => revision.id === snapshot.revisionId) : payload.document.revisions.at(-1);
              return (
                <li key={snapshot.id} className="relative ml-6 border-b border-slate-100 py-5 last:border-0">
                  <span className={`absolute -left-[31px] top-6 h-3 w-3 rounded-full ring-4 ring-white ${index === 0 ? "bg-[#d9a441]" : "bg-[#6f8ca5]"}`} />
                  <div className="flex items-start justify-between gap-5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-slate-900">{eventLabel(snapshot.eventType)}</p>{selectedRevision ? <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-600">rev {selectedRevision.value} · {selectedRevision.state.replaceAll("_", " ").toLowerCase()}</span> : null}{index === 0 ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">latest recorded point</span> : null}</div>
                      <p className="mt-1 text-xs text-slate-400">{fmtDateTime(snapshot.capturedAt)} · {snapshot.actorName}</p>
                      {snapshot.eventLabel ? <p className="mt-2 text-sm leading-5 text-slate-600">{snapshot.eventLabel}</p> : null}
                      <div className="mt-3 flex flex-wrap gap-2">{changes.map((change) => <span key={change} className="rounded-lg bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">{change}</span>)}</div>
                    </div>
                    <Link href={`/documents/${id}/history/${snapshot.id}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-[#315f83] transition hover:bg-slate-50">Inspect this point <ArrowRight className="h-3.5 w-3.5" /></Link>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : <div className="px-6 py-14 text-center"><p className="text-sm font-semibold text-slate-700">No recorded points yet</p><p className="mt-1 text-xs text-slate-400">The next important lifecycle event will create one automatically.</p></div>}
      </section>
    </div>
  );
}

function eventLabel(type: string) { return type.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase()); }

