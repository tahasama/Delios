import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { fmtDateTime } from "@/lib/utils";
import { untoldRecipients } from "@/lib/supersession";
import { haltedWhere } from "@/lib/halted";

/**
 * How the register stands, in one line of figures.
 *
 * The rate leads, because it is the only number anyone repeats; what counts
 * towards it, and what holds a statement on its own, is said in words beside it
 * rather than left to be guessed from a colour.
 */
export async function AssuranceFigure() {
  const ctx = await requireScope();
  const { db } = ctx;
  const [last, scope, totalDocs, flawedDocs, criticals, risks, switchedOff] = await Promise.all([
    db.checkRun.findFirst({ orderBy: { ranAt: "desc" } }),
    db.scopeConfig.findFirst(),
    db.document.count(),
    db.document.count({ where: { defects: { some: { severity: { in: ["CRITICAL", "MAJOR"] }, status: { in: ["OPEN", "ACCEPTED"] } } } } }),
    db.defect.count({ where: { severity: "CRITICAL", status: { in: ["OPEN", "ACCEPTED"] } } }),
    Promise.all([
      untoldRecipients(ctx).then((u) => u.length),
      haltedWhere(ctx).then((where) => db.revision.count({ where })),
    ]).then((n) => n.reduce((a, b) => a + b, 0)),
    db.checkOptOut.count(),
  ]);

  if (!last) {
    return <p className="text-sm text-slate-600">Not checked yet. Run the checks to see what the register says about itself.</p>;
  }

  const threshold = scope?.integrityThreshold ?? 95;
  const clear = totalDocs - flawedDocs;
  const rate = totalDocs ? (clear / totalDocs) * 100 : 100;
  const below = rate < threshold || criticals > 0;

  return (
    <div className="grid gap-x-8 gap-y-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <div className="flex items-baseline gap-3">
        <p className={`text-4xl font-semibold leading-none tabular-nums ${below ? "text-amber-700" : "text-emerald-700"}`}>{rate.toFixed(0)}%</p>
        <p className="text-[13px] leading-4 text-slate-700">
          of documents are clear
          <span className="block text-[11px] leading-4 text-slate-400">
            {clear} of {totalDocs} · target {threshold}%
          </span>
        </p>
      </div>
      <p className="text-[12px] leading-5 text-slate-600">
        Clear means nothing critical and nothing major outstanding against the document.{" "}
        {criticals ? (
          <>
            <strong className="font-semibold text-slate-800">
              {criticals} critical {criticals === 1 ? "finding is" : "findings are"} open
            </strong>
            , so the register cannot be stated as controlled until {criticals === 1 ? "it is" : "they are"} settled; a major counts against the rate but does not hold the statement on its own.
          </>
        ) : (
          <>No critical finding is open. A major counts against the rate but does not hold the statement on its own.</>
        )}
        <span className="mt-0.5 block text-[11px] text-slate-400">
          {last.executed} of {last.totalChecks} checks asked
          {switchedOff ? ` · ${switchedOff} switched off` : ""} · {fmtDateTime(last.ranAt)}
          {last.ranByName ? ` · ${last.ranByName}` : ""}
        </span>
      </p>
      <div className="flex flex-col items-start gap-1 text-xs sm:items-end">
        <Link href="/conformance" className="font-semibold text-link hover:underline">
          {flawedDocs} document{flawedDocs === 1 ? "" : "s"} to put right →
        </Link>
        {risks ? (
          <Link href="/exposures" className="font-semibold text-amber-700 hover:underline">
            {risks} out-of-date risk{risks === 1 ? "" : "s"} →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
