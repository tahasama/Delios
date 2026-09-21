import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, DataTable, Th, Td, Chip, EmptyState, inputCls, btn } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { getSet } from "@/lib/config";
import { buildReport, filterRows, REPORT_IDS, type ReportId, type Cell, type Segment, type Bar } from "@/lib/reports";

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
  searchParams: Promise<{ r?: string; rq?: string; q1?: string; q5?: string; asOf?: string }>;
}) {
  const ctx = await requireScope();
  const { db } = ctx;
  const sp = await searchParams;
  const current: ReportId = REPORT_IDS.includes(sp.r as ReportId) ? (sp.r as ReportId) : "register";
  const q = (sp.rq ?? "").trim();
  const [report, statuses, assets, assetCounts] = await Promise.all([
    buildReport(ctx, current),
    getSet("STATUSES"),
    db.assetItem.findMany({ orderBy: { code: "asc" } }),
    db.relationship.groupBy({ by: ["toId"], _count: true, where: { kind: "DOC_ASSET" } }),
  ]);
  const rows = filterRows(report.rows, q);

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
        subtitle="Each report answers one question: a chart to see it at a glance, then the documents behind it. Counted when you open it; downloads as CSV."
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
        description={`${report.question} ${report.audience}`}
        actions={<a href={`/api/reports/${report.id}${q ? `?rq=${encodeURIComponent(q)}` : ""}`} className={btn("secondary", "sm")}>Download CSV</a>}
      >
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {report.figures.map((f) => (
            <div key={f.label} className="rounded-xl border border-slate-200 px-3 py-2.5">
              <p className="text-[11px] font-semibold text-slate-500">{f.label}</p>
              <p className={`text-xl font-semibold tabular-nums ${TEXT[f.tone ?? ""] ?? "text-slate-900"}`}>{f.value}</p>
            </div>
          ))}
        </div>

        <BarChart title={report.chart.title} segments={report.chart.segments} bars={report.chart.bars} />

        <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-800">The detail · {rows.length}{q ? ` of ${report.rows.length}` : ""}</p>
          <form className="flex gap-2">
            <input type="hidden" name="r" value={current} />
            <input name="rq" defaultValue={q} placeholder="Filter: document, sender, reviewer…" className={`${inputCls} w-64 py-1.5 text-xs`} />
          </form>
        </div>
        {rows.length ? (
          <DataTable head={<tr>{report.columns.map((c) => <Th key={c}>{c}</Th>)}</tr>}>
            {rows.slice(0, 200).map((row, r) => (
              <tr key={r} className="hover:bg-slate-50/70">
                {row.map((cell, n) => <Td key={n} className="text-xs">{renderCell(cell)}</Td>)}
              </tr>
            ))}
          </DataTable>
        ) : <p className="text-xs text-slate-400">{q ? `Nothing matches “${q}”.` : report.empty}</p>}
        {rows.length > 200 ? <p className="mt-2 text-[11px] text-slate-400">First 200 shown; the CSV has all {rows.length}.</p> : null}
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

const TEXT: Record<string, string> = { good: "text-emerald-700", warn: "text-amber-700", bad: "text-red-700" };
const FILL: Record<Segment["tone"], string> = { good: "bg-emerald-500", info: "bg-sky-500", warn: "bg-amber-400", bad: "bg-red-500", muted: "bg-slate-300" };
const CHIP: Record<string, string> = { good: "bg-emerald-100 text-emerald-800", warn: "bg-amber-100 text-amber-800", bad: "bg-red-100 text-red-800" };

function renderCell(cell: Cell) {
  if (typeof cell !== "object") return cell;
  if (cell.href) return <Link href={cell.href} className="font-mono font-semibold text-[#1e3a5f] hover:underline">{cell.text}</Link>;
  if (cell.tone) return <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${CHIP[cell.tone]}`}>{cell.text}</span>;
  return cell.text;
}

/** Horizontal bars, one per row, stacked by state; the numbers are printed on the bar. */
function BarChart({ title, segments, bars }: { title: string; segments: Segment[]; bars: Bar[] }) {
  const total = (b: Bar) => segments.reduce((n, s) => n + (b.values[s.key] ?? 0), 0);
  const max = Math.max(1, ...bars.map(total));
  if (!bars.length) return null;
  return (
    <figure>
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-sm font-semibold text-slate-800">{title}</span>
        {segments.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500"><span className={`h-2.5 w-2.5 rounded-sm ${FILL[s.tone]}`} />{s.label}</span>
        ))}
      </figcaption>
      <ul className="space-y-1.5">
        {bars.map((b) => (
          <li key={b.label} className="flex items-center gap-2 text-xs">
            <span className="w-28 shrink-0 truncate text-right text-slate-600" title={b.label}>{b.label}</span>
            <span className="flex h-5 flex-1 overflow-hidden rounded bg-slate-50">
              <span className="flex h-full" style={{ width: `${(total(b) / max) * 100}%` }}>
                {segments.map((s) => {
                  const v = b.values[s.key] ?? 0;
                  return v ? (
                    <span key={s.key} title={`${s.label}: ${v}`} className={`flex h-full items-center justify-center text-[10px] font-semibold text-white ${FILL[s.tone]}`} style={{ width: `${(v / total(b)) * 100}%` }}>{v}</span>
                  ) : null;
                })}
              </span>
            </span>
            <span className="w-8 shrink-0 tabular-nums text-slate-500">{total(b)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
