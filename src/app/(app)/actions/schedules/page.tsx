import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { scheduleVersions } from "@/lib/api/schedule";
import { fmtDate } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Schedule versions" };

/** A read's standing, in words: in force, an earlier one, or one that could not be read. */
const STANDING: Record<string, { label: string; rail: string; tone: string }> = {
  PUBLISHED: { label: "In force", rail: "rail-released", tone: "text-emerald-800" },
  SUPERSEDED: { label: "Earlier", rail: "rail-none", tone: "text-slate-500" },
  FAILED: { label: "Could not be read", rail: "rail-void", tone: "text-red-700" },
};

/**
 * Every release of the schedule document, read on its own. The newest good
 * read is the one in force; the others are kept, with what each one moved.
 */
export default async function ScheduleVersionsPage() {
  const versions = await scheduleVersions(await requireScope());
  const inForce = versions.find((version) => version.status === "PUBLISHED") ?? null;
  const th = "stencil px-3 py-2 text-left font-normal text-slate-500 first:pl-5 sm:first:pl-6";
  const td = "px-3 py-2.5 align-top first:pl-5 sm:first:pl-6";

  return (
    <section className="register register-sheet register-sheet-open">
      <div className="border-b border-line px-5 pt-6 pb-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="plate-title min-w-0 text-slate-950">Schedule versions</h1>
          <Link href="/actions" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Schedule</Link>
        </div>
        <p className="plate-meta mt-2">
          {inForce
            ? <>In force: <Link href={`/actions/schedules/${inForce.id}`} className="font-mono font-semibold text-brand-ink hover:underline">{inForce.sourceName} {inForce.versionLabel}</Link>, released {fmtDate(inForce.publishedAt)} by {inForce.publishedByName} &middot; {inForce._count.activities} activities</>
            : "No schedule is in force yet."}
        </p>
        <p className="mt-1 max-w-2xl text-[11.5px] leading-4 text-slate-500">
          Each time the schedule document is released, its dates are read in and the actions follow. There is nothing to approve here: the release was the approval.
        </p>
      </div>

      {versions.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-line bg-tint-soft">
              <tr><th className={th}>Version</th><th className={th}>Standing</th><th className={th}>Released</th><th className={th}>What it changed</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {versions.map((version) => {
                const standing = STANDING[version.status] ?? STANDING.SUPERSEDED;
                const { added, moved, changed, removed } = version.view;
                const said = [added && `${added} new`, moved && `${moved} moved`, changed && `${changed} changed`, removed && `${removed} removed`].filter(Boolean).join(" · ");
                return (
                  <tr key={version.id} className={`${standing.rail} hover:bg-tint-soft`}>
                    <td className={`${td} rail`}>
                      <Link href={`/actions/schedules/${version.id}`} className="font-mono font-semibold text-brand-ink hover:underline">{version.sourceName} {version.versionLabel}</Link>
                      <span className="block text-xs text-slate-500">{version._count.activities} activities</span>
                    </td>
                    <td className={`${td} text-xs font-semibold ${standing.tone}`}>
                      {standing.label}
                      {version.status === "FAILED" && version.notes ? <span className="block max-w-80 font-normal">{version.notes}</span> : null}
                    </td>
                    <td className={`${td} whitespace-nowrap text-xs text-slate-600`}>{fmtDate(version.importedAt)}<span className="block text-slate-500">{version.importedByName}</span></td>
                    <td className={`${td} text-xs tabular-nums text-slate-600`}>{version.status === "FAILED" ? "—" : said || "Nothing"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-5 py-8 text-center text-sm text-slate-500 sm:px-6">
          No schedule has been read yet. Release the schedule document and its dates are read in on their own.
        </p>
      )}
    </section>
  );
}
