import { Prisma } from "@prisma/client";
import { requireScope } from "@/lib/scope";
import { PageHeader, ButtonLink } from "@/components/ui";
import { OUTCOME_CONSEQUENCES, DOC_STATES, DOC_STATE_LABEL, REV_STATES, REV_STATE_LABEL, type DocState, type RevState } from "@/lib/standard";
import { getSet } from "@/lib/config";
import { DocumentRegister } from "./document-register";
import { isReadOnly } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documents" };

type Search = { q?: string; state?: string; rev?: string; status?: string; discipline?: string; docType?: string; view?: string };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { user, db } = await requireScope();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const state = sp.state ?? "";
  const discipline = sp.discipline ?? "";
  const docType = sp.docType ?? "";
  const revState = sp.rev ?? "";
  const statusCode = sp.status ?? "";
  const view = sp.view === "all" ? "all" : "current";

  let assetDocIds: string[] = [];
  if (q) {
    const assets = await db.assetItem.findMany({ where: { OR: [{ code: { contains: q } }, { name: { contains: q } }] }, select: { id: true } });
    if (assets.length) {
      const rels = await db.relationship.findMany({ where: { kind: "DOC_ASSET", toId: { in: assets.map((asset) => asset.id) } }, select: { fromId: true } });
      assetDocIds = rels.map((rel) => rel.fromId);
    }
  }

  const where: Prisma.DocumentWhereInput = {
    AND: [
      ...(state || view === "all" ? [] : [{ state: { notIn: ["WITHDRAWN", "CANCELLED", "ARCHIVED"] } }]),
      q ? { OR: [
        { docNumber: { contains: q } }, { title: { contains: q } }, { originator: { contains: q } },
        { contractRef: { contains: q } }, { previousId: { contains: q } },
        ...(assetDocIds.length ? [{ id: { in: assetDocIds } }] : []),
      ] } : {},
      state ? { state } : {}, discipline ? { discipline } : {}, docType ? { docType } : {},
    ],
  };

  const [docs, total, disciplines, types, statuses, verdictSet, templates, people] = await Promise.all([
    db.document.findMany({
      where, orderBy: { updatedAt: "desc" }, take: revState || statusCode ? 2000 : 250,
      include: {
        revisions: { orderBy: { createdAt: "desc" }, include: {
          workflowRuns: { orderBy: { updatedAt: "desc" }, take: 1 },
          cycles: { orderBy: { sequence: "desc" }, include: { assignments: true, comments: { where: { status: "OPEN", progressionPreventing: true } } } },
          approvals: { where: { withdrawnAt: null }, orderBy: { decidedAt: "desc" }, take: 1 },
        } },
        _count: { select: { baselineEntries: true, packageMembers: true } },
      },
    }),
    db.document.count({ where }),
    getSet("DISCIPLINES"), getSet("DOCUMENT_TYPES"), getSet("STATUSES"), getSet("REVIEW_OUTCOMES"),
    db.workflowTemplate.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    db.user.findMany({ where: { active: true }, select: { id: true, name: true } }),
  ]);
  // Filters offer what the register holds, not every value the organisation publishes.
  const inUse = await db.document.findMany({ select: { discipline: true, docType: true }, distinct: ["discipline", "docType"] });
  const usedDisciplines = new Set(inUse.map((d) => d.discipline));
  const usedTypes = new Set(inUse.map((d) => d.docType));
  const disciplineLabel = new Map(disciplines.map((d) => [d.code, d.label]));
  const typeLabel = new Map(types.map((t) => [t.code, t.label]));
  const personById = new Map(people.map((person) => [person.id, person.name]));
  const statusLabel = new Map(statuses.map((item) => [item.code, item.label]));
  const verdictLabel = new Map<string, string>([...Object.entries(OUTCOME_CONSEQUENCES).map(([k, v]) => [k, v.label] as [string, string]), ...verdictSet.map((item) => [item.code, item.label] as [string, string])]);
  const statusUse = new Map(statuses.map((item) => [item.code, [item.props.may ? `May: ${item.props.may}` : "", item.props.mayNot ? `May not: ${item.props.mayNot}` : ""].filter(Boolean).join("\n")]));

  // The register shows the revision being worked on — the latest one — and
  // the four facts about it, each decided by someone different:
  //   document state · revision state · review verdict · released for (status).
  // Older revisions and their history live on the document page.
  const all = docs.map((doc) => {
    const latest = doc.revisions[0] ?? null;
    const current = doc.revisions.find((revision) => revision.state === "RELEASED") ?? null;
    const working = doc.revisions.find((revision) => revision.state === "IN_PREPARATION") ?? null;
    const run = latest?.workflowRuns.find((r) => r.status === "ACTIVE") ?? null;
    let owner: string | null = null;
    let deciding = false;
    if (run) {
      try {
        const steps = JSON.parse(run.steps) as { participantIds?: string[] }[];
        owner = (steps[run.currentStep]?.participantIds ?? []).map((id) => personById.get(id) ?? id).join(", ") || "Unassigned";
        deciding = run.currentStep === steps.length - 1;
      } catch { /* historical workflow data */ }
    } else if (latest?.cycles.find((c) => c.status === "OPEN")) {
      owner = latest.cycles.find((c) => c.status === "OPEN")!.assignments.map((a) => a.userName).join(", ") || "Unassigned";
    }
    const binding = latest?.cycles.filter((c) => c.binding) ?? [];
    const decided = binding.find((c) => c.outcome) ?? null;
    const pending = binding.some((c) => c.status === "OPEN" && !c.outcome) || deciding;
    const openCycle = latest?.cycles.find((c) => c.status === "OPEN") ?? null;
    const released = latest?.state === "RELEASED" ? latest : null;
    return {
      id: doc.id, docNumber: doc.docNumber, title: doc.title, deliverableType: doc.deliverableType,
      docType: doc.docType, discipline: doc.discipline, docTypeLabel: typeLabel.get(doc.docType) ?? doc.docType, disciplineLabel: disciplineLabel.get(doc.discipline) ?? doc.discipline, originator: doc.originator, subProject: doc.subProject,
      contractRef: doc.contractRef, criticality: doc.criticality, confidentiality: doc.confidentiality,
      retentionClass: doc.retentionClass, placeholder: doc.isPlaceholder,
      docState: doc.state, docStateLabel: DOC_STATE_LABEL[doc.state as DocState] ?? doc.state,
      revision: latest?.value ?? null,
      revState: latest?.state ?? null, revStateLabel: latest ? REV_STATE_LABEL[latest.state as RevState] ?? latest.state : "No revision yet",
      owner, blockingComments: openCycle?.comments.length ?? 0,
      verdict: decided?.outcome ?? null, verdictLabel: decided?.outcome ? verdictLabel.get(decided.outcome) ?? decided.outcome : null,
      verdictBy: decided?.outcomeByName ?? null, verdictPending: pending,
      releasedFor: released?.statusCode ?? null, releasedForLabel: released?.statusCode ? statusLabel.get(released.statusCode) ?? released.statusCode : null,
      releasedForUse: released?.statusCode ? statusUse.get(released.statusCode) ?? null : null,
      createdDate: doc.createdDate.toISOString(), updatedAt: doc.updatedAt.toISOString(),
      plannedSubmissionDate: working?.plannedSubmissionDate?.toISOString() ?? latest?.plannedSubmissionDate?.toISOString() ?? null,
      issueDate: released?.issueDate?.toISOString() ?? null, releasedAt: released?.releasedAt?.toISOString() ?? null,
      decidedBy: latest?.approvals[0]?.approverName ?? null, packageCount: doc._count.packageMembers,
      // for actions on a selection, not for display
      hasReleased: !!current, reviewRevisionId: working?.id ?? null,
    };
  });
  const matching = all.filter((r) => (!revState || (revState === "NONE" ? !r.revState : r.revState === revState)) && (!statusCode || r.releasedFor === statusCode));
  const rows = matching.slice(0, 250);
  const shownTotal = revState || statusCode ? matching.length : total;

  const query = new URLSearchParams();
  if (q) query.set("q", q); if (state) query.set("state", state); if (discipline) query.set("discipline", discipline); if (docType) query.set("docType", docType); if (revState) query.set("rev", revState); if (statusCode) query.set("status", statusCode); if (view === "all") query.set("view", "all");

  return <div className="space-y-5">
    <PageHeader title="Documents" actions={<ButtonLink href="/documents/new">Create document</ButtonLink>} />
    <DocumentRegister rows={rows} total={shownTotal} userCanAct={!isReadOnly(user)} filters={{ q, state, rev: revState, status: statusCode, discipline, docType, view }} filterOptions={{ states: DOC_STATES.map((code) => ({ code, label: DOC_STATE_LABEL[code] ?? code })), revStates: [...REV_STATES.map((code) => ({ code, label: REV_STATE_LABEL[code] })), { code: "NONE", label: "No revision yet" }], statuses: statuses.map((item) => ({ code: item.code, label: `${item.code} — ${item.label}` })), disciplines: disciplines.filter((item) => usedDisciplines.has(item.code)).map((item) => ({ code: item.code, label: item.status === "RETIRED" ? `${item.label} (retired)` : item.label })), types: types.filter((item) => usedTypes.has(item.code)).map((item) => ({ code: item.code, label: item.status === "RETIRED" ? `${item.label} (retired)` : item.label })) }} exportHref={`/api/register/export${query.size ? `?${query.toString()}` : ""}`} />
  </div>;
}

function pretty(value: string) { return value.replaceAll("_", " ").toLowerCase(); }
