import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, Chip, DataTable, Th, Td, Field, inputCls, ButtonLink } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { effectiveSpine, ALIGNMENT_LABEL, type Alignment } from "@/lib/spine";
import { resolveSpineLinksAction, releaseSpineBaselineAction } from "@/lib/actions/spine";
import { STANDARD_VERSION } from "@/lib/standard";
import { cn, fmtDate } from "@/lib/utils";
import { AssuranceTabs } from "@/app/(app)/conformance/tabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Traceability" };

const STATE_STYLE: Record<Alignment, string> = {
  ALIGNED: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  REVIEW_REQUIRED: "bg-amber-100 text-amber-800 ring-amber-200",
  GAP: "bg-red-100 text-red-800 ring-red-200",
  NOT_APPLICABLE: "bg-sky-100 text-sky-800 ring-sky-200",
  WITHDRAWN: "bg-slate-100 text-slate-500 ring-slate-200",
};

const LIMIT = 150;

/**
 * Annex F — whether the Rules, the Routes that apply them and the Checks that
 * verify them still agree, and the review that keeps them agreeing.
 */
export default async function TraceabilityPage({ searchParams }: { searchParams: Promise<{ state?: string; kind?: string; q?: string }> }) {
  const ctx = await requireScope();
  const { db } = ctx;
  const sp = await searchParams;
  const mayReview = ctx.can("CONTROL") || ctx.can("CONFIGURE");
  const mayRelease = ctx.can("CONFIGURE");

  const [{ rows, counts, releasable }, baselines] = await Promise.all([
    effectiveSpine(ctx),
    db.spineBaseline.findMany({ orderBy: { releasedAt: "desc" }, take: 5 }),
  ]);
  const state = (sp.state ?? (counts.GAP + counts.REVIEW_REQUIRED ? "OPEN" : "")) as Alignment | "OPEN" | "";
  const q = (sp.q ?? "").trim().toLowerCase();
  const filtered = rows.filter((r) =>
    (state === "OPEN" ? r.state === "GAP" || r.state === "REVIEW_REQUIRED" : state && state !== ("ALL" as string) ? r.state === state : true)
    && (sp.kind ? r.kind === sp.kind : true)
    && (q ? `${r.ruleId} ${r.ruleTitle} ${r.target} ${r.targetLabel}`.toLowerCase().includes(q) : true));
  const shown = filtered.slice(0, LIMIT);
  const rulesCovered = new Set(rows.filter((r) => r.kind === "CHECK" && r.state !== "GAP" && r.state !== "WITHDRAWN").map((r) => r.ruleId)).size;
  const ruleCount = new Set(rows.map((r) => r.ruleId)).size;
  const href = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { state: sp.state, kind: sp.kind, q: sp.q, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return p.size ? `/conformance/traceability?${p}` : "/conformance/traceability?state=ALL";
  };
  const last = baselines[0];
  const table = (
    <DataTable head={<tr>{mayReview ? <Th /> : null}<Th>Rule</Th><Th>Linked to</Th><Th>State</Th><Th>Last review</Th></tr>}>
      {shown.map((r, i) => (
        <tr key={r.key} className="align-top">
          {mayReview ? (
            <Td>{r.state !== "WITHDRAWN" || r.stored ? <input type="checkbox" name="key" value={r.key} defaultChecked={false} aria-label={`Select ${r.key}`} /> : null}</Td>
          ) : null}
          <Td className="whitespace-nowrap">
            {i === 0 || shown[i - 1].ruleId !== r.ruleId ? <><span className="font-mono text-xs font-semibold text-slate-800">{r.ruleId}</span><span className="block max-w-44 truncate text-[11px] text-slate-400">{r.ruleTitle}</span></> : null}
          </Td>
          <Td className="max-w-md text-xs">
            <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{r.kind === "CHECK" ? "Check" : "Route"}</span>
            <span className="text-slate-700">{r.targetLabel}</span>
            {r.why ? <span className="mt-0.5 block text-[11px] text-amber-700">{r.why}</span> : null}
            {r.reason ? <span className="mt-0.5 block text-[11px] text-slate-400">{r.reason}</span> : null}
          </Td>
          <Td><Chip className={STATE_STYLE[r.state]}>{ALIGNMENT_LABEL[r.state]}</Chip></Td>
          <Td className="whitespace-nowrap text-[11px] text-slate-500">{r.reviewedAt ? <>{fmtDate(r.reviewedAt)}<span className="block text-slate-400">{r.reviewedByName}{r.owner ? ` · owner ${r.owner}` : ""}</span></> : "—"}</Td>
        </tr>
      ))}
    </DataTable>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Traceability"
        subtitle={`How the app's checks cover the rules of the Document Management Standard v${STANDARD_VERSION}.`}
      />
      <AssuranceTabs current="/conformance/traceability" />

      <div className="rounded-2xl bg-tint-soft p-4 text-xs leading-relaxed text-slate-700 ring-1 ring-link/15">
        <p className="font-semibold text-slate-900">What this page is for</p>
        <p className="mt-1">The app checks your register against the Document Management Standard. This page records which check covers which rule of the Standard, so that when the Standard is updated nothing is silently left unchecked.</p>
        <p className="mt-2"><span className="font-semibold">Day to day there is nothing to do here.</span> Only when a new edition of the Standard is installed: links whose rule or check changed show as <em>Review required</em>. Look at each, record it as still correct (Aligned) or no longer applicable, then <em>Release baseline</em> — that records, with your name and the date, that the app follows the new edition.</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(["REVIEW_REQUIRED", "GAP", "ALIGNED", "NOT_APPLICABLE", "WITHDRAWN"] as Alignment[]).map((a) => (
          <Link key={a} href={href({ state: a })} className={cn("rounded-xl border px-3 py-2.5 transition hover:shadow-sm", state === a ? "border-brand-line bg-tint-soft" : "border-line bg-surface")}>
            <p className="text-[11px] font-semibold text-slate-500">{ALIGNMENT_LABEL[a]}</p>
            <p className={cn("text-xl font-semibold tabular-nums", a === "GAP" && counts.GAP ? "text-red-700" : a === "REVIEW_REQUIRED" && counts.REVIEW_REQUIRED ? "text-amber-700" : "text-slate-900")}>{counts[a]}</p>
          </Link>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {rulesCovered} of {ruleCount} Rules have a Check · automation reports these states; it does not decide whether the document set conforms (F.6).
      </p>

      <Card
        title="Synchronized baseline"
        description={last ? `In use now: ${last.label} — released ${fmtDate(last.releasedAt)} by ${last.releasedByName}, Standard v${last.standardVersion}` : "No baseline released yet"}
      >
        {releasable ? (
          mayRelease ? (
            <ActionForm action={releaseSpineBaselineAction} submitLabel="Release baseline" size="sm">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Label" required><input name="label" required className={inputCls} placeholder={`Spine v${STANDARD_VERSION} — ${new Date().toISOString().slice(0, 7)}`} /></Field>
                <Field label="Note"><input name="note" className={inputCls} placeholder="What this baseline reconciles" /></Field>
              </div>
            </ActionForm>
          ) : <p className="text-xs text-emerald-700">The three views reconcile. An administrator can release the baseline.</p>
        ) : (
          <p className="text-xs text-amber-800">
            Release is blocked: {counts.GAP} Gap and {counts.REVIEW_REQUIRED} Review required must be resolved first (F.5 rule 5).
            {counts.GAP ? " A Gap closes as Not applicable with its reason — for a clause that states no requirement, or a Rule no Route applies (F.3) — or by adding the missing link." : ""}
          </p>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <nav aria-label="Which rows" className="seg w-fit max-w-full">
          <Link href={href({ state: "OPEN" })} aria-current={state === "OPEN" ? "page" : undefined} className="segment">Needs attention</Link>
          <Link href={href({ state: "ALL" })} aria-current={state === ("ALL" as string) ? "page" : undefined} className="segment">All</Link>
        </nav>
        <nav aria-label="Kind" className="seg w-fit max-w-full">
          <Link href={href({ kind: undefined })} aria-current={!sp.kind ? "page" : undefined} className="segment">Checks and Routes</Link>
          <Link href={href({ kind: "CHECK" })} aria-current={sp.kind === "CHECK" ? "page" : undefined} className="segment">Checks</Link>
          <Link href={href({ kind: "ROUTE" })} aria-current={sp.kind === "ROUTE" ? "page" : undefined} className="segment">Routes</Link>
        </nav>
        <form className="ml-auto" action="/conformance/traceability">
          {sp.state ? <input type="hidden" name="state" value={sp.state} /> : null}
          {sp.kind ? <input type="hidden" name="kind" value={sp.kind} /> : null}
          <input name="q" defaultValue={sp.q} placeholder="§6.3, ID-02, G.3…" className="w-44 rounded-lg border border-line px-2.5 py-1.5 text-xs" />
        </form>
      </div>

      <Card title={`${filtered.length} link${filtered.length === 1 ? "" : "s"}${filtered.length > LIMIT ? ` · first ${LIMIT} shown` : ""}`}>
        {shown.length ? (
          mayReview ? (
          <ActionForm action={resolveSpineLinksAction} submitLabel="Record decision" size="sm">
            {(
              <div className="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-3">
                <Field label="Decision for the ticked links" required>
                  <select name="decision" required className={inputCls} defaultValue="ALIGNED">
                    <option value="ALIGNED">Aligned — reviewed against the current versions</option>
                    <option value="NOT_APPLICABLE">Not applicable — with reason (e.g. the clause states no requirement)</option>
                    <option value="WITHDRAWN">Withdrawn — no longer applies</option>
                  </select>
                </Field>
                <Field label="Reason" hint="Required unless Aligned"><input name="reason" className={inputCls} placeholder="e.g. method reworded; check unchanged in effect" /></Field>
                <Field label="Change reference"><input name="changeRef" className={inputCls} placeholder="e.g. Standard v2 impact review" /></Field>
              </div>
            )}
            {table}
          </ActionForm>
          ) : table
        ) : (
          <p className="text-xs text-slate-400">Nothing here.</p>
        )}
      </Card>
    </div>
  );
}
