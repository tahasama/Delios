import { requireScope } from "@/lib/scope";
import { formPolicy } from "@/lib/field-policy";
import { eligiblePeople } from "@/lib/workflow";
import { api, projectPath } from "@/lib/api/client";
import { backendDocument, backendRevision } from "@/lib/api/legacy";
import type { Distribution, RouteView } from "@/lib/api/types";
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
  // The documents, and the routes the backend offers for every one of them.
  const revisions = (await Promise.all(revisionIds.map(async (id) => {
    const revision = await backendRevision(ctx, id).catch(() => null);
    const document = revision ? await backendDocument(ctx, revision.documentId) : null;
    return revision && document ? { id: revision.id, document } : null;
  }))).filter((one): one is NonNullable<typeof one> => !!one);
  const docs = revisions.map((r) => r.document);
  if (!docs.length) return null;

  const [routeLists, reviewers, approvers, strict] = await Promise.all([
    Promise.all(docs.map((d) => api<RouteView[]>(projectPath(ctx, `/documents/${d.id}/routes`)))),
    eligiblePeople(ctx, docs, "REVIEW"),
    eligiblePeople(ctx, docs, "APPROVAL"),
    matrixBinds(ctx),
  ]);
  const applicable = routeLists[0].filter((route) => routeLists.every((list) => list.some((one) => one.id === route.id)));
  const setViews = await verdictSets(ctx, ["REVIEW_OUTCOMES", ...applicable.map((t) => t.verdictSet ?? "REVIEW_OUTCOMES")]);
  const routes: SendRoute[] = applicable.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    isDefault: t.isDefault,
    verdicts: setViews.get(t.verdictSet ?? "REVIEW_OUTCOMES") ?? null,
    // The last step decides; earlier steps advise. Its people are whoever holds the step's function, and whoever it names.
    steps: t.steps.map((s, i) => {
      const deciding = i === t.steps.length - 1;
      const pool = deciding ? approvers : reviewers;
      return {
        title: s.title || (deciding ? "Decision" : `Review ${i + 1}`),
        act: deciding ? "APPROVAL" as const : "REVIEW" as const,
        mode: s.mode === "ALL" ? "ALL" as const : "ANY_OF" as const,
        proposed: pool.filter((p) => p.functionId === s.functionCode || (s.userIds ?? []).includes(p.id)).map((p) => ({ id: p.id, why: p.functionId === s.functionCode ? `${p.functionName} (route)` : "named on the route" })),
        fromFunctions: s.functionCode ? [pool.find((p) => p.functionId === s.functionCode)?.functionName ?? s.functionCode] : [],
      };
    }),
  }));

  const person = (p: { id: string; name: string; functionName: string }) => ({ id: p.id, name: p.name, functionName: p.functionName, inMatrix: true });
  // Anyone on the project may be copied in; being told is not reviewing.
  const spread = await api<Distribution>(projectPath(ctx, `/documents/${docs[0].id}/distribution`)).catch(() => null);
  const everyone = [...(spread?.proposed ?? []), ...(spread?.others ?? [])]
    .map((one) => ({ id: one.id, name: one.name, functionName: one.function }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Unless the matrix is the only rule, it recommends: its people come first,
  // and anybody else on the project may be put on a step, flagged.
  const pool = (named: { id: string; name: string; functionName: string }[]) => strict
    ? named.map(person)
    : [...named.map(person), ...everyone.filter((one) => !named.some((n) => n.id === one.id)).map((one) => ({ ...one, inMatrix: false }))];
  return <SendForReviewForm revisionIds={revisions.map((r) => r.id)} routes={routes} reviewers={pool(reviewers)} approvers={pool(approvers)} everyone={everyone} strict={strict} ownFields={policy.own} />;
}
