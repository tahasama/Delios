import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { isController, isAdmin } from "@/lib/auth";
import { PageHeader, Card, Stat, Banner, ButtonLink } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { CATALOG, FAMILY_TITLES } from "@/lib/checks/catalog";
import { latestResults } from "@/lib/checks/engine";
import { RunChecksButton } from "./run-button";
import { effectiveSpine } from "@/lib/spine";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conformance" };

export default async function ConformancePage() {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const controller = isController(user) || isAdmin(user);
  const [lastRun, prevRun, results, scope, runs, spine, byOwner] = await Promise.all([
    db.checkRun.findFirst({ orderBy: { ranAt: "desc" } }),
    db.checkRun.findFirst({ orderBy: { ranAt: "desc" }, skip: 1 }),
    latestResults(ctx),
    db.scopeConfig.findFirst(),
    db.checkRun.findMany({ orderBy: { ranAt: "desc" }, take: 8 }),
    effectiveSpine(ctx),
    db.defect.groupBy({ by: ["ownerRole", "severity", "status"], _count: true }),
  ]);
  const OWNERS: Record<string, string> = { CF: "Control function", OR: "Originating party", RV: "Reviewer", OG: "Organization" };
  const owned = (o: string, st: string, sev?: string) => byOwner.filter((d) => d.ownerRole === o && d.status === st && (!sev || d.severity === sev)).reduce((n, d) => n + d._count, 0);

  const defects = await db.defect.groupBy({ by: ["severity", "status"], _count: true, where: { status: { in: ["OPEN", "ACCEPTED"] } } });
  const open = (sev: string) => defects.filter((d) => d.severity === sev && d.status === "OPEN").reduce((a, d) => a + d._count, 0);
  const accepted = (sev: string) => defects.filter((d) => d.severity === sev && d.status === "ACCEPTED").reduce((a, d) => a + d._count, 0);

  // per-family execution
  const familes = Object.keys(FAMILY_TITLES);
  const familyRows = familes.map((fam) => {
    const checks = CATALOG.filter((c) => c.id.split("-")[0] === fam);
    const executed = checks.filter((c) => {
      const r = results.get(c.id)?.result;
      return r === "PASS" || r === "FAIL";
    });
    const failedChecks = checks.filter((c) => results.get(c.id)?.result === "FAIL");
    return { fam, title: FAMILY_TITLES[fam], total: checks.length, executed: executed.length, failed: failedChecks.length, failingItems: failedChecks.reduce((a, c) => a + (results.get(c.id)?.failingCount ?? 0), 0) };
  });

  const threshold = scope?.integrityThreshold ?? 95;
  const warrant = lastRun ? lastRun.integrity < threshold || lastRun.openCritical > 0 : false;
  const trend = lastRun && prevRun ? lastRun.integrity - prevRun.integrity : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Assurance & integrity"
        subtitle="Measure the health of controlled information, understand failures and follow corrective work to closure."
        actions={<><ButtonLink href="/conformance/statement" variant="secondary">Assessment statement</ButtonLink>{controller ? <RunChecksButton /> : <ButtonLink href="/conformance/checks" variant="secondary">Check catalogue</ButtonLink>}</>}
      />

      {!lastRun ? (
        <Banner tone="info" title="Never measured">
          {controller ? "Run the check engine to produce the first integrity measurement (§17.4)." : "Ask the control function to run the check engine (§17.8)."}
        </Banner>
      ) : (
        <Banner tone={warrant ? "warn" : "good"} title={warrant ? "Warrant required (§17.7)" : "Integrity within threshold"}>
          {warrant
            ? `Integrity is below the published threshold (${threshold}%) or a Critical defect is open. Register-derived statements of performance, completeness or readiness must carry the integrity figure (${lastRun.integrity}%) and the open Critical count (${lastRun.openCritical}).`
            : `Integrity ${lastRun.integrity}% ≥ threshold ${threshold}%, ${lastRun.openCritical} open Critical. Statements drawn from the register carry this measurement.`}
        </Banner>
      )}

      {lastRun ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Integrity" value={`${lastRun.integrity.toFixed(1)}%`} hint={trend !== null ? `${trend >= 0 ? "+" : ""}${trend.toFixed(1)} vs previous run (CF-17)` : "first measurement"} tone={lastRun.integrity >= threshold ? "good" : "danger"} />
            <Stat label="Check coverage" value={`${lastRun.coverage.toFixed(0)}%`} hint={`${lastRun.executed} of ${lastRun.totalChecks} executable`} tone={lastRun.coverage >= 100 ? "good" : "warn"} />
            <Stat label="Failing checks" value={lastRun.failed} hint={`${lastRun.passed} passed`} href="/conformance/checks" tone={lastRun.failed ? "warn" : "good"} />
            <Stat label="Not checked" value={lastRun.notChecked + lastRun.notExecutable} hint="visible coverage gaps" href="/conformance/checks?result=NOT_CHECKED" />
            <Stat label="Critical" value={open("CRITICAL")} hint={`${accepted("CRITICAL")} accepted`} href="/conformance/defects?severity=CRITICAL" tone={open("CRITICAL") ? "danger" : "good"} />
            <Stat label="Major" value={open("MAJOR")} hint={`${accepted("MAJOR")} accepted`} href="/conformance/defects?severity=MAJOR" tone={open("MAJOR") ? "warn" : "good"} />
          </div>
          <p className="text-xs text-slate-400">
            Measured {fmtDateTime(lastRun.ranAt)} by {lastRun.ranByName} · Document Management Standard v{scope?.standardVersion ?? "1.0"} · scope: {scope?.scopeStatement ?? "—"} · integrity = (documents free of Critical and Major defects ÷ documents) × 100 (§17.4). Accepted defects continue to be counted (CF-12).
          </p>
        </>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Traceability" description="Rules ↔ Routes ↔ Checks (Annex F)" actions={<Link href="/conformance/traceability" className="text-xs font-semibold text-[#315f83] hover:underline">Open →</Link>}>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div><dt className="text-slate-400">Review required</dt><dd className={`text-lg font-semibold tabular-nums ${spine.counts.REVIEW_REQUIRED ? "text-amber-700" : "text-slate-800"}`}>{spine.counts.REVIEW_REQUIRED}</dd></div>
            <div><dt className="text-slate-400">Gap</dt><dd className={`text-lg font-semibold tabular-nums ${spine.counts.GAP ? "text-red-700" : "text-slate-800"}`}>{spine.counts.GAP}</dd></div>
            <div><dt className="text-slate-400">Aligned</dt><dd className="text-lg font-semibold tabular-nums text-slate-800">{spine.counts.ALIGNED}</dd></div>
            <div><dt className="text-slate-400">Not applicable</dt><dd className="text-lg font-semibold tabular-nums text-slate-800">{spine.counts.NOT_APPLICABLE}</dd></div>
          </dl>
          <p className="mt-2 text-[11px] text-slate-400">{spine.releasable ? "Views reconcile — a baseline can be released." : "Baseline release blocked until resolved."}</p>
        </Card>

        <Card title="Accountability" description="Defects by owner — open · accepted · closed">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-[10px] uppercase tracking-wide text-slate-400"><th className="pb-1 font-semibold">Owner</th><th className="pb-1 text-right font-semibold">Critical</th><th className="pb-1 text-right font-semibold">Major</th><th className="pb-1 text-right font-semibold">All open</th><th className="pb-1 text-right font-semibold">Acc.</th><th className="pb-1 text-right font-semibold">Closed</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {Object.entries(OWNERS).map(([code, label]) => (
                <tr key={code}>
                  <td className="py-1.5"><Link href={`/conformance/defects?owner=${code}`} className="text-slate-700 hover:underline">{label}</Link></td>
                  <td className={`py-1.5 text-right tabular-nums ${owned(code, "OPEN", "CRITICAL") ? "font-semibold text-red-700" : "text-slate-400"}`}>{owned(code, "OPEN", "CRITICAL")}</td>
                  <td className={`py-1.5 text-right tabular-nums ${owned(code, "OPEN", "MAJOR") ? "font-semibold text-amber-700" : "text-slate-400"}`}>{owned(code, "OPEN", "MAJOR")}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-700">{owned(code, "OPEN")}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-500">{owned(code, "ACCEPTED")}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-400">{owned(code, "CLOSED")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Trend" description="Integrity, coverage and open Critical across runs">
          {runs.length ? (
            <ul className="space-y-1.5">
              {runs.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-slate-400">{fmtDateTime(r.ranAt).slice(0, 12)}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full ${r.integrity >= threshold ? "bg-emerald-400" : "bg-red-400"}`} style={{ width: `${Math.max(2, r.integrity)}%` }} /></span>
                  <span className="w-12 text-right tabular-nums text-slate-700">{r.integrity.toFixed(1)}%</span>
                  <span className="w-10 text-right tabular-nums text-slate-400" title="coverage">{r.coverage.toFixed(0)}%</span>
                  <span className={`w-6 text-right tabular-nums ${r.openCritical ? "font-semibold text-red-700" : "text-slate-400"}`} title="open Critical">{r.openCritical}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-slate-400">No measurement yet.</p>}
        </Card>
      </div>

      <Card title="Check families" description="Annex H catalogue by family — executed vs failing">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {familyRows.map((f) => (
            <Link key={f.fam} href={`/conformance/checks?family=${f.fam}`} className="rounded-lg border border-slate-200 px-3 py-2.5 transition hover:border-[#2d5480]/40 hover:shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-700">{f.fam} · {FAMILY_TITLES[f.fam]?.replace(/^H\.\d+\s/, "")}</p>
                <span className="text-[11px] tabular-nums text-slate-400">{f.executed}/{f.total}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full ${f.failed ? "bg-red-400" : "bg-emerald-400"}`} style={{ width: `${f.total ? (f.executed / f.total) * 100 : 0}%` }} />
              </div>
              {f.failed ? <p className="mt-1 text-[11px] text-red-600">{f.failed} failing check{f.failed > 1 ? "s" : ""} · {f.failingItems} item(s)</p> : null}
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
