import { PageHeader, Card, Chip, EmptyState } from "@/components/ui";
import { requireScope } from "@/lib/scope";
import { deleteTemplateAction } from "@/lib/actions/workflow";
import { getSets } from "@/lib/config";
import { WorkflowTemplateBuilder, type WorkflowBuilderStep } from "./workflow-template-builder";
import { hasVerb } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workflow templates" };

type Step = WorkflowBuilderStep;

export default async function WorkflowTemplatesPage() {
  const { user: me, db } = await requireScope();
  const admin = hasVerb(me, "ROUTES");
  const [templates, sets, users, classValues, functions] = await Promise.all([
    db.workflowTemplate.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } }),
    getSets(),
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, include: { party: true } }),
    db.configValue.findMany({ where: { setKey: { in: ["DOCUMENT_TYPES", "DISCIPLINES", "CRITICALITY"] }, status: "ACTIVE" }, orderBy: [{ sort: "asc" }, { label: "asc" }] }),
    db.function.findMany({ where: { active: true }, orderBy: { sort: "asc" }, select: { id: true, name: true } }),
  ]);
  const outcomeSets = sets.filter((s) => s.key.includes("OUTCOME") || s.key.includes("REVIEW"));
  const classOptions = {
    documentTypes: classValues.filter((value) => value.setKey === "DOCUMENT_TYPES").map(({ code, label }) => ({ code, label })),
    disciplines: classValues.filter((value) => value.setKey === "DISCIPLINES").map(({ code, label }) => ({ code, label })),
    criticalities: classValues.filter((value) => value.setKey === "CRITICALITY").map(({ code, label }) => ({ code, label })),
  };
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Review routes"
        subtitle="The routes authors pick from when they send a document for review or approval."
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
                <ol className="space-y-1.5">
                  {steps.map((s, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="grid h-5 w-5 place-items-center rounded bg-slate-100 font-mono text-[10px] font-bold text-slate-500">{i + 1}</span>
                      <Chip className={s.act === "APPROVAL" ? "bg-emerald-100 text-emerald-800 ring-emerald-300" : "bg-sky-100 text-sky-800 ring-sky-300"}>{s.act === "APPROVAL" ? "approve" : "review"}</Chip>
                      <Chip>{s.mode === "ANY_OF" ? "any one decides" : s.mode === "SERIAL" ? "one after another" : s.mode === "ALL" ? "all give input, any order" : "all respond, last one decides"}</Chip>
                      <span className="text-xs text-slate-500">{[...(s.functionIds ?? []).map((fid) => functions.find((f) => f.id === fid)?.name ?? "?").map((n) => `any ${n}`), ...s.participantIds.map(nameOf)].join(", ")}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-[11px] text-slate-400">Used for: {t.classes === "*" ? "all documents" : "selected document classes"}</p>
                {admin ? (
                  <details className="mt-3 rounded-lg border border-slate-200">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-600">Edit</summary>
                    <div className="border-t border-slate-100 p-3">
                      <WorkflowTemplateBuilder functions={functions} id={t.id} name={t.name} description={t.description ?? ""} classes={t.classes} outcomeSetKey={t.outcomeSetKey ?? "REVIEW_OUTCOMES"} isDefault={t.isDefault} initialSteps={steps} users={users} outcomeSets={outcomeSets.map((s) => s.key)} classOptions={classOptions} />
                    </div>
                  </details>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      {admin ? (
        <details className="rounded-2xl border border-slate-200 bg-surface px-5 py-3 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-brand-ink">+ New review route</summary>
          <div className="mt-3"><WorkflowTemplateBuilder functions={functions} users={users} outcomeSets={outcomeSets.map((s) => s.key)} classOptions={classOptions} /></div>
        </details>
      ) : null}
    </div>
  );
}
