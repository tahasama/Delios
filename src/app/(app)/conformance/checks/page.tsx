import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { isAdmin, isController } from "@/lib/auth";
import { PageHeader, Card, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { FAMILY_TITLES, PHASE_LABEL, PHASE_BLURB, CATALOG, CHECK_BY_ID, type Phase, type CheckDef } from "@/lib/checks/catalog";
import { latestResults } from "@/lib/checks/engine";
import { AssuranceTabs } from "@/app/(app)/conformance/tabs";
import { retireCheckAction, restoreCheckAction } from "@/lib/actions/conformance";
import { OWNER_LABEL } from "@/lib/problems";
import { OneKind } from "@/app/(app)/conformance/one-kind";
import { CheckFilters } from "./check-filters";
import { fmtDate } from "@/lib/utils";
import { AssuranceFigure } from "@/app/(app)/conformance/figure";
import { RunChecksButton } from "@/app/(app)/conformance/run-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "What is checked" };

const PHASES: Phase[] = ["SETUP", "RUNNING", "HANDOVER"];
const SEVERITIES = ["CRITICAL", "MAJOR", "MINOR", "ADVISORY"];
const RESULTS: { code: string; label: string }[] = [
  { code: "FAIL", label: "Found something" },
  { code: "PASS", label: "Nothing found" },
  { code: "OFF", label: "Switched off" },
];

/** What the last run made of a check: a mark, and words only when they are worth reading. */
const STATE: Record<string, { dot: string; text?: string; tone?: string }> = {
  PASS: { dot: "bg-emerald-500" },
  NOT_CHECKED: { dot: "bg-slate-300", text: "never run", tone: "text-slate-400" },
  BY_HAND: { dot: "bg-slate-300", text: "by hand", tone: "text-slate-500" },
  NEEDS_SETUP: { dot: "bg-amber-400", text: "needs a setting", tone: "text-amber-700" },
  NOT_EXECUTABLE: { dot: "bg-amber-400", text: "cannot run", tone: "text-amber-700" },
  OFF: { dot: "bg-transparent ring-1 ring-slate-300", text: "switched off", tone: "text-slate-400" },
};

const SEVERITY_TONE: Record<string, string> = {
  CRITICAL: "text-red-700",
  MAJOR: "text-amber-700",
  MINOR: "text-slate-500",
  ADVISORY: "text-slate-400",
};

/**
 * The catalogue as a matrix: the moment across the top, the family down the
 * side.
 *
 * When a check bites is the division that means something to a reader, so it
 * takes the tabs. The seventeen families are a filing system — useful to narrow
 * with, not to lead with — so they go down the side, where a long list costs
 * nothing and stays put while the checks scroll.
 */
type Search = { phase?: string; family?: string; severity?: string; owner?: string; result?: string; check?: string; show?: string };

export default async function ChecksPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireScope();
  const { db, user } = ctx;
  const sp = await searchParams;
  const phase = PHASES.includes(sp.phase as Phase) ? (sp.phase as Phase) : null;
  const admin = isAdmin(user);
  const controller = isController(user) || admin;

  // One check, and every document carrying it.
  if (sp.check && CHECK_BY_ID.has(sp.check)) {
    return <OneKind ctx={ctx} checkId={sp.check} controller={controller} back="/conformance/checks?result=FAIL" />;
  }

  const [results, optOuts] = await Promise.all([latestResults(ctx), db.checkOptOut.findMany()]);
  const off = new Map(optOuts.map((o) => [o.checkId, o]));

  const severity = SEVERITIES.includes(sp.severity ?? "") ? sp.severity! : null;
  const owner = sp.owner && OWNER_LABEL[sp.owner] ? sp.owner : null;
  const result = ["FAIL", "PASS", "OFF"].includes(sp.result ?? "") ? sp.result! : null;
  const show = sp.show === "RISKS" ? "RISKS" : "";
  /** What the last run made of a check, with a switch-off standing above it. */
  const stateOf = (id: string) => (off.has(id) ? "OFF" : results.get(id)?.result ?? "NOT_CHECKED");

  // Counts follow the filters that are set, so a tab never promises rows the
  // page would not show if you pressed it.
  const narrowedBy = (c: CheckDef) =>
    (!severity || c.severity === severity) && (!owner || c.owner === owner) && (show !== "RISKS" || c.outOfDate);
  const countOf = (p: Phase) => CATALOG.filter((c) => c.phase === p && narrowedBy(c)).length;
  const inPhase = (phase ? CATALOG.filter((c) => c.phase === phase) : CATALOG).filter(narrowedBy);
  // The families that have anything in the chosen moment, in catalogue order.
  const familyOrder = [...new Set(CATALOG.map((c) => c.id.split("-")[0]))];
  const familiesHere = familyOrder.filter((f) => inPhase.some((c) => c.id.split("-")[0] === f));
  const family = sp.family && familiesHere.includes(sp.family) ? sp.family : null;
  const shown = (family ? inPhase.filter((c) => c.id.split("-")[0] === family) : inPhase).filter(
    (c) => !result || stateOf(c.id) === result,
  );
  const narrowed = Boolean(severity || owner || result || show);



  const href = (next: { phase?: Phase | null; family?: string | null; severity?: string | null; owner?: string | null; result?: string | null; show?: string | null }) => {
    const pick = <K extends keyof typeof next>(k: K, current: string | null) => (next[k] === undefined ? current : (next[k] as string | null));
    const q = new URLSearchParams();
    const p = pick("phase", phase);
    const f = pick("family", family);
    const sev = pick("severity", severity);
    const own = pick("owner", owner);
    const res = pick("result", result);
    const sh = pick("show", show || null);
    if (sh) q.set("show", sh);
    if (p) q.set("phase", p);
    if (f) q.set("family", f);
    if (sev) q.set("severity", sev);
    if (own) q.set("owner", own);
    if (res) q.set("result", res);
    return `/conformance/checks${q.size ? `?${q}` : ""}`;
  };

  const filterBase = href({}).split("?")[1] ?? "";

  const tabCls = (on: boolean) =>
    `-mb-px shrink-0 border-b-2 px-0.5 pb-2 text-[12px] leading-4 transition ${
      on ? "border-brand-ink font-semibold text-slate-900" : "border-transparent text-slate-500 hover:border-line-strong hover:text-slate-800"
    }`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assurance"
        subtitle={`What the register is checked against, and how it stands. ${narrowed ? `${shown.length} of ${CATALOG.length} checks shown.` : `All ${CATALOG.length} are questions the application answers from the records it holds.`}`}
        actions={controller ? <RunChecksButton /> : undefined}
      >
        <AssuranceFigure />
      </PageHeader>
      <AssuranceTabs current="/conformance/checks" />

      <CheckFilters
        base={filterBase}
        narrowed={narrowed}
        count={`${shown.length} of ${CATALOG.length} checks`}
        choices={[
          { name: "severity", value: severity ?? "", empty: "Any severity", options: SEVERITIES.map((sev) => ({ code: sev, label: sev[0] + sev.slice(1).toLowerCase() })) },
          { name: "owner", value: owner ?? "", empty: "Anyone's to put right", options: Object.entries(OWNER_LABEL).map(([code, label]) => ({ code, label })) },
          { name: "result", value: result ?? "", empty: "Any result", options: RESULTS },
          { name: "show", value: show, empty: "Any subject", options: [{ code: "RISKS", label: "Out-of-date information" }] },
        ]}
      />

      {/* Two rows: the moment runs above the list only, so the family rail and
          the first card begin on the same line. */}
      <div className="grid gap-x-5 gap-y-3 md:grid-cols-[11rem_minmax(0,1fr)] md:items-start">
        <div className="max-w-4xl md:col-start-2">
          <nav aria-label="When it is checked" className="flex flex-wrap items-center gap-x-6 border-b border-line">
            <Link href={href({ phase: null })} scroll={false} aria-current={!phase ? "page" : undefined} className={tabCls(!phase)}>
              All <span className="ml-1 tabular-nums text-slate-400">{CATALOG.filter(narrowedBy).length}</span>
            </Link>
            {PHASES.map((p) => (
              <Link key={p} href={href({ phase: p, family: null })} scroll={false} aria-current={phase === p ? "page" : undefined} className={tabCls(phase === p)}>
                {PHASE_LABEL[p]} <span className="ml-1 tabular-nums text-slate-400">{countOf(p)}</span>
              </Link>
            ))}
          </nav>
        </div>

        <nav
          aria-label="Family of checks"
          className="scroll-thin md:col-start-1 md:row-start-1 md:row-span-2 md:sticky md:top-20 md:max-h-[calc(100vh-5.5rem)] md:overflow-y-auto"
        >
          <Family href={href({ family: null })} label="All families" count={inPhase.length} active={!family} />
          {familiesHere.map((f) => (
            <Family
              key={f}
              href={href({ family: f })}
              label={FAMILY_TITLES[f] ?? f}
              count={inPhase.filter((c) => c.id.split("-")[0] === f).length}
              active={family === f}
            />
          ))}
        </nav>

        <div className="scroll-thin min-w-0 max-w-4xl space-y-4 md:col-start-2 md:row-start-2 md:max-h-[calc(100vh-9.5rem)] md:overflow-y-auto md:pr-1">
          {!shown.length ? (
            <p className="rounded-xl border border-dashed border-line-strong bg-slate-50 px-6 py-8 text-center text-[13px] text-slate-500">
              No check matches that.{" "}
              <Link href={href({ severity: null, owner: null, result: null })} className="font-semibold text-link hover:underline">
                Clear the filters
              </Link>
            </p>
          ) : null}
          {PHASES.filter((p) => !phase || p === phase).map((p) => {
            const rows = shown.filter((c) => c.phase === p);
            if (!rows.length) return null;
            const families = [...new Set(rows.map((c) => c.id.split("-")[0]))];
            return (
              <Card key={p} title={PHASE_LABEL[p]} description={PHASE_BLURB[p]}>
                {families.map((f) => (
                  <section key={f} className="mb-5 last:mb-0">
                    {family ? null : <h3 className="stencil mb-2 text-slate-400">{FAMILY_TITLES[f] ?? f}</h3>}
                    <ul className="divide-y divide-line">
                      {rows
                        .filter((c) => c.id.split("-")[0] === f)
                        .map((c) => (
                          <CheckRow key={c.id} check={c} result={results.get(c.id)} off={off.get(c.id)} admin={admin} />
                        ))}
                    </ul>
                  </section>
                ))}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** One entry in the family rail. */
/** One entry in the family rail. */
/** A filter on a rule, in the register's own hand: a plain choice, applied on Apply. */
function Choice({ name, value, empty, options }: { name: string; value: string; empty: string; options: { code: string; label: string }[] }) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{empty}</span>
      <select name={name} defaultValue={value} data-on={value ? "true" : "false"} className="plain w-full">
        <option value="">{empty}</option>
        {options.map((o) => (
          <option key={o.code} value={o.code}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function Family({ href, label, count, active }: { href: string; label: string; count: number; active: boolean }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={`flex items-baseline justify-between gap-2 rounded-r border-l-2 py-[5px] pl-2.5 pr-1.5 text-[12px] leading-4 transition ${
        active ? "border-brand-ink bg-tint font-semibold text-slate-900" : "border-transparent text-slate-500 hover:border-line-strong hover:bg-slate-50 hover:text-slate-800"
      }`}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{count}</span>
    </Link>
  );
}

/**
 * One check.
 *
 * A hundred green chips saying "nothing found" is a hundred things to read and
 * nothing learned, so a passing check gets a dot and its words back; only a
 * result worth acting on is spelled out.
 */
function CheckRow({
  check,
  result,
  off,
  admin,
}: {
  check: CheckDef;
  result?: { result: string; failingCount: number };
  off?: { reason: string; setByName: string; setAt: Date };
  admin: boolean;
}) {
  const failing = !off && result?.result === "FAIL";
  const state = off ? STATE.OFF : STATE[result?.result ?? "NOT_CHECKED"] ?? STATE.NOT_CHECKED;
  return (
    <li className="group py-2">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${failing ? "bg-red-500" : state.dot}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={`text-[13px] leading-5 ${off ? "text-slate-400 line-through" : "text-slate-800"}`}>{check.condition}</span>
            <span className="font-mono text-[10px] text-slate-300 group-hover:text-slate-400">{check.id}</span>
          </div>
          <p className="mt-0.5 text-[11.5px] leading-[1.45] text-slate-500">
            {check.method}. Reads {check.evidence.toLowerCase()}.
          </p>
        </div>
        <div className="w-32 shrink-0 text-right md:w-40">
          {failing ? (
            // The count is the way in: a check that found something is only
            // useful if it tells you which documents, and that list is one tab away.
            <Link
              href={`/conformance?check=${check.id}`}
              className="text-[12px] font-semibold leading-5 text-red-700 underline-offset-2 hover:underline"
            >
              {result!.failingCount} outstanding →
            </Link>
          ) : (
            <p className={`text-[12px] leading-5 ${state.tone ?? "hidden"}`}>{state.text}</p>
          )}
          <p className="text-[10px] uppercase leading-4 tracking-wide">
            <span className={SEVERITY_TONE[check.severity] ?? "text-slate-400"}>{check.severity.toLowerCase()}</span>
            <span className="text-slate-300"> · </span>
            <span className="text-slate-400">{OWNER_LABEL[check.owner] ?? check.owner}</span>
          </p>
        </div>
      </div>

      {off ? (
        <div className="mt-1 pl-[18px] text-[11px] leading-4 text-slate-500">
          Switched off by {off.setByName}, {fmtDate(off.setAt)} — {off.reason}
          {admin ? (
            <ActionForm action={restoreCheckAction} submitLabel="Ask it again" size="sm" variant="secondary" className="mt-1.5" hidden={{ checkId: check.id }} />
          ) : null}
        </div>
      ) : admin ? (
        <details className="pl-[18px]">
          <summary className="cursor-pointer text-[11px] leading-4 text-transparent transition group-hover:text-slate-400 hover:!text-slate-700 focus-visible:text-slate-700">
            This one does not apply to us…
          </summary>
          <div className="mt-1.5 max-w-xl">
            <ActionForm action={retireCheckAction} submitLabel="Switch it off" size="sm" variant="secondary" hidden={{ checkId: check.id }}>
              <input name="reason" className={inputCls} placeholder="Why it does not apply to this project" />
              <p className="text-[11px] leading-4 text-slate-400">
                It stops being asked and its findings close. The reason is kept, and the conformance statement says so.
              </p>
            </ActionForm>
          </div>
        </details>
      ) : null}
    </li>
  );
}
