import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { isAdmin, isController } from "@/lib/auth";
import { PageHeader, DataTable, Th, Td, Chip } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit trail" };

const ACTION_COLORS: Record<string, string> = {
  RELEASE: "bg-emerald-100 text-emerald-800 ring-emerald-300",
  APPROVAL: "bg-emerald-100 text-emerald-800 ring-emerald-300",
  STATE_TRANSITION: "bg-amber-100 text-amber-800 ring-amber-300",
  METADATA_CHANGE: "bg-sky-100 text-sky-800 ring-sky-300",
  DOWNLOAD: "bg-slate-100 text-slate-600 ring-slate-300",
  ISSUE: "bg-violet-100 text-violet-800 ring-violet-300",
  CHECK_RUN: "bg-orange-100 text-orange-800 ring-orange-300",
  LOGIN: "bg-slate-100 text-slate-500 ring-slate-300",
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; action?: string }> }) {
  const { user, db } = await requireScope();
  if (!isAdmin(user) && !isController(user)) {
    return <PageHeader title="Audit trail" subtitle="The control function and administrators only." />;
  }
  const sp = await searchParams;
  const events = await db.auditEvent.findMany({
    where: {
      AND: [
        sp.q ? { OR: [{ entityLabel: { contains: sp.q } }, { actorName: { contains: sp.q } }, { detail: { contains: sp.q } }] } : {},
        sp.action ? { action: sp.action } : {},
      ],
    },
    orderBy: { ts: "desc" },
    take: 200,
  });
  const actions = await db.auditEvent.groupBy({ by: ["action"], _count: true });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit trail"
        subtitle="Trace state changes, metadata edits and controlled actions with the responsible person, time and previous value."
      />

      <div className="flex flex-wrap gap-1.5">
        <Link href="/admin/audit" className={`rounded-full px-3 py-1.5 text-xs font-medium ${!sp.action ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>All</Link>
        {actions.sort((a, b) => b._count - a._count).map((a) => (
          <Link key={a.action} href={`/admin/audit?action=${a.action}`} className={`rounded-full px-3 py-1.5 text-xs font-medium ${sp.action === a.action ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>
            {a.action.replaceAll("_", " ").toLowerCase()} ({a._count})
          </Link>
        ))}
      </div>

      <form className="flex gap-2">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search label, actor, detail…" className="max-w-sm flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">Search</button>
      </form>

      <DataTable head={<tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Entity</Th><Th>Change / detail</Th></tr>}>
        {events.map((e) => (
          <tr key={e.id}>
            <Td className="whitespace-nowrap text-xs text-slate-400">{fmtDateTime(e.ts)}</Td>
            <Td className="text-xs font-medium">{e.actorName}</Td>
            <Td><Chip className={ACTION_COLORS[e.action] ?? ""}>{e.action.replaceAll("_", " ").toLowerCase()}</Chip></Td>
            <Td className="font-mono text-xs">{e.entityLabel ?? e.entityType ?? "—"}</Td>
            <Td className="text-xs text-slate-500">
              {e.field ? <span>{e.field}: <span className="text-red-500">{e.oldValue ?? "—"}</span> → <span className="text-emerald-700">{e.newValue ?? "—"}</span></span> : e.detail ?? e.newValue ?? "—"}
            </Td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
