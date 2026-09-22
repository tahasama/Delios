import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { isController, isAdmin } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { RunChecksButton } from "./run-button";
import { AssuranceTabs } from "./tabs";
import { problemDocuments } from "@/lib/problems";
import { untoldRecipients } from "@/lib/supersession";
import { ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assurance" };

const OWNERS: Record<string, string> = { CF: "Document Control", OR: "Originators", RV: "Reviewers", OG: "The organization" };
const SEVERITY: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800",
  MAJOR: "bg-amber-100 text-amber-800",
  MINOR: "bg-slate-100 text-slate-600",
  ADVISORY: "bg-slate-100 text-slate-500",
};

/**
 * Can the register be trusted? One sentence, then what needs doing and by
 * whom. The Standard's vocabulary stays on the tabs behind it.
 */
export default async function AssurancePage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const ownerFilter = (await searchParams).owner;
  const owner = ownerFilter && OWNERS[ownerFilter] ? ownerFilter : undefined;
  const ctx = await requireScope();
  const { user, db } = ctx;
  const controller = isController(user) || isAdmin(user);

  const [runs, scope, byOwner, risks, work] = await Promise.all([
    db.checkRun.findMany({ orderBy: { ranAt: "desc" }, take: 1 }),
    db.scopeConfig.findFirst(),
    db.defect.groupBy({ by: ["ownerRole", "severity", "status"], _count: true }),
    Promise.all([
      untoldRecipients(ctx).then((u) => u.length),
      db.revision.count({ where: { state: "RELEASED", cycles: { some: { comments: { some: { progressionPreventing: true, status: "OPEN" } } } } } }),
      db.baselineEntry.count({ where: { document: { state: "WITHDRAWN" } } }),
      db.revision.count({ where: { state: "VOID", voidReassessment: null } }),
    ]).then((n) => n.reduce((a, b) => a + b, 0)),
    problemDocuments(ctx, owner),
  ]);
  const last = runs[0] ?? null;
  const threshold = scope?.integrityThreshold ?? 95;
  const count = (f: (d: (typeof byOwner)[number]) => boolean) => byOwner.filter(f).reduce((n, d) => n + d._count, 0);
  const serious = count((d) => d.status === "OPEN" && (d.severity === "CRITICAL" || d.severity === "MAJOR"));
  const critical = count((d) => d.status === "OPEN" && d.severity === "CRITICAL");
  const below = last ? last.integrity < threshold || last.openCritical > 0 : false;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assurance"
        subtitle="The checks look for mistakes in the register — a document released without approval, a missing date, a drawing not linked to its equipment. Here is what they found and who should fix it."
        actions={controller ? <RunChecksButton /> : undefined}
      />
      <AssuranceTabs current="/conformance" />

      {/* The verdict */}
      <section className={`rounded-2xl p-5 ${!last ? "bg-slate-100 text-slate-700" : below ? "bg-amber-50 text-amber-950 ring-1 ring-amber-200" : "bg-emerald-50 text-emerald-950 ring-1 ring-emerald-200"}`}>
        {last ? (
          <>
            <p className="text-3xl font-semibold tabular-nums">{last.integrity.toFixed(0)}%</p>
            <p className="mt-1 text-sm font-medium">of documents have no serious problem{critical ? `, and ${critical} critical problem${critical === 1 ? " is" : "s are"} open` : ""}.</p>
            <p className="mt-2 text-xs opacity-80">
              {below
                ? `The target is ${threshold}%. Until it is reached, quote this figure next to any progress or readiness number you report from the register — it tells the reader how far to trust it.`
                : `At or above the ${threshold}% target.`}{" "}
              Last checked {fmtDateTime(last.ranAt)}{last.ranByName ? ` by ${last.ranByName}` : ""}; fixed problems disappear at the next check.
            </p>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold">Not checked yet</p>
            <p className="mt-1 text-sm">{controller ? "Run the checks to measure how trustworthy the register is." : "Document Control runs the checks."}</p>
          </>
        )}
      </section>

      {/* What to look at */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Tile href="#documents" label="Serious problems to fix" value={serious} tone={serious ? "bad" : "good"} hint="critical or major, on the documents listed below" />
        <Tile href="/exposures" label="Out-of-date risks" value={risks} tone={risks ? "warn" : "good"} hint="replaced or withdrawn information that may still be in use" />
      </div>

      <Card
        id="documents"
        title={`Documents with problems · ${work.documents.length}`}
        description="Each line is something wrong on that document, and where to put it right. Fixed problems disappear at the next check run."
      >
        <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
          <Link href="/conformance#documents" className={`rounded-full px-2.5 py-1 ${!owner ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>Everyone</Link>
          {Object.entries(OWNERS).map(([code, label]) => {
            const n = count((d) => d.ownerRole === code && d.status === "OPEN");
            return n ? (
              <Link key={code} href={`/conformance?owner=${code}#documents`} className={`rounded-full px-2.5 py-1 ${owner === code ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{label} · {n}</Link>
            ) : null;
          })}
        </div>
        {work.documents.length ? (
          <ul className="divide-y divide-slate-100">
            {work.documents.slice(0, 60).map((d) => (
              <li key={d.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/documents/${d.id}`} className="font-mono text-[13px] font-semibold text-brand-ink hover:underline">{d.docNumber}</Link>
                  <span className="min-w-0 truncate text-xs text-slate-500">{d.title}</span>
                </div>
                <ul className="mt-1.5 space-y-1">
                  {d.problems.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-start gap-2 text-xs">
                      <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${SEVERITY[p.severity] ?? SEVERITY.MINOR}`}>{p.severity.toLowerCase()}</span>
                      <span className="min-w-0 flex-1 text-slate-700">{p.text}<span className="text-slate-400"> · {p.owner}</span></span>
                      <Link href={p.fix.href} className="shrink-0 font-semibold text-link hover:underline">{p.fix.label} →</Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-emerald-700">No document has an open problem{owner ? ` for ${OWNERS[owner]}` : ""}.</p>}
        {work.documents.length > 60 ? <p className="mt-2 text-[11px] text-slate-400">First 60 shown, worst first. Filter by who fixes them to narrow the list.</p> : null}

        {work.general.length ? (
          <div className="mt-4 rounded-xl bg-slate-50 p-3">
            <p className="mb-1.5 text-xs font-semibold text-slate-700">Not tied to one document · {work.general.length}</p>
            <ul className="space-y-1">
              {work.general.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start gap-2 text-xs">
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${SEVERITY[p.severity] ?? SEVERITY.MINOR}`}>{p.severity.toLowerCase()}</span>
                  <span className="min-w-0 flex-1 text-slate-700">{p.text}<span className="text-slate-400"> · {p.owner}</span></span>
                  <Link href={p.fix.href} className="shrink-0 font-semibold text-link hover:underline">{p.fix.label} →</Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="mt-3 text-[11px] text-slate-400">Measured against Document Management Standard v{scope?.standardVersion ?? "1.0"}. Problem-free share counts documents with no critical or major problem.</p>
      </Card>
    </div>
  );
}

function Tile({ href, label, value, hint, tone }: { href: string; label: string; value: string | number; hint: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <Link href={href} className="group rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm transition hover:border-brand-line/40 hover:shadow">
      <p className="flex items-center justify-between text-xs font-semibold text-slate-500">{label}<ArrowRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-link" /></p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : tone === "good" ? "text-emerald-700" : "text-slate-900"}`}>{value}</p>
      <p className="text-[11px] text-slate-400">{hint}</p>
    </Link>
  );
}
