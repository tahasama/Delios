import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader, DataTable, Th, Td, Chip, EmptyState } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review cycles" };

// §16.4 Q6 — which review cycles are open, and with whom.
export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { db } = await requireScope();
  const sp = await searchParams;
  const status = sp.status ?? "OPEN";
  const [cycles, blockingCount] = await Promise.all([
    db.reviewCycle.findMany({
      where: status === "ALL" ? {} : { status },
      orderBy: { submittedAt: "desc" },
      take: 100,
      include: {
        revision: { include: { document: { select: { docNumber: true, title: true } } } },
        assignments: true,
        comments: { where: { progressionPreventing: true, status: "OPEN" }, select: { id: true } },
      },
    }),
    db.reviewCycle.count({ where: { status: "OPEN", comments: { some: { progressionPreventing: true, status: "OPEN" } } } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reviews"
      />


      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-surface px-4 py-3 shadow-sm">
        <p className="text-xs text-slate-500">{cycles.length} {status === "ALL" ? "" : status.toLowerCase() + " "}review{cycles.length === 1 ? "" : "s"}{blockingCount && status !== "CLOSED" ? ` · ${blockingCount} with blocking comments` : ""}</p>
        <nav className="flex gap-1 rounded-xl bg-slate-100 p-1" aria-label="Review status">
          {["OPEN", "CLOSED", "ALL"].map((s) => <Link key={s} href={`/reviews?status=${s}`} aria-current={status === s ? "page" : undefined} className={`rounded-lg px-3 py-2 text-xs font-semibold ${status === s ? "bg-surface text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}</Link>)}
        </nav>
      </div>

      {cycles.length === 0 ? (
        <EmptyState title={status === "OPEN" ? "No open review cycles" : "No cycles"} body="Cycles open when a revision is submitted for review or approval." />
      ) : (
        <DataTable
          head={
            <tr>
              <Th>Document</Th>
              <Th>Cycle</Th>
              <Th>Mode</Th>
              <Th>Submitted</Th>
              <Th>With</Th>
              <Th>Custody point</Th>
              <Th>Blocking</Th>
              <Th></Th>
            </tr>
          }
        >
          {cycles.map((c) => {
            const point = !c.issuedToReviewAt ? "Received by control function" : !c.returnedFromReviewAt ? "With reviewer" : !c.returnedToOriginatorAt ? "With control function" : "Complete";
            return (
              <tr key={c.id}>
                <Td>
                  <Link href={`/reviews/${c.id}`} className="font-mono text-[13px] font-semibold text-brand-ink hover:underline">
                    {c.revision.document.docNumber}
                  </Link>
                  <span className="ml-1.5 font-mono text-xs text-slate-500">rev {c.revision.value}</span>
                  <span className="block max-w-64 truncate text-xs text-slate-400">{c.revision.document.title}</span>
                </Td>
                <Td>#{c.sequence}</Td>
                <Td className="text-xs">{c.mode.toLowerCase()}</Td>
                <Td className="whitespace-nowrap text-xs text-slate-500">{fmtDateTime(c.submittedAt)}</Td>
                <Td className="text-xs">{c.assignments.map((a) => a.userName).join(", ") || <span className="text-slate-400">unassigned</span>}</Td>
                <Td><Chip className={c.status === "OPEN" ? "bg-amber-100 text-amber-800 ring-amber-300" : "bg-slate-100 text-slate-600 ring-slate-300"}>{point}</Chip></Td>
                <Td>{c.comments.length ? <Chip className="bg-red-100 text-red-800 ring-red-300">{c.comments.length} open</Chip> : <span className="text-xs text-slate-300">—</span>}</Td>
                <Td className="text-right"><Link href={`/reviews/${c.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-link">Open <ArrowRight className="h-3.5 w-3.5"/></Link></Td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </div>
  );
}

