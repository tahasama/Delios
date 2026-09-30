import { PageHeader, Card, Chip, EmptyState } from "@/components/ui";
import { requireScope } from "@/lib/scope";
import { deleteTemplateAction } from "@/lib/actions/workflow";
import { getSets, getActiveSet } from "@/lib/config";
import { WorkflowTemplateBuilder, type WorkflowBuilderStep } from "./workflow-template-builder";
import { hasVerb } from "@/lib/auth";
import { ArrowRight } from "lucide-react";
import { verdictSets } from "@/lib/verdict-sets";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review routes" };

type Step = WorkflowBuilderStep;

export default async function WorkflowTemplatesPage() {
  const { user: me, db } = await requireScope();
  const admin = hasVerb(me, "ROUTES");
  const [templates, sets, users, classValues, functions, outsideParties] = await Promise.all([
    db.workflowTemplate.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } }),
    getSets(),
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, include: { party: true } }),
    db.configValue.findMany({ where: { setKey: { in: ["DOCUMENT_TYPES", "DISCIPLINES", "CRITICALITY", "DELIVERABLE_TYPES", "SUPPLIER_CODES"] }, status: "ACTIVE" }, orderBy: [{ sort: "asc" }, { label: "asc" }] }),
    db.function.findMany({ where: { active: true }, orderBy: { sort: "asc" }, select: { id: true, name: true } }),
    // Parties that can hold a step of a route: a client, a control office, a
    // supplier. How each of them answers is set in Parties & people.
    db.party.findMany({ where: { isInternal: false, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, participation: true } }),
  ]);
  const outcomeSets = sets.filter((s) => s.key.includes("OUTCOME") || s.key.includes("REVIEW"));
  // What each status lets a step do. The rules live in the status list, so a
  // route can only offer what the organization published.
  const statusChoices = (await getActiveSet("STATUSES")).map((value) => {
    return { code: value.code, label: value.label };
  });
  const classOptions = {
    documentTypes: classValues.filter((value) => value.setKey === "DOCUMENT_TYPES").map(({ code, label }) => ({ code, label })),
    disciplines: classValues.filter((value) => value.setKey === "DISCIPLINES").map(({ code, label }) => ({ code, label })),
    criticalities: classValues.filter((value) => value.setKey === "CRITICALITY").map(({ code, label }) => ({ code, label })),
    // Who produces it, and which outside organization it came from: a supplier
    // drawing and one of ours are the same type and take different routes.
    deliverableTypes: classValues.filter((value) => value.setKey === "DELIVERABLE_TYPES").map(({ code, label }) => ({ code, label })),
    originators: classValues.filter((value) => value.setKey === "SUPPLIER_CODES").map(({ code, label }) => ({ code, label })),
  };
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? id;
  const setViews = await verdictSets({ db }, templates.map((t) => t.outcomeSetKey ?? "REVIEW_OUTCOMES"));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Review routes"
        subtitle="The routes a document is sent down for review. Earlier steps advise; the last step gives the one binding verdict, which is also the release approval."
      />

      {templates.length === 0 ? (
        <EmptyState title="No review routes yet" body="Create one so authors can send documents for review." />
      ) : (
        <div className="space-y-3">
          {templates.map((t) => {
            const steps = JSON.parse(t.steps) as Step[];
            return (
              <Card key={t.id} title={t.name} description={t.description ?? ""} actions={
                <div className="flex items-center gap-2">
                  {t.isDefault ? <Chip className="bg-sky-100 text-sky-700 ring-sky-300">default</Chip> : null}
                  <Chip>{steps.length} step{steps.length === 1 ? "" : "s"}</Chip>
                  {admin ? (
                    <form action={deleteTemplateAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <button className="text-xs text-slate-400 hover:text-red-600">remove</button>
                    </form>
                  ) : null}
                </div>
              }>
                {(() => {
                  const v = setViews.get(t.outcomeSetKey ?? "REVIEW_OUTCOMES");
                  return v ? (
                    <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                      <span className="font-semibold text-slate-700">Verdicts: {v.title}</span>
                      <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                        {v.values.map((x) => <span key={x.code} className="rounded bg-surface px-1.5 py-0.5 ring-1 ring-slate-200" title={`${x.label} — ${x.effectLabel}`}><span className="font-mono font-bold">{x.code}</span> <span className="text-slate-500">{x.effectLabel}</span></span>)}
                      </span>
                    </div>
                  ) : null;
                })()}
                <div className="scroll-thin flex items-stretch gap-1 overflow-x-auto pb-1">
                  {steps.map((s, i) => {
                    const decides = i === steps.length - 1;
                    const who = [...(s.functionIds ?? []).map((fid) => `any ${functions.find((f) => f.id === fid)?.name ?? "?"}`), ...s.participantIds.map(nameOf)];
                    return (
                      <div key={i} className="flex items-stretch gap-1">
                        <div className={`w-48 shrink-0 rounded-xl border p-2.5 ${decides ? "border-emerald-300 bg-emerald-50/60" : "border-line bg-slate-50"}`}>
                          <p className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Step {i + 1}</span>
                            <Chip className={decides ? "bg-emerald-100 text-emerald-800 ring-emerald-300" : "bg-sky-100 text-sky-800 ring-sky-300"}>{decides ? "decides" : "advises"}</Chip>
                          </p>
                          <p className="mt-1 text-[13px] font-semibold text-slate-900">{s.title || (decides ? "Decision" : `Review ${i + 1}`)}</p>
                          <p className="mt-1 text-[11px] leading-4 text-slate-600">{who.length ? who.join(", ") : <span className="text-amber-700">by discipline when sent</span>}</p>
                          {who.length > 1 ? <p className="mt-1 text-[10px] text-slate-400">{s.mode === "ANY_OF" ? "whoever gets there first" : s.mode === "SERIAL" ? "one after another" : s.mode === "ALL" ? "all, any order" : "all, last one sums up"}</p> : null}
                        </div>
                        {i < steps.length - 1 ? <ArrowRight className="h-4 w-4 shrink-0 self-center text-slate-300" aria-hidden /> : null}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] text-slate-400">Used for: {scopeWords(t.classes)}</p>
                {admin ? (
                  <details className="mt-3 rounded-lg border border-line">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-600">Edit</summary>
                    <div className="border-t border-line p-3">
                      <WorkflowTemplateBuilder outsideParties={outsideParties} functions={functions} id={t.id} name={t.name} description={t.description ?? ""} classes={t.classes} outcomeSetKey={t.outcomeSetKey ?? "REVIEW_OUTCOMES"} isDefault={t.isDefault} initialSteps={steps} users={users} outcomeSets={outcomeSets.map((s) => s.key)} classOptions={classOptions} statuses={statusChoices} />
                    </div>
                  </details>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      {admin ? (
        <details className="rounded-2xl border border-line bg-surface px-5 py-3 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-brand-ink">+ New review route</summary>
          <div className="mt-3"><WorkflowTemplateBuilder outsideParties={outsideParties} functions={functions} users={users} outcomeSets={outcomeSets.map((s) => s.key)} classOptions={classOptions} statuses={statusChoices} /></div>
        </details>
      ) : null}
    </div>
  );
}

/**
 * What a route is chosen by, said in words. An empty answer on any one of the
 * five means it does not narrow by that, so it is left out.
 */
function scopeWords(classes: string): string {
  if (!classes || classes === "*") return "all documents";
  try {
    const parsed = JSON.parse(classes) as { docType?: string; discipline?: string; criticality?: string; deliverableType?: string; originator?: string }[];
    const said = parsed
      .map((p) => [p.deliverableType, p.docType, p.discipline, p.criticality, p.originator ? `from ${p.originator}` : null].filter(Boolean).join(" · "))
      .filter(Boolean);
    return said.length ? said.join("  or  ") : "all documents";
  } catch {
    return "selected document classes";
  }
}
