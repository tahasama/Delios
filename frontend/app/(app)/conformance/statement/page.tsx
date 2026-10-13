import { requireScope } from "@/lib/scope";
import { projectExceptions } from "@/lib/api/records";
import { PageHeader } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { PrintButton } from "./print-button";
import { AssuranceTabs } from "@/app/(app)/conformance/tabs";
import { CATALOG, CHECK_BY_ID, PHASE_LABEL, type Phase } from "@/lib/checks/catalog";
import { PREVENTED } from "@/lib/checks/prevented";
import { checksOf, documentCount, flawedDocuments, liveDefects, optOutsOf, scopeOf } from "@/lib/api/conformance";
import { getMe } from "@/lib/api/me";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conformance" };

const PHASES: Phase[] = ["SETUP", "RUNNING", "HANDOVER"];
const SEVERITIES = ["CRITICAL", "MAJOR", "MINOR", "ADVISORY"] as const;

/**
 * One page that answers, for somebody outside: how is this register controlled,
 * and how do you know.
 *
 * It states what was asked, what was not asked and why, what was found, and
 * what is still open — in that order, because a result nobody can place is
 * worth nothing. Everything on it is read from the last run; nothing is typed.
 */
export default async function ConformancePage() {
  const ctx = await requireScope();
  const [scope, me, answer, defects, totalDocs, optOuts] = await Promise.all([
    scopeOf(ctx.projectId),
    getMe(),
    checksOf(ctx.projectId),
    liveDefects(ctx.projectId),
    documentCount(ctx.projectId),
    optOutsOf(ctx.projectId),
  ]);
  const project = me?.projects.find((p) => p.id === ctx.projectId) ?? null;
  const lastRun = answer.lastRun
    ? {
        ranAt: answer.lastRun.finishedAt ?? answer.lastRun.requestedAt, ranByName: answer.lastRun.requestedBy,
        items: answer.lastRun.results.map((i) => ({ id: i.checkId, checkId: i.checkId, result: i.result, failingCount: i.failing, note: i.note })),
      }
    : null;
  const exceptions = await projectExceptions(ctx);
  const flawedDocs = flawedDocuments(defects);

  const threshold = scope?.integrityThreshold ?? 95;
  const clear = totalDocs - flawedDocs;
  const rate = totalDocs ? (clear / totalDocs) * 100 : 100;
  const openCritical = defects.filter((d) => d.severity === "CRITICAL").length;
  const count = (sev: string, status: string) => defects.filter((d) => d.severity === sev && d.status === status).length;
  const items = lastRun?.items ?? [];
  const asked = items.filter((i) => i.result === "PASS" || i.result === "FAIL");
  // A check the records cannot settle. It stays in the catalogue, and is said
  // out loud here, because leaving it silent would overstate what was measured.
  const byHand = items.filter((i) => i.result === "BY_HAND" || i.result === "NOT_EXECUTABLE");
  const held = rate >= threshold && openCritical === 0;

  const perPhase = PHASES.map((p) => {
    const ids = CATALOG.filter((c) => c.phase === p).map((c) => c.id);
    const mine = items.filter((i) => ids.includes(i.checkId));
    return {
      phase: p,
      total: ids.length,
      ran: mine.filter((i) => i.result === "PASS" || i.result === "FAIL").length,
      failing: mine.filter((i) => i.result === "FAIL").length,
      found: mine.reduce((n, i) => n + (i.result === "FAIL" ? i.failingCount : 0), 0),
    };
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="no-print">
        <PageHeader
          title="Conformance"
          subtitle="One page for somebody outside the project: what the register is checked against, what was found, and what is still open. Read from the last run — nothing on it is typed."
          actions={<PrintButton />}
        />
        <AssuranceTabs current="/conformance/statement" />
      </div>

      <article className="print-sheet register register-sheet px-8 py-8 print:border-0 print:p-0 print:shadow-none">
        <header className="border-b border-line pb-4 text-center">
          <p className="stencil text-slate-400">Statement of conformance</p>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">{scope?.organizationName ?? "—"}</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {project ? `${project.name} (${project.code})` : "—"} · issued {fmtDate(new Date())} · recipient: <em>as addressed</em>
          </p>
        </header>

        <Section title="What is covered">
          <Row label="Scope">{scope?.scopeStatement ?? "—"}</Row>
          <Row label="In force since">{scope ? fmtDate(scope.effectiveDate) : "—"}</Row>
          <Row label="Documents covered">{totalDocs}</Row>
          <Row label="Last checked">{lastRun ? `${fmtDateTime(lastRun.ranAt)}${lastRun.ranByName ? ` by ${lastRun.ranByName}` : ""}` : "never"}</Row>
        </Section>

        <Section title="What was found">
          <div className="grid gap-3 sm:grid-cols-3">
            <Figure value={`${rate.toFixed(0)}%`} label="of documents carry nothing critical or major" note={`${clear} of ${totalDocs} · the project's target is ${threshold}%`} />
            <Figure value={String(openCritical)} label={openCritical === 1 ? "critical finding still open" : "critical findings still open"} note="A critical is a condition the register cannot be relied on with." />
            <Figure value={`${asked.length}/${CATALOG.length}`} label="checks asked and answered" note={optOuts.length || byHand.length ? [optOuts.length ? `${optOuts.length} not asked` : "", byHand.length ? `${byHand.length} answered by hand` : ""].filter(Boolean).join(" · ") + " — see below" : "Every check the application runs was asked."} />
          </div>

          <table className="mt-5 w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-1.5 font-semibold">Severity</th>
                <th className="py-1.5 font-semibold">Outstanding</th>
                <th className="py-1.5 font-semibold">Accepted as it is</th>
              </tr>
            </thead>
            <tbody>
              {SEVERITIES.map((sev) => (
                <tr key={sev} className="border-b border-line">
                  <td className="py-1.5 text-[13px] font-medium capitalize">{sev.toLowerCase()}</td>
                  <td className="py-1.5 text-[13px] tabular-nums">{count(sev, "OPEN")}</td>
                  <td className="py-1.5 text-[13px] tabular-nums">{count(sev, "ACCEPTED")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-4 text-slate-500">
            A finding accepted as it is has been judged not worth correcting, with a reason and a date to look again. It goes on being counted.
          </p>
        </Section>

        <Section title="What was asked, and when">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-1.5 font-semibold">Moment</th>
                <th className="py-1.5 font-semibold">Checks</th>
                <th className="py-1.5 font-semibold">Answered</th>
                <th className="py-1.5 font-semibold">Finding something</th>
              </tr>
            </thead>
            <tbody>
              {perPhase.map((p) => (
                <tr key={p.phase} className="border-b border-line">
                  <td className="py-1.5 text-[13px]">{PHASE_LABEL[p.phase]}</td>
                  <td className="py-1.5 text-[13px] tabular-nums">{p.total}</td>
                  <td className="py-1.5 text-[13px] tabular-nums">{p.ran}</td>
                  <td className="py-1.5 text-[13px] tabular-nums">
                    {p.failing}
                    {p.found ? <span className="text-slate-400"> · {p.found} found</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {byHand.length ? (
          <Section title="Answered by hand">
            <p className="mb-2 text-[11px] leading-4 text-slate-500">
              Nothing in the records settles {byHand.length === 1 ? "this one" : "these"}, so the application does not pretend to. {byHand.length === 1 ? "It is" : "They are"} confirmed by whoever holds the evidence, outside the system.
            </p>
            <ul className="space-y-1.5">
              {byHand.map((i) => {
                const meta = CHECK_BY_ID.get(i.checkId);
                return (
                  <li key={i.id} className="text-[13px] leading-5">
                    <span className="font-medium">{meta?.condition ?? i.checkId}</span>
                    <span className="block text-[11px] leading-4 text-slate-500">
                      {meta ? `${meta.method}. ` : ""}{i.note ?? "The register holds no record that would answer it."}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : null}

        {optOuts.length ? (
          <Section title="Not asked, and why">
            <ul className="space-y-1.5">
              {optOuts.map((o) => (
                <li key={o.id} className="text-[13px] leading-5">
                  <span className="font-medium">{CHECK_BY_ID.get(o.checkId)?.condition ?? o.checkId}</span>
                  <span className="block text-[11px] leading-4 text-slate-500">
                    {o.reason} — decided by {o.setByName}, {fmtDate(o.setAt)}.
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {exceptions.length ? (
          <Section title="Exemptions in force">
            <ul className="space-y-1.5">
              {exceptions.map((e) => (
                <li key={e.id} className="text-[13px] leading-5">
                  <span className="font-medium">{e.item}</span>
                  <span className="block text-[11px] leading-4 text-slate-500">
                    {e.reason} — granted by {e.authority}, from {fmtDate(e.startDate)}
                    {e.reviewPoint ? `, looked at again ${fmtDate(e.reviewPoint)}` : ""}.
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <p className="mt-7 border-t border-line pt-4 text-[11px] leading-5 text-slate-500">
          {held
            ? `On the date above the register met the project's own condition: at least ${threshold}% of documents carrying nothing critical or major, and no critical finding open.`
            : `On the date above the register did not meet the project's own condition — ${threshold}% of documents carrying nothing critical or major and no critical finding open. Any statement of progress, completeness or readiness drawn from this register should be read with the figures above.`}
          {optOuts.length ? ` ${optOuts.length} check${optOuts.length === 1 ? " was" : "s were"} not asked, for the reasons given.` : ""}
          {` A further ${PREVENTED.length} conditions are not measured, because the application refuses the act that would create them; nothing can carry what cannot arise.`}
          {" "}Signed for the organization: ____________________
        </p>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="stencil mb-2 text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 border-b border-line py-1.5">
      <span className="text-[11px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className="text-[13px] text-slate-800">{children}</span>
    </div>
  );
}

function Figure({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <div className="figure rounded-xl border border-line bg-tint-soft px-4 py-3">
      <p className="text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      <p className="mt-0.5 text-[12px] leading-4 text-slate-700">{label}</p>
      <p className="mt-1 text-[11px] leading-4 text-slate-400">{note}</p>
    </div>
  );
}
