import { Prisma } from "@prisma/client";
import { requireScope } from "@/lib/scope";
import { PageHeader, ButtonLink } from "@/components/ui";
import { DOC_STATES, DOC_STATE_LABEL } from "@/lib/standard";
import { getSet } from "@/lib/config";
import { DocumentRegister } from "./document-register";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documents" };

type Search = { q?: string; state?: string; discipline?: string; docType?: string; view?: string };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { user, db } = await requireScope();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const state = sp.state ?? "";
  const discipline = sp.discipline ?? "";
  const docType = sp.docType ?? "";
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

  const [docs, total, disciplines, types, statuses, templates, people] = await Promise.all([
    db.document.findMany({
      where, orderBy: { updatedAt: "desc" }, take: 250,
      include: {
        revisions: { orderBy: { createdAt: "desc" }, include: {
          workflowRuns: { orderBy: { updatedAt: "desc" }, take: 1 },
          cycles: { where: { status: "OPEN" }, include: { assignments: true, comments: { where: { status: "OPEN", progressionPreventing: true } } } },
          approvals: { where: { withdrawnAt: null }, orderBy: { decidedAt: "desc" }, take: 1 },
        } },
        _count: { select: { baselineEntries: true, packageMembers: true } },
      },
    }),
    db.document.count({ where }),
    getSet("DISCIPLINES"), getSet("DOCUMENT_TYPES"), getSet("STATUSES"),
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

  const rows = docs.map((doc) => {
    const latest = doc.revisions[0] ?? null;
    const current = doc.revisions.find((revision) => revision.state === "RELEASED") ?? null;
    const working = doc.revisions.find((revision) => revision.state === "IN_PREPARATION") ?? null;
    const activeRun = doc.revisions.flatMap((revision) => revision.workflowRuns).find((run) => run.status === "ACTIVE") ?? null;
    let workflowOwner = "—";
    let workflowStage = activeRun ? "In review" : working ? "Draft" : current ? "Released" : latest ? pretty(latest.state) : "No content yet";
    if (activeRun) {
      try {
        const steps = JSON.parse(activeRun.steps) as { participantIds?: string[]; act?: string }[];
        const activeStep = steps[activeRun.currentStep];
        workflowOwner = (activeStep?.participantIds ?? []).map((id) => personById.get(id) ?? id).join(", ") || "Unassigned";
        workflowStage = activeStep?.act === "APPROVAL" ? "Awaiting approval" : "In review";
      } catch { /* safe fallback for historical workflow data */ }
    } else if (latest?.cycles[0]) {
      workflowOwner = latest.cycles[0].assignments.map((assignment) => assignment.userName).join(", ") || "Unassigned";
    }
    const openCycle = doc.revisions.flatMap((revision) => revision.cycles).find((cycle) => cycle.status === "OPEN");
    return {
      id: doc.id, docNumber: doc.docNumber, title: doc.title, deliverableType: doc.deliverableType,
      docType: doc.docType, discipline: doc.discipline, docTypeLabel: typeLabel.get(doc.docType) ?? doc.docType, disciplineLabel: disciplineLabel.get(doc.discipline) ?? doc.discipline, originator: doc.originator, subProject: doc.subProject,
      contractRef: doc.contractRef, criticality: doc.criticality, confidentiality: doc.confidentiality,
      retentionClass: doc.retentionClass, state: doc.state, placeholder: doc.isPlaceholder,
      createdDate: doc.createdDate.toISOString(), receivedDate: doc.receivedDate?.toISOString() ?? null,
      updatedAt: doc.updatedAt.toISOString(), currentRevision: current?.value ?? null,
      currentStatus: current?.statusCode ?? null, currentStatusLabel: current?.statusCode ? statusLabel.get(current.statusCode) ?? current.statusCode : null,
      latestRevision: latest?.value ?? null, latestRevisionState: latest?.state ?? null,
      plannedSubmissionDate: working?.plannedSubmissionDate?.toISOString() ?? latest?.plannedSubmissionDate?.toISOString() ?? null,
      issueDate: current?.issueDate?.toISOString() ?? null, releasedAt: current?.releasedAt?.toISOString() ?? null,
      workflowStage, workflowOwner, blockingComments: openCycle?.comments.length ?? 0,
      reviewRevisionId: working?.id ?? null, baselineCount: doc._count.baselineEntries, packageCount: doc._count.packageMembers,
      approval: latest?.approvals[0]?.approverName ?? null,
    };
  });

  const query = new URLSearchParams();
  if (q) query.set("q", q); if (state) query.set("state", state); if (discipline) query.set("discipline", discipline); if (docType) query.set("docType", docType); if (view === "all") query.set("view", "all");

  return <div className="space-y-5">
    <PageHeader title="Documents" actions={<ButtonLink href="/documents/new">Create document</ButtonLink>} />
    <DocumentRegister rows={rows} total={total} userCanAct={user.role !== "VIEWER"} filters={{ q, state, discipline, docType, view }} filterOptions={{ states: DOC_STATES.map((code) => ({ code, label: DOC_STATE_LABEL[code] ?? code })), disciplines: disciplines.filter((item) => usedDisciplines.has(item.code)).map((item) => ({ code: item.code, label: item.label })), types: types.filter((item) => usedTypes.has(item.code)).map((item) => ({ code: item.code, label: item.label })) }} exportHref={`/api/register/export${query.size ? `?${query.toString()}` : ""}`} />
  </div>;
}

function pretty(value: string) { return value.replaceAll("_", " ").toLowerCase(); }
