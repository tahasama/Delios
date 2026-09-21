import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader, ButtonLink } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { PrintButton } from "./print-button";
import { effectiveSpine } from "@/lib/spine";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conformance statement" };

// §1.6 — the conformance assessment statement: issuing organization, recipient,
// level, scope, version, date, integrity, counts by severity, open criticals,
// coverage, plus the exceptions register it must be read with.
export default async function StatementPage() {
  const ctx = await requireScope();
  const { db } = ctx;
  const [scope, lastRun, defects, exceptions, docs, spine, baseline] = await Promise.all([
    db.scopeConfig.findFirst(),
    db.checkRun.findFirst({ orderBy: { ranAt: "desc" } }),
    db.defect.findMany({ where: { status: { in: ["OPEN", "ACCEPTED"] } } }),
    db.exceptionEntry.findMany({ orderBy: { startDate: "desc" } }),
    db.document.count(),
    effectiveSpine(ctx),
    db.spineBaseline.findFirst({ orderBy: { releasedAt: "desc" } }),
  ]);

  const count = (sev: string, status: string) => defects.filter((d) => d.severity === sev && d.status === status).length;
  const coverage = lastRun?.coverage ?? 0;
  const qualified = coverage < 100;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between no-print">
        <PageHeader title="Conformance assessment statement" subtitle="A formal, printable summary of the organization’s declared scope and measured control evidence." />
        <div className="flex gap-2">
          <PrintButton />
          <ButtonLink href="/conformance" variant="secondary">← Conformance</ButtonLink>
        </div>
      </div>

      <article className="rounded-xl border border-slate-300 bg-white p-8 shadow-sm print:shadow-none">
        <header className="border-b border-slate-200 pb-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Conformance assessment statement</p>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">{scope?.organizationName ?? "—"}</h1>
          <p className="text-xs text-slate-500">Issued {fmtDate(new Date())} · recipient: <em>as addressed</em></p>
        </header>

        <dl className="mt-6 space-y-3 text-sm">
          <Row label="Scope assessed (§1.2)">{scope?.scopeStatement ?? "—"}</Row>
          <Row label="Level (§1.5)">{scope?.assessmentLevel ?? "—"}</Row>
          <Row label="Standard applied">{`Document Management Standard version ${scope?.standardVersion ?? "1.0"}`}</Row>
          <Row label="Effective from (§1.9)">{scope ? fmtDate(scope.effectiveDate) : "—"}</Row>
          <Row label="Assessment date">{lastRun ? fmtDateTime(lastRun.ranAt) : "no measurement"}</Row>
          <Row label="Documents in scope">{docs}</Row>
          <Row label="Integrity (§17.4)">
            <strong>{lastRun ? `${lastRun.integrity.toFixed(1)}%` : "not measured"}</strong>
            {qualified && lastRun ? <em className="ml-2 text-amber-700">qualified — check execution coverage {coverage.toFixed(0)}% is below 100%</em> : null}
          </Row>
          <Row label="Rules · Routes · Checks (Annex F)">
            {baseline ? `Synchronized baseline ${baseline.label}, released ${fmtDate(baseline.releasedAt)}` : "No synchronized baseline released"}
            {spine.releasable ? " · views reconcile" : <em className="ml-1 text-amber-700">· {spine.counts.GAP} Gap, {spine.counts.REVIEW_REQUIRED} Review required</em>}
          </Row>
          <Row label="Check execution coverage">{lastRun ? `${lastRun.executed} of ${lastRun.totalChecks} checks executed (${coverage.toFixed(0)}%)` : "—"}</Row>
        </dl>

        <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Non-conformances by severity (§17.2)</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
              <th className="py-1.5">Severity</th><th className="py-1.5">Open</th><th className="py-1.5">Accepted (counted, §17.6)</th>
            </tr>
          </thead>
          <tbody>
            {["CRITICAL", "MAJOR", "MINOR", "ADVISORY"].map((sev) => (
              <tr key={sev} className="border-b border-slate-100">
                <td className="py-1.5 font-medium">{sev}</td>
                <td className="py-1.5 tabular-nums">{count(sev, "OPEN")}</td>
                <td className="py-1.5 tabular-nums">{count(sev, "ACCEPTED")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-sm">
          Open Critical non-conformances: <strong>{lastRun?.openCritical ?? defects.filter((d) => d.severity === "CRITICAL" && d.status !== "CLOSED").length}</strong>
        </p>

        {exceptions.length ? (
          <>
            <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Exceptions in force (§1.10)</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {exceptions.map((e) => (
                <li key={e.id}>{e.item} — clauses {e.clauses}: {e.reason} (granted by {e.authority}, from {fmtDate(e.startDate)}{e.reviewPoint ? `, review ${fmtDate(e.reviewPoint)}` : ""})</li>
              ))}
            </ul>
          </>
        ) : null}

        <p className="mt-8 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
          This statement is backed by the Annex H check results recorded in the system on the assessment date. Where the integrity figure
          is below the published threshold ({scope?.integrityThreshold ?? 95}%) or any Critical non-conformance is open, register-derived
          statements of performance, completeness or readiness carry the integrity figure and the open Critical count (§17.7).
          Accepted non-conformances continue to be counted (§17.6). Authorized representative: ____________________
        </p>
      </article>

      <p className="text-center text-xs text-slate-400 no-print">
        Generated from the register — a view, timestamped at generation, never edited (§16.6). <Link href="/conformance/checks" className="underline">See the check results</Link>.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[220px_1fr] gap-3 border-b border-slate-100 pb-2">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800">{children}</dd>
    </div>
  );
}
