import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { notFound } from "next/navigation";
import { isController, isAdmin } from "@/lib/auth";

import { Chip, DataTable, PageHeader, Th, Td } from "@/components/ui";
import { compareScheduleActivities, type ScheduleChange } from "@/lib/schedule";
import { fmtDate } from "@/lib/utils";
import { ArrowLeft, CalendarCheck2, CircleAlert, GitCompareArrows } from "lucide-react";
import { ControlledSource } from "@/components/controlled-source";

export const dynamic = "force-dynamic";

export default async function ScheduleVersionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, db } = await requireScope();
  const { id } = await params;
  const version = await db.scheduleVersion.findUnique({ where: { id }, include: { activities: { orderBy: { actionCode: "asc" } } } });
  if (!version) notFound();
  const previous = await db.scheduleVersion.findFirst({
    where: { sourceName: version.sourceName, id: { not: version.id }, status: { in: ["PUBLISHED", "SUPERSEDED"] }, importedAt: { lt: version.importedAt } },
    orderBy: { importedAt: "desc" },
    include: { activities: true },
  });
  const [sourceRelation, sourceOptions] = await Promise.all([
    db.relationship.findFirst({ where: { kind: "CONTROL_SOURCE", fromType: "ScheduleVersion", fromId: version.id }, orderBy: { createdAt: "desc" } }),
    db.revision.findMany({ orderBy: { createdAt: "desc" }, include: { document: { select: { docNumber: true, title: true } } }, take: 250 }),
  ]);
  const controlledSource = sourceRelation ? await db.revision.findUnique({ where: { id: sourceRelation.toId }, include: { document: { select: { id: true, docNumber: true, title: true } } } }) : null;
  const changes = compareScheduleActivities(version.activities, previous?.activities ?? []);
  const counts = {
    new: changes.filter((change) => change.type === "NEW").length,
    date: changes.filter((change) => change.type === "DATE_CHANGED").length,
    detail: changes.filter((change) => change.type === "DETAIL_CHANGED").length,
    removed: changes.filter((change) => change.type === "REMOVED").length,
    unchanged: changes.filter((change) => change.type === "UNCHANGED").length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${version.sourceName} · ${version.versionLabel}`}
        subtitle={`Imported ${fmtDate(version.importedAt)} by ${version.importedByName}. ${version.notes ?? "No import note was provided."}`}
        actions={<Link href="/actions/schedules" className="inline-flex items-center gap-1.5 text-sm font-semibold text-link"><ArrowLeft className="h-4 w-4" /> Schedule versions</Link>}
      />

      <ControlledSource label="schedule document" sourceType="ScheduleVersion" sourceId={version.id} returnPath={`/actions/schedules/${version.id}`} source={controlledSource} options={sourceOptions} canLink={isController(user) || isAdmin(user)} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
        <section className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-tint text-link"><GitCompareArrows className="h-5 w-5" /></span><div><p className="text-sm font-semibold text-slate-900">Change summary</p><p className="mt-0.5 text-xs text-slate-500">Compared with {previous ? `${previous.versionLabel}, imported ${fmtDate(previous.importedAt)}` : "an empty starting point"}.</p></div></div>
          <div className="mt-5 grid grid-cols-5 gap-2"><ChangeMetric label="New" value={counts.new} tone="blue" /><ChangeMetric label="Date changes" value={counts.date} tone="amber" /><ChangeMetric label="Detail changes" value={counts.detail} tone="amber" /><ChangeMetric label="Removed" value={counts.removed} tone="red" /><ChangeMetric label="Unchanged" value={counts.unchanged} tone="slate" /></div>
        </section>
        <section className={`min-w-[330px] rounded-2xl border p-6 shadow-sm ${version.status === "DRAFT" ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
          <div className="flex items-center gap-3">{version.status === "DRAFT" ? <CircleAlert className="h-5 w-5 text-amber-700" /> : <CalendarCheck2 className="h-5 w-5 text-emerald-700" />}<div><p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Status</p><p className="mt-1 text-sm font-semibold text-slate-900">{version.status === "DRAFT" ? "Draft—live dates unchanged" : version.status === "PUBLISHED" ? "Published to live actions" : "Superseded history"}</p></div></div>
          {version.status === "DRAFT" ? <p className="mt-5 text-xs text-slate-600">Approve it in <Link href="/admin/controlled" className="font-semibold text-link">Controlled changes</Link> — the decision is recorded there with its reason.</p> : null}
          {version.publishedAt ? <p className="mt-4 text-xs text-slate-500">Published {fmtDate(version.publishedAt)} by {version.publishedByName}</p> : null}
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-sm">
        <header className="border-b border-slate-100 px-6 py-5"><h2 className="text-base font-semibold text-slate-900">Activity comparison</h2><p className="mt-1 text-xs text-slate-500">Every imported activity is identified by its action code. Dates shown in red or amber will affect readiness when this version is published.</p></header>
        <DataTable id="schedule-changes" className="rounded-none border-0 shadow-none" head={<tr><Th>Change</Th><Th>Action</Th><Th>Activity</Th><Th>Previous date</Th><Th>New date</Th><Th>Responsible party</Th></tr>}>
          {changes.map((change) => <ChangeRow key={`${change.type}-${change.activity.actionCode}`} change={change} />)}
        </DataTable>
      </section>
    </div>
  );
}

function effectiveDate(activity: ScheduleChange["activity"] | null) { return activity ? activity.forecastDate ?? activity.baselineDate : null; }

function ChangeRow({ change }: { change: ScheduleChange }) {
  const tint = change.type === "REMOVED" ? "[&>td]:bg-red-50/60" : change.type === "DATE_CHANGED" ? "[&>td]:bg-amber-50/50" : undefined;
  return (
    <tr className={tint}>
      <Td className="whitespace-nowrap"><ChangeChip type={change.type} /></Td>
      <Td className="whitespace-nowrap font-mono text-xs font-bold text-link">{change.activity.actionCode}</Td>
      <Td className="min-w-[240px]"><p className="text-sm font-medium text-slate-800">{change.activity.name}</p><p className="mt-0.5 text-[11px] text-slate-400">{change.activity.externalId}</p></Td>
      <Td className={`whitespace-nowrap text-xs tabular-nums text-slate-500 ${change.type === "DATE_CHANGED" ? "line-through decoration-slate-300" : ""}`}>{fmtDate(effectiveDate(change.previous))}</Td>
      <Td className="whitespace-nowrap text-xs font-semibold tabular-nums text-slate-800">{change.type === "REMOVED" ? "—" : fmtDate(effectiveDate(change.activity))}</Td>
      <Td className="text-xs text-slate-500">{change.activity.responsibleParty ?? "—"}</Td>
    </tr>
  );
}

function ChangeChip({ type }: { type: ScheduleChange["type"] }) {
  const map = { NEW: ["new", "bg-sky-100 text-sky-800 ring-sky-200"], DATE_CHANGED: ["date changed", "bg-amber-100 text-amber-800 ring-amber-200"], DETAIL_CHANGED: ["details changed", "bg-amber-100 text-amber-800 ring-amber-200"], REMOVED: ["removed", "bg-red-100 text-red-800 ring-red-200"], UNCHANGED: ["unchanged", "bg-slate-100 text-slate-600 ring-slate-200"] } as const;
  return <Chip className={map[type][1]}>{map[type][0]}</Chip>;
}

function ChangeMetric({ label, value, tone }: { label: string; value: number; tone: "blue" | "amber" | "red" | "slate" }) {
  const cls = { blue: "bg-sky-50 text-sky-700", amber: "bg-amber-50 text-amber-700", red: "bg-red-50 text-red-700", slate: "bg-slate-50 text-slate-600" }[tone];
  return <div className={`rounded-xl px-3 py-3 ${cls}`}><p className="text-lg font-semibold tabular-nums">{value}</p><p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide opacity-75">{label}</p></div>;
}
