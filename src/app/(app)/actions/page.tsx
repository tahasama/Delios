import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { Chip, DataTable, Th, Td } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { notifyDepartmentsAction } from "@/lib/actions/requirements";
import { departmentsOf } from "@/lib/schedule";
import { clearance } from "@/lib/requirements-process";
import { fmtDate } from "@/lib/utils";
import { Download } from "lucide-react";
import { after } from "next/server";
import { warnOnceAtRisk } from "@/lib/risk-notice";
import { PlanCards } from "./plan-cards";
import { PlanTimeline } from "./plan-timeline";

export const dynamic = "force-dynamic";
export const metadata = { title: "Schedule & actions" };

type Readiness = "READY" | "AT_RISK" | "NOT_READY" | "UNKNOWN";

export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ view?: string; dept?: string }> }) {
  const ctx = await requireScope();
  const { db } = ctx;
  const mayChange = ctx.can("CONTROL") || ctx.can("CONFIGURE");
  const { view, dept } = await searchParams;
  const [actions, publishedVersion, draftCount] = await Promise.all([
    db.action.findMany({
      orderBy: [{ scheduledDate: "asc" }, { code: "asc" }],
      include: { confirmations: true, entries: { include: { document: { include: { revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1 } } } } } },
    }),
    db.scheduleVersion.findFirst({ where: { status: "PUBLISHED" }, orderBy: { publishedAt: "desc" } }),
    db.scheduleVersion.count({ where: { status: "DRAFT" } }),
  ]);

  const rows = actions.map((action) => {
    const total = action.entries.length;
    const missing = action.entries.filter((entry) => entry.document.revisions[0]?.statusCode !== entry.requiredStatus);
    const ready = total - missing.length;
    const daysUntil = action.scheduledDate ? Math.ceil((action.scheduledDate.getTime() - Date.now()) / 86_400_000) : null;
    let readiness: Readiness = "UNKNOWN";
    if (total > 0 && missing.length === 0) readiness = "READY";
    else if (total > 0 && daysUntil !== null && daysUntil < 0) readiness = "NOT_READY";
    else if (total > 0 && daysUntil !== null) readiness = "AT_RISK";
    const firstNeeded = action.entries.map((e) => e.requiredBy).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] ?? null;
    // The next document still owed — what a controller chases first.
    const nextNeeded = missing.map((e) => e.requiredBy).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] ?? null;
    return { ...action, total, ready, missing, daysUntil, readiness, firstNeeded, nextNeeded };
  });
  // The first time an activity shows as at risk, its departments are told once,
  // by the system. Done after the page is served so nothing waits on it.
  const newlyAtRisk = rows.filter((r) => (r.readiness === "AT_RISK" || r.readiness === "NOT_READY") && !r.riskNotifiedAt);
  if (newlyAtRisk.length && ctx.can("CONTROL")) after(() => warnOnceAtRisk(ctx, newlyAtRisk));

  const counts: Record<Readiness, number> = {
    READY: rows.filter((row) => row.readiness === "READY").length,
    AT_RISK: rows.filter((row) => row.readiness === "AT_RISK").length,
    NOT_READY: rows.filter((row) => row.readiness === "NOT_READY").length,
    UNKNOWN: rows.filter((row) => row.readiness === "UNKNOWN").length,
  };
  const activeView = (["READY", "AT_RISK", "NOT_READY", "UNKNOWN"] as string[]).includes(view ?? "") ? view as Readiness : null;
  // Step 5: pick your department and see the actions that concern it.
  const disciplineRows = await db.configValue.findMany({ where: { setKey: "DISCIPLINES" }, select: { code: true, label: true } });
  const deptLabel = new Map(disciplineRows.map((d) => [d.code, d.label]));
  const usedDepts = [...new Set(rows.flatMap((r) => departmentsOf(r)))].sort();
  const untagged = rows.filter((r) => !departmentsOf(r).length).length;
  const filtered = rows
    .filter((row) => (activeView ? row.readiness === activeView : true))
    .filter((row) => (dept === "NONE" ? !departmentsOf(row).length : dept ? departmentsOf(row).includes(dept) : true));
  const qs = (next: { view?: string | null; dept?: string | null }) => {
    const p = new URLSearchParams();
    const v = next.view === undefined ? activeView : next.view;
    const d = next.dept === undefined ? dept : next.dept;
    if (v) p.set("view", v);
    if (d) p.set("dept", d);
    return p.size ? `/actions?${p}` : "/actions";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Schedule & actions</h1>
          <p className="mt-1 text-sm text-slate-500">
            {publishedVersion ? `Dates from ${publishedVersion.sourceName} · ${publishedVersion.versionLabel}, published ${fmtDate(publishedVersion.publishedAt)}` : "Dates are entered by hand — no schedule loaded"}
            {draftCount ? <> · <Link href="/actions/schedules" className="font-semibold text-amber-700 hover:underline">{draftCount} new version{draftCount === 1 ? "" : "s"} to review</Link></> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/api/export/baseline" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-surface px-3.5 py-2 text-sm font-semibold text-slate-700"><Download className="h-4 w-4" /> Export</a>
        </div>
      </div>

      <nav className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 sm:w-fit" aria-label="Filter">
        {([null, "NOT_READY", "AT_RISK", "READY", "UNKNOWN"] as (Readiness | null)[]).map((v) => {
          const n = v ? counts[v] : rows.length;
          return (
            <Link key={v ?? "all"} href={qs({ view: v })} aria-current={activeView === v ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${activeView === v ? "bg-surface text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
              {v ? readinessLabel(v) : "All"}
              {n ? <span className={`ml-1.5 rounded px-1.5 text-[10px] ${v === "NOT_READY" ? "bg-red-200 text-red-900" : v === "AT_RISK" ? "bg-amber-200 text-amber-900" : "bg-slate-200 text-slate-600"}`}>{n}</span> : null}
            </Link>
          );
        })}
      </nav>

      <PlanCards />

      <PlanTimeline rows={filtered.map((r) => ({ code: r.code, name: r.name, scheduledDate: r.scheduledDate, firstNeeded: r.firstNeeded, readiness: r.readiness, ready: r.ready, total: r.total }))} />

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="mr-1 font-semibold text-slate-500">Department</span>
        <Link href={qs({ dept: null })} className={`rounded-full px-2.5 py-1 ${!dept ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>All</Link>
        {usedDepts.map((d) => (
          <Link key={d} href={qs({ dept: d })} className={`rounded-full px-2.5 py-1 ${dept === d ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`} title={deptLabel.get(d)}>{deptLabel.get(d) ?? d}</Link>
        ))}
        {untagged ? <Link href={qs({ dept: "NONE" })} className={`rounded-full px-2.5 py-1 ${dept === "NONE" ? "bg-amber-600 text-white" : "bg-amber-100 text-amber-800 hover:bg-amber-200"}`}>Needs departments ({untagged})</Link> : null}
      </div>

      <section>
        {filtered.length ? (
          <DataTable id="actions" head={<tr><Th>Action</Th><Th>Departments</Th><Th>Status</Th><Th>Date</Th><Th label="Documents ready" className="text-right">Ready</Th><Th>Next due</Th><Th>Still missing</Th><Th>Confirmed</Th></tr>}>
                {filtered.map((action) => (
                  <tr key={action.id}>
                    <Td className="min-w-[260px] max-w-sm"><Link href={`/actions/${action.code}`} className="font-mono text-xs font-bold text-link hover:underline">{action.code}</Link><p className="mt-0.5 truncate text-sm font-semibold text-slate-800" title={action.name}>{action.name}</p><p className="mt-0.5 text-[11px] text-slate-400">{action.ownerName ?? "Responsible party not assigned"}</p></Td>
                    <Td>{departmentsOf(action).length ? (
                      <>
                        <div className="flex max-w-56 flex-wrap gap-1">{departmentsOf(action).map((d) => <span key={d} className="whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{deptLabel.get(d) ?? d}</span>)}</div>
                        {mayChange ? <div className="mt-1.5"><ActionForm action={notifyDepartmentsAction} submitLabel="Notify" size="sm" variant="secondary" hidden={{ actionId: action.id }} /></div> : null}
                      </>
                    ) : <span className="text-xs font-semibold text-amber-700">needs departments</span>}</Td>
                    <Td className="whitespace-nowrap"><ReadinessChip state={action.readiness} /></Td>
                    <Td className="whitespace-nowrap"><p className="text-sm font-medium tabular-nums text-slate-800">{fmtDate(action.scheduledDate)}</p><p className={`mt-0.5 text-[11px] ${action.daysUntil !== null && action.daysUntil < 0 ? "font-semibold text-red-600" : "text-slate-400"}`}>{datePhrase(action.daysUntil)}</p></Td>
                    <Td className="whitespace-nowrap text-right"><ReadyBar ready={action.ready} total={action.total} /></Td>
                    <Td className="whitespace-nowrap text-xs tabular-nums">{action.nextNeeded ? <span className={action.nextNeeded.getTime() < Date.now() ? "font-semibold text-red-600" : "text-slate-600"}>{fmtDate(action.nextNeeded)}</span> : <span className="text-slate-300">—</span>}</Td>
                    <Td className="min-w-[240px]">{action.missing.length ? (
                      <ul className="space-y-1">
                        {action.missing.slice(0, 3).map((entry) => (
                          <li key={entry.document.docNumber} className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="whitespace-nowrap font-mono text-[11px] font-semibold text-slate-700">{entry.document.docNumber}</span>
                            <span className="whitespace-nowrap rounded bg-amber-100 px-1 py-px text-[10px] font-bold text-amber-800" title={`Needs status ${entry.requiredStatus}`}>needs {entry.requiredStatus}</span>
                          </li>
                        ))}
                        {action.missing.length > 3 ? <li><Link href={`/actions/${action.code}`} className="text-[11px] font-semibold text-link hover:underline">+{action.missing.length - 3} more</Link></li> : null}
                      </ul>
                    ) : action.total === 0 ? <p className="text-xs text-slate-400">No document requirements agreed yet</p> : <p className="text-xs font-medium text-emerald-700">Nothing missing</p>}</Td>
                    <Td className="whitespace-nowrap text-xs">{(() => { const c = clearance(action); return !c.depts.length ? <span className="text-slate-300">—</span> : c.cleared ? <span className="font-semibold text-emerald-700">Cleared</span> : <span className={c.short.length ? "font-semibold text-red-700" : "text-slate-500"}>{c.confirmed.length} of {c.depts.length}{c.short.length ? ` · ${c.short.join(", ")} short` : ""}</span>; })()}</Td>
                  </tr>
                ))}
          </DataTable>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-surface px-6 py-14 text-center shadow-sm"><p className="text-sm font-semibold text-slate-700">{actions.length ? `No ${activeView ? readinessLabel(activeView).toLowerCase() : "matching"} actions` : "No actions planned yet"}</p><p className="mt-1 text-xs text-slate-400">{actions.length ? "Choose another readiness view." : "Load the schedule to begin — activities come only from it."}</p></div>
        )}
      </section>

    </div>
  );
}

function readinessLabel(state: Readiness) { return ({ READY: "Ready", AT_RISK: "At risk", NOT_READY: "Not ready", UNKNOWN: "Unknown" } as const)[state]; }

function datePhrase(days: number | null) {
  if (days === null) return "No date from schedule";
  if (days === 0) return "Scheduled today";
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  return `${days} day${days === 1 ? "" : "s"} remaining`;
}



function ReadinessChip({ state }: { state: Readiness }) {
  const classes = { READY: "bg-emerald-100 text-emerald-800 ring-emerald-200", AT_RISK: "bg-amber-100 text-amber-800 ring-amber-200", NOT_READY: "bg-red-100 text-red-800 ring-red-200", UNKNOWN: "bg-slate-100 text-slate-600 ring-slate-200" };
  return <Chip className={classes[state]}>{readinessLabel(state)}</Chip>;
}

/** "3 / 5" with a thin bar, so a column of them reads at a glance. */
function ReadyBar({ ready, total }: { ready: number; total: number }) {
  if (!total) return <span className="text-xs text-slate-300">—</span>;
  const pct = Math.round((ready / total) * 100);
  return (
    <div className="inline-flex flex-col items-end gap-1">
      <span className="text-sm font-semibold tabular-nums text-slate-800">{ready}<span className="font-normal text-slate-400"> / {total}</span></span>
      <span className="h-1 w-14 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full rounded-full ${pct === 100 ? "bg-emerald-500" : pct ? "bg-amber-500" : "bg-red-400"}`} style={{ width: `${Math.max(pct, 4)}%` }} /></span>
    </div>
  );
}
