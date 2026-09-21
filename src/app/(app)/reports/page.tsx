import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, DataTable, Th, Td, Chip, EmptyState, inputCls, btn } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { getSet } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Register reports" };

// §16.4 — the eight questions the register shall answer without manual reconstruction.
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ q1?: string; q5?: string; asOf?: string }>;
}) {
  const { db } = await requireScope();
  const sp = await searchParams;

  const [statuses, assets, assetCounts, openCycles, notReady, pkgShort] = await Promise.all([
    getSet("STATUSES"),
    db.assetItem.findMany({ orderBy: { code: "asc" } }),
    db.relationship.groupBy({ by: ["toId"], _count: true, where: { kind: "DOC_ASSET" } }),
    db.reviewCycle.count({ where: { status: "OPEN" } }),
    db.baselineEntry.findMany({
      where: {},
      include: { document: { include: { revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1 } } }, action: true },
      take: 100,
    }).then((rows) => rows.filter((r) => r.document.revisions[0]?.statusCode !== r.requiredStatus)),
    db.package.findMany({ where: { closedAt: null }, include: { members: true } }).then((rows) => rows.filter((p) => p.members.some((m) => !m.completionDate && m.requiredStatus))),
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

  // Q9 — planned against arrived. This was a page of its own; it is one more
  // register question, so it lives with the others.
  const planned = await db.document.findMany({
    where: { state: { in: ["PLANNED", "ACTIVE"] } },
    include: {
      revisions: { orderBy: { createdAt: "desc" }, include: { cycles: { orderBy: { sequence: "desc" }, take: 1 } } },
      baselineEntries: { include: { action: true } },
    },
  });
  const submissionRows = planned.map((d) => {
    const plannedDate =
      d.revisions.find((r) => r.plannedSubmissionDate)?.plannedSubmissionDate ??
      d.baselineEntries.sort((a, b) => +new Date(a.requiredBy) - +new Date(b.requiredBy))[0]?.requiredBy ??
      null;
    const lastCycle = d.revisions[0]?.cycles[0] ?? null;
    const arrived = !!lastCycle || d.revisions.some((r) => r.state !== "IN_PREPARATION") || d.state === "ACTIVE";
    const resubmission = d.revisions.some((r) =>
      r.cycles.some((c) => c.outcome && ["REVISE_AND_RESUBMIT", "C3", "C4", "REJECTED"].includes(c.outcome)),
    );
    const late =
      arrived && plannedDate && lastCycle?.submittedAt
        ? new Date(lastCycle.submittedAt) > new Date(plannedDate)
        : !arrived && plannedDate
          ? new Date() > new Date(plannedDate)
          : false;
    return { doc: d, plannedDate, arrived, late, resubmission };
  });
  const lateSubmissions = submissionRows.filter((r) => r.late);
  const notArrived = submissionRows.filter((r) => !r.arrived);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Register reports"
        subtitle="Standard questions about the register, answered from live data."
        actions={
          <a href="/api/register/export" className={btn("secondary", "sm")} title="CSV extract — carries a generation timestamp">
            Export register (CSV)
          </a>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniQA n="Q1" q="Current revision & status?" href="#q1" />
        <MiniQA n="Q2" q="Documents describing an asset?" href="#q2" count={assetCounts.length} />
        <MiniQA n="Q3" q="What does this action need — is it ready?" href="/actions" count={notReady.length} warn={(v) => v > 0} />
        <MiniQA n="Q4" q="Package members & completeness?" href="/packages" count={pkgShort.length} warn={(v) => v > 0} />
        <MiniQA n="Q5" q="Who was issued this revision, when?" href="#q5" />
        <MiniQA n="Q6" q="Open review cycles — with whom?" href="/reviews" count={openCycles} warn={(v) => v > 0} />
        <MiniQA n="Q7" q="What is affected by each exposure?" href="/exposures" />
        <MiniQA n="Q8" q="Current revision on a given date?" href="#q8" />
      </div>

      {/* Q1 */}
      <Card id="q1" title="What is the current revision of this document, and at what status?" description="Answers from the register directly — no manual reconstruction">
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
      <Card id="q2" title="Which documents describe this equipment, system or area?" description="Object association, many-to-many">
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
      <Card id="q5" title="Who was issued this revision, and when?" description="From the transmittal register">
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
      <Card id="q8" title="What was the current revision of each document on a given date?" description="Historical state reconstructed from the transition record">
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

      <Card
        id="q9"
        title="What was due, what has arrived, and what is late?"
        description={`${submissionRows.length} planned or active · ${notArrived.length} not arrived · ${lateSubmissions.length} late. Planned date is the revision's planned submission, or the earliest baseline required-by.`}
      >
        {submissionRows.length === 0 ? (
          <p className="text-xs text-slate-400">Nothing is planned yet.</p>
        ) : (
          <DataTable head={<tr><Th>Document</Th><Th>Title</Th><Th>Planned</Th><Th>Path</Th><Th>Resubmission</Th></tr>}>
            {submissionRows
              .slice()
              .sort((a, b) => Number(b.late) - Number(a.late) || Number(!a.arrived) - Number(!b.arrived))
              .map(({ doc, plannedDate, arrived, late, resubmission }) => (
                <tr key={doc.id} className="hover:bg-slate-50/70">
                  <Td>
                    <Link href={`/documents/${doc.id}`} className="font-mono text-[13px] font-semibold text-[#1e3a5f] hover:underline">
                      {doc.docNumber}
                    </Link>
                  </Td>
                  <Td className="max-w-64"><span className="line-clamp-1 text-xs">{doc.title}</span></Td>
                  <Td className="whitespace-nowrap text-xs">{plannedDate ? fmtDate(plannedDate) : <span className="text-slate-300">no date</span>}</Td>
                  <Td>
                    {!arrived ? (
                      <Chip className={late ? "bg-red-100 text-red-800 ring-red-300" : "bg-orange-100 text-orange-800 ring-orange-300"}>
                        {late ? "not arrived — late" : "not arrived"}
                      </Chip>
                    ) : late ? (
                      <Chip className="bg-red-100 text-red-800 ring-red-300">arrived late</Chip>
                    ) : (
                      <Chip className="bg-emerald-100 text-emerald-800 ring-emerald-300">arrived on time</Chip>
                    )}
                  </Td>
                  <Td>{resubmission ? <Chip className="bg-violet-100 text-violet-800 ring-violet-300">re-entered from rework</Chip> : "—"}</Td>
                </tr>
              ))}
          </DataTable>
        )}
      </Card>
    </div>
  );
}

function MiniQA({ n, q, href, count, warn }: { n: string; q: string; href: string; count?: number; warn?: (v: number) => boolean }) {
  return (
    <Link href={href} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:border-[#2d5480]/40 hover:shadow">
      <div className="flex items-center justify-between">
        <span className="rounded bg-[#1e3a5f] px-1.5 py-0.5 text-[10px] font-bold text-white">{n}</span>
        {count !== undefined ? (
          <Chip className={warn && warn(count) ? "bg-amber-100 text-amber-800 ring-amber-300" : "bg-emerald-100 text-emerald-800 ring-emerald-300"}>{count}</Chip>
        ) : null}
      </div>
      <p className="mt-2 text-xs leading-snug text-slate-600">{q}</p>
    </Link>
  );
}
