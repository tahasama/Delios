import { requireScope } from "@/lib/scope";
import { formPolicy } from "@/lib/field-policy";
import { eligiblePeople, proposeForStep, normalizeRoute, type WfStep } from "@/lib/workflow";
import { SendForReviewForm, type SendRoute } from "./send-for-review";
import { verdictSets } from "@/lib/verdict-sets";
import { matrixBinds } from "@/lib/control-activities";

/**
 * Loads what the Send form needs for these revisions: the routes that apply
 * to every document, each step's proposed people, and who the matrix allows.
 */
export async function SendForReview({ revisionIds }: { revisionIds: string[] }) {
  const ctx = await requireScope();
  const policy = await formPolicy(ctx, "REVIEW");
  const { db } = ctx;
  const revisions = await db.revision.findMany({ where: { id: { in: revisionIds } }, include: { document: true } });
  const docs = revisions.map((r) => r.document);
  if (!docs.length) return null;

  const [templates, functions, reviewers, approvers, strict] = await Promise.all([
    db.workflowTemplate.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    db.function.findMany({ select: { id: true, name: true } }),
    eligiblePeople(ctx, docs, "REVIEW"),
    eligiblePeople(ctx, docs, "APPROVAL"),
    matrixBinds(ctx),
  ]);
  const fnName = new Map(functions.map((f) => [f.id, f.name]));

  const applies = (classes: string) => {
    if (classes === "*") return true;
    try {
      // Originator is part of the match: "a supplier document we produced" and
      // "one we did not" are the same type and discipline, and route differently.
      const patterns = JSON.parse(classes) as { docType?: string; discipline?: string; criticality?: string; deliverableType?: string; originator?: string }[];
      return docs.every((d) => patterns.some((p) =>
        (!p.docType || p.docType === d.docType)
        && (!p.discipline || p.discipline === d.discipline)
        && (!p.criticality || p.criticality === d.criticality)
        && (!p.deliverableType || p.deliverableType === d.deliverableType)
        && (!p.originator || p.originator === (d.originator ?? ""))));
    } catch {
      return false;
    }
  };

  const applicable = templates.filter((x) => applies(x.classes));
  const setViews = await verdictSets(ctx, applicable.map((x) => x.outcomeSetKey ?? "REVIEW_OUTCOMES"));
  const routes: SendRoute[] = [];
  for (const t of applicable) {
    // The last step decides; earlier steps advise.
    const steps = normalizeRoute(JSON.parse(t.steps) as (WfStep & { title?: string })[]);
    routes.push({
      id: t.id,
      name: t.name,
      description: t.description,
      isDefault: t.isDefault,
      verdicts: setViews.get(t.outcomeSetKey ?? "REVIEW_OUTCOMES") ?? null,
      steps: await Promise.all(steps.map(async (s, i) => ({
        title: s.title || (s.act === "APPROVAL" ? "Decision" : `Review ${i + 1}`),
        act: s.act,
        mode: s.mode,
        proposed: await proposeForStep(ctx, docs, s),
        fromFunctions: (s.functionIds ?? []).map((id) => fnName.get(id) ?? "?"),
      }))),
    });
  }

  const person = (p: { id: string; name: string; functionName: string }) => ({ id: p.id, name: p.name, functionName: p.functionName, inMatrix: true });
  // Anyone on the project may be copied in; being told is not reviewing.
  const members = await db.projectMembership.findMany({
    where: { projectId: ctx.projectId, active: true, user: { active: true } },
    select: { user: { select: { id: true, name: true } }, function: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  const everyone = members.map((m) => ({ id: m.user.id, name: m.user.name, functionName: m.function?.name ?? "" }));
  // Unless the matrix is the only rule, it recommends: its people come first,
  // and anybody else on the project may be put on a step, flagged.
  const pool = (named: { id: string; name: string; functionName: string }[]) => strict
    ? named.map(person)
    : [...named.map(person), ...everyone.filter((one) => !named.some((n) => n.id === one.id)).map((one) => ({ ...one, inMatrix: false }))];
  return <SendForReviewForm revisionIds={revisions.map((r) => r.id)} routes={routes} reviewers={pool(reviewers)} approvers={pool(approvers)} everyone={everyone} strict={strict} ownFields={policy.own} />;
}
