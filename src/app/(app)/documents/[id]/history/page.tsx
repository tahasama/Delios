import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { backendDocument } from "@/lib/api/legacy";
import { documentSnapshots } from "@/lib/api/snapshots";
import { notFound } from "next/navigation";
import { parseSnapshotPayload, summarizeSnapshotChange } from "@/lib/history";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { Chip } from "@/components/ui";
import { ArrowLeft, ChevronRight, Download } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * The document as it was, on one page.
 *
 * Each recorded point opens where it stands: what changed, which revision it was
 * about, and the files that existed then. Everything else about the document —
 * its metadata, its reviews, its transmittals — is on the document itself and is
 * not restated here in a second vocabulary.
 */
export default async function DocumentHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireScope();
  const { id } = await params;
  const found = await backendDocument(ctx, id);
  if (!found) notFound();
  const document = { id: found.id, docNumber: found.number, title: found.title };
  const snapshots = await documentSnapshots(ctx, id);
  const points = snapshots.map((snapshot, index) => {
    const payload = parseSnapshotPayload(snapshot.payload);
    const previous = index > 0 ? parseSnapshotPayload(snapshots[index - 1].payload) : null;
    const revision = snapshot.revisionId
      ? payload.document.revisions.find((one) => one.id === snapshot.revisionId)
      : payload.document.revisions.at(-1);
    return { snapshot, revision, changes: summarizeSnapshotChange(payload, previous) };
  }).reverse();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{document.docNumber} — as it was</h1>
          <p className="mt-1.5 text-sm text-slate-500">Every point where something was recorded. Open one to see what changed and what was attached then.</p>
        </div>
        <Link href={`/documents/${id}`} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Current document
        </Link>
      </div>

      <section className="rounded-2xl border border-line bg-surface shadow-sm">
        {points.length ? (
          <ul className="divide-y divide-line">
            {points.map(({ snapshot, revision, changes }, index) => (
              <li key={snapshot.id}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5 hover:bg-slate-50">
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400 transition group-open:rotate-90" />
                    <span className="text-sm font-semibold text-slate-900">{eventLabel(snapshot.eventType)}</span>
                    {revision ? <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-600">rev {revision.value}</span> : null}
                    {index === 0 ? <Chip className="bg-amber-100 text-amber-800 ring-amber-300">latest</Chip> : null}
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{snapshot.eventLabel ?? ""}</span>
                    <span className="shrink-0 text-[11px] text-slate-400">{fmtDateTime(snapshot.capturedAt)} · {snapshot.actorName}</span>
                  </summary>

                  <div className="space-y-3 bg-slate-50/60 px-5 py-4 pl-11">
                    <div>
                      <p className="text-[11px] text-slate-400">What changed</p>
                      {changes.length ? (
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {changes.map((change) => <span key={change} className="rounded-lg bg-surface px-2.5 py-1 text-[11px] text-slate-600 ring-1 ring-slate-200">{change}</span>)}
                        </div>
                      ) : <p className="mt-1 text-xs text-slate-500">The first recorded point — nothing to compare it with.</p>}
                    </div>

                    {revision ? (
                      <div>
                        <p className="text-[11px] text-slate-400">Rev {revision.value} at this point</p>
                        <p className="mt-1 text-xs text-slate-700">
                          {human(revision.state)}
                          {revision.statusCode ? <> · <span className="font-mono font-semibold">{revision.statusCode}</span></> : null}
                          {revision.releasedAt ? ` · released ${fmtDate(revision.releasedAt)}${revision.releasedByName ? ` by ${revision.releasedByName}` : ""}` : null}
                        </p>
                        {revision.changeDescription ? <p className="mt-1 text-xs text-slate-600">{revision.changeDescription}</p> : null}
                        {revision.files.length ? (
                          <ul className="mt-2 space-y-1">
                            {revision.files.map((file) => (
                              <li key={file.id} className="flex items-center gap-2 text-xs">
                                <a href={`/api/files/${file.id}`} className="inline-flex items-center gap-1 font-semibold text-link hover:underline">
                                  <Download className="h-3 w-3" /> {file.name}
                                </a>
                                <span className="truncate font-mono text-[10px] text-slate-400">SHA-256 {file.sha256.slice(0, 16)}…</span>
                              </li>
                            ))}
                          </ul>
                        ) : <p className="mt-2 text-xs text-slate-400">No file was attached yet.</p>}
                      </div>
                    ) : <p className="text-xs text-slate-400">No revision had been established at this point.</p>}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-semibold text-slate-700">No recorded points yet</p>
            <p className="mt-1 text-xs text-slate-400">The next controlled event creates one.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function eventLabel(type: string) { return human(type).replace(/^./, (letter) => letter.toUpperCase()); }
function human(value: string) { return value.replaceAll("_", " ").toLowerCase(); }
