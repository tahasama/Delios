import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireScope } from "@/lib/scope";
import { PageHeader, DataTable, Th, Td, Chip, EmptyState, ButtonLink } from "@/components/ui";
import { REASON_LABEL, type ReasonForIssue } from "@/lib/standard";
import { fmtDate, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Transmittals" };

/** One list; the counts live on the filters instead of in a separate strip of tiles. */
const VIEWS: { id: string; label: string; where: Prisma.TransmittalWhereInput }[] = [
  { id: "all", label: "All", where: {} },
  { id: "check", label: "To check", where: { direction: "INCOMING", status: "ISSUED" } },
  { id: "drafts", label: "Drafts", where: { status: "DRAFT" } },
  { id: "out", label: "Sent", where: { direction: "OUTGOING" } },
  { id: "in", label: "Received", where: { direction: "INCOMING" } },
];

export default async function TransmittalsPage({ searchParams }: { searchParams: Promise<{ view?: string; direction?: string }> }) {
  const { db } = await requireScope();
  const sp = await searchParams;
  // Older links say ?direction=INCOMING.
  const viewId = sp.view ?? (sp.direction === "INCOMING" ? "in" : sp.direction === "OUTGOING" ? "out" : "all");
  const view = VIEWS.find((v) => v.id === viewId) ?? VIEWS[0];

  const [list, counts] = await Promise.all([
    db.transmittal.findMany({ where: view.where, orderBy: { createdAt: "desc" }, take: 100, include: { items: true, recipients: true } }),
    Promise.all(VIEWS.map((v) => db.transmittal.count({ where: v.where }))),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Transmittals"
        actions={<><a href="/api/export/transmittals" className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50">Export</a><ButtonLink href="/transmittals/new">New transmittal</ButtonLink></>}
      />

      <nav className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 sm:w-fit" aria-label="Filter">
        {VIEWS.map((v, i) => (
          <Link key={v.id} href={`/transmittals?view=${v.id}`} aria-current={view.id === v.id ? "page" : undefined}
            className={cn("rounded-lg px-3 py-2 text-xs font-semibold", view.id === v.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
            {v.label}
            {counts[i] ? <span className={cn("ml-1.5 rounded px-1.5 text-[10px]", v.id === "check" ? "bg-amber-200 text-amber-900" : "bg-slate-200 text-slate-600")}>{counts[i]}</span> : null}
          </Link>
        ))}
      </nav>

      {list.length === 0 ? (
        <EmptyState title={view.id === "all" ? "No transmittals yet" : "Nothing here"} body="A transmittal is how documents are formally sent to, or received from, another party." action={view.id === "all" ? <ButtonLink href="/transmittals/new" variant="secondary">New transmittal</ButtonLink> : undefined} />
      ) : (
        <DataTable head={<tr><Th>Number</Th><Th>To / from</Th><Th>Why</Th><Th>Date</Th><Th>Documents</Th><Th>Status</Th><Th>Reply due</Th></tr>}>
          {list.map((t) => {
            const party = t.direction === "OUTGOING"
              ? [...new Set(t.recipients.map((r) => r.organization ?? r.name))].join(", ") || "—"
              : t.issuingParty;
            return (
              <tr key={t.id} className="hover:bg-slate-50/70">
                <Td><Link href={`/transmittals/${t.id}`} className="font-mono text-[13px] font-semibold text-[#1e3a5f] hover:underline">{t.number}</Link></Td>
                <Td className="text-xs"><span className="text-slate-400">{t.direction === "OUTGOING" ? "to" : "from"}</span> {party}</Td>
                <Td className="text-xs">{REASON_LABEL[t.reasonForIssue as ReasonForIssue] ?? t.reasonForIssue}</Td>
                <Td className="whitespace-nowrap text-xs">{fmtDate(t.dateOfIssue)}</Td>
                <Td className="tabular-nums text-xs">{t.items.length}</Td>
                <Td>
                  <Chip className={
                    t.status === "ACCEPTED" ? "bg-emerald-100 text-emerald-800 ring-emerald-300"
                    : t.status === "REJECTED" ? "bg-red-100 text-red-800 ring-red-300"
                    : t.status === "ISSUED" ? "bg-amber-100 text-amber-800 ring-amber-300"
                    : "bg-slate-100 text-slate-600 ring-slate-300"
                  }>{t.direction === "INCOMING" && t.status === "ISSUED" ? "to check" : t.status.toLowerCase()}</Chip>
                </Td>
                <Td className="whitespace-nowrap text-xs">{t.responseDueDate ? fmtDate(t.responseDueDate) : "—"}</Td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </div>
  );
}
