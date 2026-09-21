import { requireScope } from "@/lib/scope";
import { eligiblePeople, proposeForStep, type WfStep } from "@/lib/workflow";
import { SendForReviewForm, type SendRoute } from "./send-for-review";

/**
 * Loads what the Send form needs for these revisions: the routes that apply
 * to every document, each step's proposed people, and who the matrix allows.
 */
export async function SendForReview({ revisionIds }: { revisionIds: string[] }) {
  const ctx = await requireScope();
  const { db } = ctx;
  const revisions = await db.revision.findMany({ where: { id: { in: revisionIds } }, include: { document: true } });
  const docs = revisions.map((r) => r.document);
  if (!docs.length) return null;

  const [templates, functions, reviewers, approvers] = await Promise.all([
    db.workflowTemplate.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    db.function.findMany({ select: { id: true, name: true } }),
    eligiblePeople(ctx, docs, "REVIEW"),
    eligiblePeople(ctx, docs, "APPROVAL"),
  ]);
  const fnName = new Map(functions.map((f) => [f.id, f.name]));

  const applies = (classes: string) => {
    if (classes === "*") return true;
    try {
      const patterns = JSON.parse(classes) as { docType?: string; discipline?: string; criticality?: string }[];
      return docs.every((d) => patterns.some((p) => (!p.docType || p.docType === d.docType) && (!p.discipline || p.discipline === d.discipline) && (!p.criticality || p.criticality === d.criticality)));
    } catch {
      return false;
    }
  };

  const routes: SendRoute[] = [];
  for (const t of templates.filter((x) => applies(x.classes))) {
    const steps = JSON.parse(t.steps) as (WfStep & { title?: string })[];
    routes.push({
      id: t.id,
      name: t.name,
      description: t.description,
      isDefault: t.isDefault,
      steps: await Promise.all(steps.map(async (s, i) => ({
        title: s.title || (s.act === "APPROVAL" ? "Approval" : `Review ${i + 1}`),
        act: s.act,
        mode: s.mode,
        proposedIds: await proposeForStep(ctx, docs, s),
        fromFunctions: (s.functionIds ?? []).map((id) => fnName.get(id) ?? "?"),
      }))),
    });
  }

  const person = (p: { id: string; name: string; functionName: string }) => ({ id: p.id, name: p.name, functionName: p.functionName });
  return <SendForReviewForm revisionIds={revisions.map((r) => r.id)} routes={routes} reviewers={reviewers.map(person)} approvers={approvers.map(person)} />;
}
