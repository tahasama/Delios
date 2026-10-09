import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { notFound } from "next/navigation";
import { Banner, Chip } from "@/components/ui";
import type { ScheduleChange } from "@/lib/schedule";
import { fmtDate } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import { scheduleVersions, dayOf } from "@/lib/api/schedule";

export const dynamic = "force-dynamic";

/** Each kind of change in plain words, and the rail its row carries. */
const CHANGE: Record<ScheduleChange["type"], { label: string; chip: string; rail: string }> = {
  NEW: { label: "New", chip: "bg-sky-100 text-sky-800 ring-sky-200", rail: "rail-review" },
  DATE_CHANGED: { label: "Date moved", chip: "bg-amber-100 text-amber-800 ring-amber-200", rail: "rail-prep" },
  DETAIL_CHANGED: { label: "Details changed", chip: "bg-amber-100 text-amber-800 ring-amber-200", rail: "rail-prep" },
  REMOVED: { label: "Removed", chip: "bg-red-100 text-red-800 ring-red-200", rail: "rail-void" },
  UNCHANGED: { label: "Unchanged", chip: "bg-slate-100 text-slate-700 ring-slate-200", rail: "rail-none" },
};

const STANDING: Record<string, string> = {
  PUBLISHED: "in force",
  SUPERSEDED: "an earlier version",
  FAILED: "could not be read",
};

/** One read of the schedule document: where it stands, and every activity it moved. */
export default async function ScheduleVersionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireScope();
  const { id } = await params;
  const versions = await scheduleVersions(ctx);
  const version = versions.find((one) => one.id === id);
  if (!version) notFound();
  // The read before it that took; the backend keeps what changed against it.
  const previous = versions.slice(versions.indexOf(version) + 1).find((one) => one.status !== "FAILED") ?? null;
  const TYPE: Record<string, ScheduleChange["type"]> = { NEW: "NEW", MOVED: "DATE_CHANGED", CHANGED: "DETAIL_CHANGED", REMOVED: "REMOVED" };
  const changes = version.view.changes.map((change) => ({
    type: TYPE[change.type] ?? "DETAIL_CHANGED",
    code: change.code,
    name: change.name,
    was: change.type === "NEW" ? null : dayOf(change.oldStart),
    now: change.type === "REMOVED" ? null : dayOf(change.newStart),
  })).sort((a, b) => a.code.localeCompare(b.code));
  const count = (type: ScheduleChange["type"]) => changes.filter((change) => change.type === type).length;
  const summary = [
    [count("NEW"), "new"],
    [count("DATE_CHANGED"), "moved"],
    [count("DETAIL_CHANGED"), "details changed"],
    [count("REMOVED"), "removed"],
    // Activities the read left as they were are counted, not listed.
    [version.view.unchanged, "unchanged"],
  ] as const;

  const th = "stencil px-3 py-2 text-left font-normal text-slate-500 first:pl-5 sm:first:pl-6";
  const td = "px-3 py-2.5 align-top first:pl-5 sm:first:pl-6";

  return (
    <section className="register register-sheet register-sheet-open">
      <div className="flex flex-col-reverse gap-3 border-b border-line px-5 pt-6 pb-3 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          {version.revision ? (
            <Link href={`/documents/${version.revision.document.id}`} className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500 hover:text-link hover:underline">{version.sourceName}</Link>
          ) : (
            <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">{version.sourceName}</p>
          )}
          <h1 className="plate-name mt-1 min-w-0">Schedule {version.versionLabel}</h1>
          <p className="plate-meta mt-2">
            Released {fmtDate(version.importedAt)} by {version.importedByName} &middot; {STANDING[version.status] ?? STANDING.SUPERSEDED}
            {version.status !== "FAILED" ? <> &middot; compared with {previous ? previous.versionLabel : "nothing before it"}</> : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/actions/schedules" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Schedule versions</Link>
        </div>
      </div>

      {version.status === "FAILED" ? (
        <div className="border-b border-line px-5 py-3.5 sm:px-6">
          <Banner tone="danger" title="This release could not be read">
            {version.notes ?? "The file did not match what a schedule is expected to hold."} The dates in force did not change. Fix the file and release the document again.
          </Banner>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
            <span className="stencil mr-1 text-slate-500">What changed</span>
            {summary.map(([value, label], i) => (
              <span key={label} className={`text-xs tabular-nums ${value ? "text-slate-700" : "text-slate-500"}`}>
                {i ? <span aria-hidden className="mr-3 text-slate-300">·</span> : null}
                <span className="font-semibold">{value}</span> {label}
              </span>
            ))}
          </div>

          {changes.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b border-line bg-tint-soft">
                  <tr><th className={th}>Action</th><th className={th}>Change</th><th className={th}>Was</th><th className={th}>Now</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {changes.map((change) => {
                    const kind = CHANGE[change.type];
                    return (
                      <tr key={`${change.type}-${change.code}`} className={`${kind.rail} hover:bg-tint-soft`}>
                        <td className={`${td} rail`}>
                          {change.type === "REMOVED"
                            ? <span className="font-mono font-semibold text-slate-700">{change.code}</span>
                            : <Link href={`/actions/${change.code}`} className="font-mono font-semibold text-brand-ink hover:underline">{change.code}</Link>}
                          <span className="block max-w-96 truncate text-slate-800" title={change.name}>{change.name}</span>
                        </td>
                        <td className={td}><Chip className={kind.chip}>{kind.label}</Chip></td>
                        <td className={`${td} whitespace-nowrap text-xs tabular-nums text-slate-500 ${change.type === "DATE_CHANGED" ? "line-through decoration-slate-400" : ""}`}>{change.was ? fmtDate(change.was) : "—"}</td>
                        <td className={`${td} whitespace-nowrap text-xs font-semibold tabular-nums text-slate-800`}>{change.now ? fmtDate(change.now) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-slate-500 sm:px-6">This release moved nothing: every activity kept its date.</p>
          )}
        </>
      )}
    </section>
  );
}
