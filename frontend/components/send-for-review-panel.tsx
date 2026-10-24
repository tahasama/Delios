import { requireScope } from "@/lib/core/scope";
import { formPolicy } from "@/lib/settings/field-policy";
import { eligiblePeople } from "@/lib/reviews/workflow";
import { api, projectPath } from "@/lib/client";
import { backendDocuments, backendRevision } from "@/lib/documents/api";
import type { Distribution, RouteView } from "@/lib/types";
import { SendForReviewForm, type SendRoute } from "./send-for-review";
import { getActiveSet } from "@/lib/settings/config";
import { verdictEffect, VERDICT_EFFECT_SHORT } from "@/lib/reviews/verdict-effect";
import { matrixBinds } from "@/lib/settings/control-activities";

/**
 * Loads what the Send form needs for these revisions: the routes that apply
 * to every document, each step's proposed people, and who the matrix allows.
 */
export async function SendForReview({ revisionIds }: { revisionIds: string[] }) {
  const ctx = await requireScope();
  const policy = await formPolicy(ctx, "REVIEW");
  // The documents, and the routes the backend offers for every one of them.
  const found = (await Promise.all(revisionIds.map((id) => backendRevision(ctx, id).catch(() => null))))
    .filter((one): one is NonNullable<typeof one> => !!one);
  const read = new Map((await backendDocuments(ctx, found.map((r) => r.documentId))).map((d) => [d.id, d]));
  const revisions = found.flatMap((revision) => {
    const document = read.get(revision.documentId);
    return document ? [{ id: revision.id, document }] : [];
  });
  const docs = revisions.map((r) => r.document);
  if (!docs.length) return null;

  const [routeLists, reviewers, approvers, strict, directory] = await Promise.all([
    Promise.all(docs.map((d) => api<RouteView[]>(projectPath(ctx, `/documents/${d.id}/routes`)))),
    eligiblePeople(ctx, docs, "REVIEW"),
    eligiblePeople(ctx, docs, "APPROVAL"),
    matrixBinds(ctx),
    // The organizations taking part and their people: a step another organization answers offers its own people.
    api<{ organizations: { id: string; code: string; name: string; kind: string }[]; people: { id: string; name: string; partyId: string | null; function: string }[] }>(projectPath(ctx, "/people/directory"))
      .catch(() => ({ organizations: [], people: [] })),
  ]);
  const applicable = routeLists[0].filter((route) => routeLists.every((list) => list.some((one) => one.id === route.id)));

  // The verdicts each route decides with: its own set of the review outcomes, else the set serving each document.
  const outcomes = await getActiveSet("REVIEW_OUTCOMES");
  const verdictsOf = (routeId: string) => {
    const views = routeLists.map((list) => list.find((one) => one.id === routeId)!);
    const names = [...new Set(views.map((v) => v.verdicts ?? ""))];
    const codes = views[0]?.verdictCodes ?? outcomes.map((o) => o.code);
    const mismatched = docs.filter((_, i) => views[i]?.verdictsMismatch).map((d) => d.number);
    return {
      title: names.length === 1 && names[0] ? names[0] : "the set serving each document",
      values: outcomes.filter((o) => codes.includes(o.code)).map((o) => ({ code: o.code, label: o.label, effectLabel: VERDICT_EFFECT_SHORT[verdictEffect(o.props)] })),
      warning: mismatched.length
        ? `${names[0]} does not serve the deliverable type of ${mismatched.join(", ")}: they will be decided with its verdicts all the same.`
        : null,
    };
  };
  const routes: SendRoute[] = applicable.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    isDefault: t.isDefault,
    // The backend lists the routes that serve these documents most specific first: the first is the one recommended.
    recommended: t.id === applicable[0]?.id,
    verdicts: verdictsOf(t.id),
    // A step decides where the route says so, the last always; the others advise. Its people are whoever holds the step's
    // function and whoever it names; a matrix step, whoever the matrix gives for the documents' discipline; another
    // organization's step, its own people (or the organization itself, recorded by one of ours).
    steps: t.steps.map((s, i) => {
      const deciding = !!s.decides || i === t.steps.length - 1;
      const pool = deciding ? approvers : reviewers;
      const org = s.partyCode ? directory.organizations.find((o) => o.code === s.partyCode) : null;
      const theirs = org ? directory.people.filter((p) => p.partyId === org.id) : [];
      const base = {
        title: s.title || (deciding ? "Decision" : `Review ${i + 1}`),
        act: deciding ? "APPROVAL" as const : "REVIEW" as const,
        mode: s.mode === "ALL" ? "ALL" as const : "ANY_OF" as const,
      };
      if (s.partyCode) {
        const named = theirs.filter((p) => (s.userIds ?? []).includes(p.id));
        return {
          ...base,
          party: { name: org?.name ?? s.partyCode, asItself: org?.kind === "OFFLINE" || !theirs.length,
            people: theirs.map((p) => ({ id: p.id, name: p.name, functionName: p.function })) },
          proposed: (named.length ? named : theirs).map((p) => ({ id: p.id, why: named.length ? "named on the route" : `${org?.name ?? s.partyCode}` })),
          fromFunctions: [],
        };
      }
      return {
        ...base,
        // Recommended: whoever the route names or its function holds; a step naming nobody takes the people the
        // distribution matrix gives for the documents' discipline. The sender may change any of them.
        proposed: (() => {
          const named = pool.filter((p) => p.functionId === s.functionCode || (s.userIds ?? []).includes(p.id))
            .map((p) => ({ id: p.id, why: p.functionId === s.functionCode ? `${p.functionName} · recommended by the route` : "recommended · named on the route" }));
          // The matrix: whoever may review (or approve) every one of these documents (the pool, read from Who may do
          // what for each document's facts), narrowed by the step's function; those of its discipline first.
          const disciplines = new Set(docs.map((d) => d.discipline).filter(Boolean));
          const matrix = pool.filter((p) => !s.functionCode || p.functionId === s.functionCode)
            .filter((p) => !named.some((n) => n.id === p.id))
            .sort((a, b) => Number(!!b.department && disciplines.has(b.department)) - Number(!!a.department && disciplines.has(a.department)))
            .map((p) => ({ id: p.id, why: `${p.functionName} · recommended by the matrix${p.department && disciplines.has(p.department) ? `, ${p.department}` : ""}` }));
          if (s.fromMatrix) return [...named.filter((n) => (s.userIds ?? []).includes(n.id)), ...matrix];
          if (named.length || s.functionCode || (s.userIds ?? []).length) return named;
          return matrix;
        })(),
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
  return <SendForReviewForm revisionIds={revisions.map((r) => r.id)} routes={routes} reviewers={pool(reviewers)} approvers={pool(approvers)} everyone={everyone} strict={strict} ownFields={policy.own} copies={policy.rules.copies} />;
}
