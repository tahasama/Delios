import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, DataTable, Th, Td, Chip, EmptyState, inputCls, btn } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { getSet } from "@/lib/config";
import { buildReport, REPORT_IDS, type ReportId } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

const REPORT_TITLES: Record<ReportId, string> = {
  register: "Register status",
  deliveries: "Deliveries",
  reviews: "Reviews",
  transmittals: "Transmittals",
  readiness: "Readiness",
};

// Reports a project team reads, plus the look-ups the register must answer directly (§16.4).
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; q1?: string; q5?: string; asOf?: string }>;
}) {
  const ctx = await requireScope();
  const { db } = ctx;
  const sp = await searchParams;
  const current: ReportId = REPORT_IDS.includes(sp.r as ReportId) ? (sp.r as ReportId) : "register";
  const [report, statuses, assets, assetCounts] = await Promise.all([
    buildReport(ctx, current),
    getSet("STATUSES"),
    db.assetItem.findMany({ orderBy: { code: "asc" } }),
    db.relationship.groupBy({ by: ["toId"], _count: true, where: { kind: "DOC_ASSET" } }),
  ]);

  // Q1 — current revision & status
  const q1 = sp.q1?.trim();
  const q1Doc = q1 ? await db.document.findFirst({
    where: { OR: [{ docNumber: { contains: q1 } }, { title: { contains: q1 } }] },
    include: { revisions: { orderBy: { createdAt: "desc" }, include: { files: true } } },
  }) : null;

  // Q5 — who was issued this revision, and when
  const q5 = sp.q5?.trim();
  const q5Doc = q5 ? await db.document.findFirst({
    where: { docNumber: { contains: q5 } },
    include: { revisions: { orderBy: { createdAt: "desc" }, include: { transmittalItems: { include: { transmittal: { include: { recipients: true } } } } } } },
  }) : null;

  // Q8 — what was the current revision on a given date
  const asOf = sp.asOf ? new Date(sp.asOf) : null;
  const historical = asOf
    ? (await db.revision.findMany({
        where: { releasedAt: { lte: asOf } },
        include: { document: { select: { docNumber: true, title: true, state: true } } },
        orderBy: { releasedAt: "desc" },
      }))
        .filter((r) => !r.supersededAt || r.supersededAt > asOf!)
        .filter((r) => !r.voidedAt || r.voidedAt > asOf!) // voided later was still current on that date
        .filter((r) => {
          // withdrawn/cancelled/archived AFTER the date still existed then
          const endStates: Record<string, Date | null> = {};
          return true;
        })
    : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        subtitle="Counted from the register when you open them. Each one downloads as CSV."
        actions={
          <a href="/api/register/export" className={btn("secondary", "sm")} title="The whole register as CSV">
            Export register
          </a>
        }
      />

      <nav className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 sm:w-fit" aria-label="Reports">
        {REPORT_IDS.map((id) => (
          <Link key={id} href={`/reports?r=${id}`} aria-current={current === id ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-xs font-semibold ${current === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
            {REPORT_TITLES[id]}
          </Link>
        ))}
      </nav>

      <Card
        title={report.title}
        description={report.question}
        actions={<a href={`/api/reports/${report.id}`} className={btn("secondary", "sm")}>Download CSV</a>}
      >
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {report.figures.map((f) => (
            <div key={f.label} className="rounded-xl border border-slate-200 px-3 py-2.5">
              <p className="text-[11px] font-semibold text-slate-500">{f.label}</p>
              <p className={`text-xl font-semibold tabular-nums ${f.tone === "bad" ? "text-red-700" : f.tone === "warn" ? "text-amber-700" : f.tone === "good" ? "text-emerald-700" : "text-slate-900"}`}>{f.value}</p>
            </div>
          ))}
        </div>
        {report.rows.length ? (
          <DataTable head={<tr>{report.columns.map((c, n) => <Th key={c} className={n ? "text-right" : undefined}>{c}</Th>)}</tr>}>
            {report.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, n) => <Td key={n} className={n ? "text-right text-xs tabular-nums" : "text-xs font-medium text-slate-800"}>{cell}</Td>)}
              </tr>
            ))}
          </DataTable>
        ) : <p className="text-xs text-slate-400">{report.empty}</p>}
      </Card>

      <h2 className="pt-2 text-sm font-semibold text-slate-700">Look up</h2>

      {/* Q1 */}
      <Card id="q1" title="Current revision of a document">
        <form className="mb-3 flex gap-2">
          <input name="q1" defaultValue={q1 ?? ""} placeholder="Document number or title…" className={`${inputCls} max-w-sm`} />
          <button className={btn("secondary", "sm")}>Look up</button>
        </form>
        {q1 && !q1Doc ? <p className="text-sm text-slate-400">No document matches “{q1}”.</p> : null}
        {q1Doc ? (
          <div className="space-y-2">
            {q1Doc.revisions.filter((r) => ["RELEASED", "SUPERSEDED", "VOID"].includes(r.state)).slice(0, 3).map((r) => (
              <p key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono font-semibold">{q1Doc.docNumber}</span>
                <span className="font-mono text-xs">rev {r.value}</span>
                <Chip className={r.state === "RELEASED" ? "bg-emerald-100 text-emerald-800 ring-emerald-300" : r.state === "SUPERSEDED" ? "bg-violet-100 text-violet-800 ring-violet-300" : "bg-red-100 text-red-800 ring-red-300"}>{r.state.toLowerCase()}</Chip>
                {r.statusCode ? <Chip>{statuses.find((s) => s.code === r.statusCode)?.label ?? r.statusCode}</Chip> : null}
                <span className="text-xs text-slate-400">released {fmtDate(r.releasedAt)}</span>
              </p>
            ))}
            {q1Doc.revisions.every((r) => r.state !== "RELEASED") ? (
              <p className="text-sm text-amber-700">No current revision — the document shall not be used.</p>
            ) : null}
          </div>
        ) : null}
      </Card>

      {/* Q2 */}
      <Card id="q2" title="Documents by equipment, system or area">
        {assets.length ? (
          <div className="flex flex-wrap gap-2">
            {assets.map((a) => {
              const n = assetCounts.find((c) => c.toId === a.id)?._count ?? 0;
              return (
                <Link key={a.id} href={`/assets/${a.id}`} className="rounded-lg border border-slate-200 px-3 py-2 text-sm transition hover:border-[#2d5480]/40 hover:shadow-sm">
                  <span className="font-mono font-semibold text-[#1e3a5f]">{a.code}</span>
                  <span className="ml-2 text-slate-500">{a.name}</span>
                  <Chip className="ml-2">{n} doc{n === 1 ? "" : "s"}</Chip>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-400">No assets in the breakdown.</p>
        )}
      </Card>

      {/* Q5 */}
      <Card id="q5" title="Who received a document, and when">
        <form className="mb-3 flex gap-2">
          <input name="q5" defaultValue={q5 ?? ""} placeholder="Document number…" className={`${inputCls} max-w-sm`} />
          <button className={btn("secondary", "sm")}>Trace issues</button>
        </form>
        {q5 && q5Doc ? (
          <DataTable head={<tr><Th>Revision</Th><Th>Transmittal</Th><Th>Date</Th><Th>Reason</Th><Th>Recipients</Th></tr>}>
            {q5Doc.revisions.flatMap((r) =>
              r.transmittalItems.map((item) => (
                <tr key={item.id}>
                  <Td className="font-mono text-xs">rev {r.value}</Td>
                  <Td><Link href={`/transmittals/${item.transmittalId}`} className="font-mono text-[13px] text-[#1e3a5f] hover:underline">{item.transmittal.number}</Link></Td>
                  <Td className="whitespace-nowrap text-xs">{fmtDate(item.transmittal.dateOfIssue)}</Td>
                  <Td className="text-xs">{item.transmittal.reasonForIssue}</Td>
                  <Td className="text-xs">{item.transmittal.recipients.map((rec) => rec.name).filter((n) => n && n !== "—").join(", ") || "—"}</Td>
                </tr>
              ))
            )}
          </DataTable>
        ) : q5 ? (
          <p className="text-sm text-slate-400">No document matches.</p>
        ) : null}
      </Card>

      {/* Q8 */}
      <Card id="q8" title="The register as it stood on a date">
        <form className="mb-3 flex gap-2">
          <input type="date" name="asOf" defaultValue={sp.asOf ?? ""} className={`${inputCls} max-w-48`} />
          <button className={btn("secondary", "sm")}>Reconstruct</button>
        </form>
        {asOf ? (
          historical.length ? (
            <DataTable head={<tr><Th>Document</Th><Th>Current revision on {fmtDate(asOf)}</Th><Th>Status</Th><Th>Released</Th></tr>}>
              {historical.slice(0, 50).map((r) => (
                <tr key={r.id}>
                  <Td className="font-mono text-[13px]">{r.document.docNumber}</Td>
                  <Td className="font-mono text-xs font-semibold">rev {r.value}</Td>
                  <Td className="text-xs">{r.statusCode ?? "—"}</Td>
                  <Td className="whitespace-nowrap text-xs">{fmtDate(r.releasedAt)}</Td>
                </tr>
              ))}
            </DataTable>
          ) : (
            <EmptyState title="Nothing was current on that date" body="No revision had been released by then." />
          )
        ) : (
          <p className="text-xs text-slate-400">Pick a date to reconstruct the register as it stood.</p>
        )}
      </Card>

    </div>
  );
}
