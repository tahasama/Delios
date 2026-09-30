import Link from "next/link";
import { requireScope } from "@/lib/scope";

import { PageHeader, Chip } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { ArrowLeft, ArrowRight, CalendarSync, FileUp, History } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Schedule versions" };

export default async function ScheduleVersionsPage() {
  const { db } = await requireScope();
  const versions = await db.scheduleVersion.findMany({ orderBy: { importedAt: "desc" }, include: { _count: { select: { activities: true } } } });
  const published = versions.find((version) => version.status === "PUBLISHED");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule versions"
        subtitle="Every schedule that has been in use, and what each one changed. New versions arrive through Controlled changes."
        actions={<Link href="/actions" className="inline-flex items-center gap-1.5 text-sm font-semibold text-link"><ArrowLeft className="h-4 w-4" /> Schedule & actions</Link>}
      />

      {published ? (
        <section className="flex items-center justify-between gap-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-5">
          <div className="flex items-center gap-4">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-surface text-emerald-700 shadow-sm"><CalendarSync className="h-5 w-5" /></span>
            <div><p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-700">Published schedule</p><p className="mt-1 text-base font-semibold text-slate-900">{published.sourceName} · {published.versionLabel}</p><p className="mt-1 text-xs text-slate-500">Published {fmtDate(published.publishedAt)} by {published.publishedByName}</p></div>
          </div>
          <Link href={`/actions/schedules/${published.id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-800">View version <ArrowRight className="h-4 w-4" /></Link>
        </section>
      ) : (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-5"><p className="text-sm font-semibold text-amber-900">No schedule version has been published yet.</p><p className="mt-1 text-xs text-amber-800/75">Existing action dates remain available, but they are not linked to a controlled schedule version.</p></section>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-line bg-surface shadow-sm">
          <header className="border-b border-line px-6 py-5"><div className="flex items-center gap-2"><FileUp className="h-4 w-4 text-link" /><h2 className="text-base font-semibold text-slate-900">Import a schedule update</h2></div><p className="mt-1 text-xs text-slate-500">A schedule change is issued formally and approved by someone other than whoever uploaded it.</p></header>
          <div className="px-6 py-5">
            <p className="text-sm text-slate-600">Schedule imports go through <strong>Controlled changes</strong>, together with every other configuration that arrives as a file. You upload it, see exactly which action dates would move, and an approver decides.</p>
            <Link href="/admin/controlled" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-link">Open controlled changes <ArrowRight className="h-4 w-4" /></Link>
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-surface shadow-sm">
          <header className="border-b border-line px-6 py-5"><div className="flex items-center gap-2"><History className="h-4 w-4 text-link" /><h2 className="text-base font-semibold text-slate-900">Version history</h2></div><p className="mt-1 text-xs text-slate-500">Drafts, the active published version, and superseded sources.</p></header>
          <div className="px-6 py-2">
            {versions.length ? <ul className="divide-y divide-line">{versions.map((version) => (
              <li key={version.id}><Link href={`/actions/schedules/${version.id}`} className="group flex items-center justify-between gap-4 py-4"><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold text-slate-800">{version.versionLabel}</p><StatusChip status={version.status} /></div><p className="mt-1 truncate text-xs text-slate-500">{version.sourceName} · {version._count.activities} activities</p><p className="mt-1 text-[11px] text-slate-400">Imported {fmtDate(version.importedAt)} by {version.importedByName}</p></div><ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" /></Link></li>
            ))}</ul> : <div className="py-12 text-center"><p className="text-sm font-semibold text-slate-700">No versions imported</p><p className="mt-1 text-xs text-slate-400">The first validated import will appear here.</p></div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const cls = status === "PUBLISHED" ? "bg-emerald-100 text-emerald-800 ring-emerald-200" : status === "DRAFT" ? "bg-sky-100 text-sky-800 ring-sky-200" : "bg-slate-100 text-slate-600 ring-slate-200";
  return <Chip className={cls}>{status.toLowerCase()}</Chip>;
}
