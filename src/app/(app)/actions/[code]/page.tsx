import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { notFound } from "next/navigation";
import { PageHeader, Card, Chip, DataTable, Th, Td, Banner, inputCls, btn } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { confirmReadinessAction } from "@/lib/actions/requirements";
import { clearance } from "@/lib/requirements-process";
import { departmentsOf, DEFAULT_LEAD_BUSINESS_DAYS, businessDaysBefore } from "@/lib/schedule";
import { shortfall } from "@/lib/risk-notice";
import { fmtDate } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * One scheduled activity and everything it needs. Departments are tagged by
 * the project manager; the documents come from the approved requirements list.
 */
export default async function ActionDetailPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ dept?: string }> }) {
  const ctx = await requireScope();
  const { db } = ctx;
  const { code } = await params;
  const { dept } = await searchParams;
  const action = await db.action.findFirst({
    where: { code },
    include: {
      entries: { include: { document: { include: { revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1 } } } }, orderBy: [{ department: "asc" }, { requiredBy: "asc" }] },
      scheduleActivities: { include: { scheduleVersion: true }, orderBy: { scheduleVersion: { importedAt: "desc" } }, take: 1 },
      confirmations: true,
    },
  });
  if (!action) notFound();

  const [disciplines, parties, functions] = await Promise.all([
    db.configValue.findMany({ where: { setKey: "DISCIPLINES", status: "ACTIVE" }, orderBy: { label: "asc" }, select: { code: true, label: true } }),
    db.configValue.findMany({ where: { setKey: "SUPPLIER_CODES" }, select: { code: true, label: true } }),
    db.function.findMany({ select: { code: true, name: true } }),
  ]);
  const deptLabel = (c: string | null) => (c ? disciplines.find((d) => d.code === c)?.label ?? c : "—");
  const partyLabel = (c: string | null) => (c ? parties.find((p) => p.code === c)?.label ?? c : "Us");
  const fnLabel = (c: string | null) => (c ? functions.find((f) => f.code === c)?.name ?? c : "—");

  const depts = departmentsOf(action);
  const control = ctx.can("CONTROL");
  const me = await db.projectMembership.findFirst({ where: { projectId: ctx.projectId, userId: ctx.user.id, active: true } });
  const clear = clearance(action);
  // Confirmation opens with the review window: from submit-by to the activity.
  const confirmOpens = action.scheduledDate ? businessDaysBefore(action.scheduledDate, DEFAULT_LEAD_BUSINESS_DAYS) : null;
  const entries = dept ? action.entries.filter((e) => e.department === dept) : action.entries;
  const readyCount = action.entries.filter((e) => e.document.revisions[0]?.statusCode === e.requiredStatus).length;
  const overdue = action.scheduledDate && new Date(action.scheduledDate) < new Date();
  const readiness = action.entries.length === 0 ? "UNKNOWN" : readyCount === action.entries.length ? "READY" : overdue ? "NOT_READY" : "AT_RISK";
  // Who is short, and the transmittal that tells them — the placeholder numbers
  // are named in it, and the sender adds anyone else who should see it.
  const short = shortfall(action).filter((s) => depts.includes(s.department));
  const deptPeople = await db.projectMembership.findMany({ where: { projectId: ctx.projectId, active: true, department: { in: depts } }, select: { userId: true } });
  const remindHref = `/transmittals/new?${new URLSearchParams({
    reason: "INFORMATION",
    users: deptPeople.map((m) => m.userId).join(","),
    subject: `${action.code} on ${fmtDate(action.scheduledDate)} — ${readiness === "NOT_READY" ? "overdue" : "at risk"}: ${short.map((s) => `${s.department} ${s.missing} of ${s.total} missing`).join(", ")}`,
    message: [
      `${action.name} is planned for ${fmtDate(action.scheduledDate)}.`,
      short.map((s) => `${deptLabel(s.department)} still owes ${s.missing} of ${s.total}: ${s.numbers.join(", ")}.`).join("\n"),
      "Departments concerned: " + depts.map(deptLabel).join(", ") + ".",
      "Send the documents, or say when they will arrive.",
    ].join("\n\n"),
  })}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${action.code} — ${action.name}`}
        subtitle={`${action.ownerName ?? "No owner"} · activity ${fmtDate(action.scheduledDate)} · ${readyCount} of ${action.entries.length} documents ready${action.scheduleActivities[0] ? ` · schedule ${action.scheduleActivities[0].scheduleVersion.versionLabel}` : ""}`}
        actions={<><Link href="/actions" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Schedule</Link><ReadinessChip readiness={readiness} /></>}
      />

      <Card
        title="Departments concerned"
        actions={control ? <Link href="/actions/requirements" className="text-xs font-semibold text-link hover:underline">Requirements →</Link> : undefined}
      >
        {depts.length ? (
          <>
            <div className="flex flex-wrap gap-1.5">{depts.map((d) => <Chip key={d} className="bg-tint text-brand-ink ring-link/30">{deptLabel(d)}</Chip>)}</div>
            {short.length ? (
              <div className="mt-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                <p className="text-xs font-semibold text-amber-900">
                  {readiness === "NOT_READY" ? "Overdue" : "At risk"} — {short.map((s) => `${deptLabel(s.department)} ${s.missing} of ${s.total} missing`).join(", ")}
                </p>
                <p className="mt-1 text-[11px] text-amber-900/80">
                  {action.riskNotifiedAt
                    ? `Everyone in ${depts.map(deptLabel).join(", ")} was warned automatically on ${fmtDate(action.riskNotifiedAt)}. Send the next reminder yourself, as a transmittal.`
                    : "The first warning goes out on its own the next time this page is refreshed. You can also send one now."}
                </p>
                {control ? (
                  <Link href={remindHref} className={`${btn("primary", "sm")} mt-2`}>
                    Notify by transmittal
                  </Link>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <Banner tone="warn" title="Needs departments">The project manager tags this activity in the departments list. Until then its documents cannot be asked for.</Banner>
        )}
      </Card>

      {/* Steps 3–5 — the approved requirements, by department */}
      <Card
        title={`Documents needed · ${action.entries.length}`}
        actions={control && depts.length ? <Link href="/actions/requirements" className="text-xs font-semibold text-link hover:underline">Requirements →</Link> : undefined}
      >
        {depts.length > 1 ? (
          <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
            <Link href={`/actions/${action.code}`} className={`rounded-full px-2.5 py-1 ${!dept ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>All</Link>
            {depts.map((d) => <Link key={d} href={`/actions/${action.code}?dept=${d}`} className={`rounded-full px-2.5 py-1 ${dept === d ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{deptLabel(d)} ({action.entries.filter((e) => e.department === d).length})</Link>)}
          </div>
        ) : null}
        {entries.length ? (
          <DataTable head={<tr><Th>Document</Th><Th>Department</Th><Th>From</Th><Th>Approved by</Th><Th>Needed at</Th><Th>Submit by</Th><Th>Has</Th><Th>Ready</Th></tr>}>
            {entries.map((e) => {
              const cur = e.document.revisions[0];
              const ready = cur?.statusCode === e.requiredStatus;
              const late = !ready && e.requiredBy < new Date();
              return (
                <tr key={e.id}>
                  <Td><Link href={`/documents/${e.documentId}`} className="font-mono text-[13px] font-semibold text-brand-ink hover:underline">{e.document.docNumber}</Link><span className="block max-w-64 truncate text-xs text-slate-400">{e.document.title}</span></Td>
                  <Td className="text-xs">{deptLabel(e.department)}</Td>
                  <Td className="text-xs">{partyLabel(e.submittedBy ?? e.document.originator)}</Td>
                  <Td className="text-xs">{fnLabel(e.approvedBy)}</Td>
                  <Td className="text-xs">{e.requiredStatus}</Td>
                  <Td className="whitespace-nowrap text-xs">
                    <span className={late ? "font-semibold text-red-700" : ""}>{fmtDate(e.requiredBy)}</span>
                    <span className="block text-[10px] text-slate-400">{e.manualDate ? "fixed date" : `${e.leadBusinessDays ?? DEFAULT_LEAD_BUSINESS_DAYS} working days before`}</span>
                  </Td>
                  <Td className="text-xs">{cur ? `rev ${cur.value} · ${cur.statusCode}` : e.document.isPlaceholder ? "not started" : "not released"}</Td>
                  <Td>{ready ? <Chip className="bg-emerald-100 text-emerald-800 ring-emerald-300">yes</Chip> : <Chip className={late ? "bg-red-100 text-red-800 ring-red-300" : "bg-amber-100 text-amber-800 ring-amber-300"}>{late ? "late" : "no"}</Chip>}</Td>
                </tr>
              );
            })}
          </DataTable>
        ) : (
          <p className="text-xs text-slate-400">{depts.length ? "No documents listed yet. Each department answers Document Control\u2019s call; the answers become the approved requirements list." : "Tag the departments first."}</p>
        )}
      </Card>

      {/* Before the activity — each department confirms */}
      {depts.length ? (
        <Card
          id="confirm"
          title={clear.cleared ? "Cleared to proceed" : "Confirm before the activity"}
          description={clear.cleared ? "Every department has confirmed its documents are available." : `Each department confirms its documents are available${confirmOpens ? ` — from ${fmtDate(confirmOpens)}` : ""}.`}
        >
          <ul className="divide-y divide-slate-100">
            {depts.map((d) => {
              const c = action.confirmations.find((x) => x.department === d);
              const mine = me?.department === d || control;
              // Requirements listed before departments existed count against every department.
              const deptEntries = action.entries.filter((e) => e.department === d || !e.department);
              const missing = deptEntries.filter((e) => e.document.revisions[0]?.statusCode !== e.requiredStatus);
              return (
                <li key={d} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{deptLabel(d)} <span className="text-xs font-normal text-slate-400">· {deptEntries.length - missing.length} of {deptEntries.length} ready</span></p>
                    {c ? (
                      <p className={`text-xs ${c.available ? "text-emerald-700" : "text-red-700"}`}>
                        {c.available ? "Available" : "Not available"} — {c.confirmedByName}, {fmtDate(c.confirmedAt)}{c.note ? ` · ${c.note}` : ""}
                      </p>
                    ) : <p className="text-xs text-slate-400">Not confirmed</p>}
                  </div>
                  {mine && (!confirmOpens || confirmOpens.getTime() <= Date.now()) ? (
                    <details className="text-xs" open={!c && me?.department === d}>
                      <summary className="cursor-pointer text-xs font-semibold text-link">{c ? "Confirm again" : "Confirm"}</summary>
                      <div className="mt-2 w-72">
                        <ActionForm action={confirmReadinessAction} submitLabel="Record" size="sm" hidden={{ actionId: action.id, department: d }}>
                          <label className="flex items-center gap-2"><input type="radio" name="available" value="yes" defaultChecked={!missing.length} /> Documents available</label>
                          <label className="flex items-center gap-2"><input type="radio" name="available" value="no" defaultChecked={!!missing.length} /> Not available</label>
                          <input name="note" className={inputCls} placeholder={missing.length ? `${missing.length} not ready — say what and why` : "Note (optional)"} />
                        </ActionForm>
                      </div>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function ReadinessChip({ readiness }: { readiness: "READY" | "AT_RISK" | "NOT_READY" | "UNKNOWN" }) {
  const map = {
    READY: ["Ready", "bg-emerald-100 text-emerald-800 ring-emerald-200"],
    AT_RISK: ["At risk", "bg-amber-100 text-amber-800 ring-amber-200"],
    NOT_READY: ["Not ready", "bg-red-100 text-red-800 ring-red-200"],
    UNKNOWN: ["No documents listed", "bg-slate-100 text-slate-700 ring-slate-200"],
  } as const;
  return <Chip className={map[readiness][1]}>{map[readiness][0]}</Chip>;
}
