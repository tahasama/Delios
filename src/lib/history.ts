import type { Tenant } from "@/lib/tenant";

export type SnapshotContext = {
  eventType: string;
  eventLabel?: string | null;
  actorName: string;
  auditEventId?: string | null;
  revisionId?: string | null;
  capturedAt?: Date;
};

export type SnapshotRevision = {
  id: string;
  value: string;
  series: string;
  state: string;
  statusCode: string | null;
  phase: string | null;
  reasonForRevision: string | null;
  changeDescription: string | null;
  plannedSubmissionDate: string | null;
  issueDate: string | null;
  releasedAt: string | null;
  releasedByName: string | null;
  createdAt: string;
  files: Array<{ id: string; name: string; kind: string; mime: string; size: number; sha256: string; uploadedByName: string | null; createdAt: string }>;
  approvals: Array<{ id: string; approverName: string; approverRole: string; matrixVersion: number; decidedAt: string; note: string | null; withdrawnAt: string | null }>;
  cycles: Array<{ id: string; sequence: number; status: string; mode: string; outcome: string | null; submittedAt: string; issuedToReviewAt: string | null; returnedFromReviewAt: string | null; returnedToOriginatorAt: string | null; comments: Array<{ id: string; text: string; classification: string; progressionPreventing: boolean; status: string; resolution: string | null; createdAt: string }>; assignments: Array<{ id: string; userName: string; order: number; completedAt: string | null }> }>;
  workflowRuns: Array<{ id: string; templateName: string; status: string; currentStep: number; createdAt: string; updatedAt: string }>;
  transmittalItems: Array<{ id: string; transmittal: { id: string; number: string; direction: string; reasonForIssue: string; dateOfIssue: string; status: string; recipients: Array<{ id: string; name: string; organization: string | null; notifiedAt: string | null; openedAt: string | null; lastViewedAt: string | null; viewCount: number; acknowledgedAt: string | null }> } }>;
  copies: Array<{ id: string; holder: string; location: string; status: string; actionRecord: string | null; actionDate: string | null }>;
};

export type SnapshotDocument = Record<string, unknown> & {
  id: string;
  docNumber: string;
  title: string;
  state: string;
  kind: string;
  deliverableType: string;
  docType: string;
  discipline: string;
  originator: string | null;
  subProject: string | null;
  contractRef: string | null;
  criticality: string | null;
  confidentiality: string | null;
  retentionClass: string | null;
  isPlaceholder: boolean;
  previousId: string | null;
  legacyScheme: string | null;
  createdDate: string;
  receivedDate: string | null;
  updatedAt: string;
  revisions: SnapshotRevision[];
  baselineEntries: Array<{ id: string; requiredStatus: string; requiredBy: string; action: { id: string; code: string; name: string; scheduledDate: string | null; ownerName: string | null } }>;
  packageMembers: Array<{ id: string; requiredStatus: string; package: { id: string; identifier: string; purpose: string; type: string; completionDate: string; closedAt: string | null } }>;
};

export type DocumentSnapshotPayload = {
  document: SnapshotDocument;
  relationships: Array<Record<string, unknown>>;
};

export async function captureDocumentSnapshot(t: Tenant, documentId: string, context: SnapshotContext) {
  const { db } = t;
  const [document, relationships] = await Promise.all([
    db.document.findUnique({
      where: { id: documentId },
      include: {
        revisions: {
          orderBy: { createdAt: "asc" },
          include: {
            files: { select: { id: true, name: true, kind: true, mime: true, size: true, sha256: true, uploadedByName: true, createdAt: true } },
            approvals: { orderBy: { decidedAt: "asc" } },
            cycles: { orderBy: { sequence: "asc" }, include: { comments: { orderBy: { createdAt: "asc" } }, assignments: { orderBy: { order: "asc" } } } },
            workflowRuns: { orderBy: { createdAt: "asc" } },
            transmittalItems: { include: { transmittal: { include: { recipients: true } } } },
            copies: { orderBy: { createdAt: "asc" } },
          },
        },
        baselineEntries: { include: { action: true }, orderBy: { requiredBy: "asc" } },
        packageMembers: { include: { package: true } },
      },
    }),
    db.relationship.findMany({ where: { OR: [{ fromId: documentId }, { toId: documentId }] }, orderBy: { createdAt: "asc" } }),
  ]);
  if (!document) return null;

  if (context.eventType === "METADATA_CHANGE") {
    const recent = await db.documentSnapshot.findFirst({
      where: {
        documentId,
        eventType: context.eventType,
        actorName: context.actorName,
        capturedAt: { gte: new Date((context.capturedAt ?? new Date()).getTime() - 2_000) },
      },
      orderBy: { capturedAt: "desc" },
    });
    if (recent) {
      return db.documentSnapshot.update({
        where: { id: recent.id },
        data: {
          auditEventId: context.auditEventId ?? recent.auditEventId,
          eventLabel: context.eventLabel ?? recent.eventLabel,
          payload: JSON.stringify({ document, relationships }),
        },
      });
    }
  }

  return db.documentSnapshot.create({
    data: {
      projectId: t.projectId,
      documentId,
      revisionId: context.revisionId ?? null,
      auditEventId: context.auditEventId ?? null,
      eventType: context.eventType,
      eventLabel: context.eventLabel ?? null,
      actorName: context.actorName,
      capturedAt: context.capturedAt ?? new Date(),
      payload: JSON.stringify({ document, relationships }),
    },
  });
}

export async function captureSnapshotsForAudit(t: Tenant, input: { entityType?: string; entityId?: string; action: string; entityLabel?: string; detail?: string; actorName: string }, auditEventId: string, capturedAt: Date) {
  if (!input.entityType || !input.entityId) return;
  const references = await resolveDocumentReferences(t, input.entityType, input.entityId);
  for (const reference of references) {
    await captureDocumentSnapshot(t, reference.documentId, {
      eventType: input.action,
      eventLabel: input.detail ?? input.entityLabel ?? null,
      actorName: input.actorName,
      auditEventId,
      revisionId: reference.revisionId,
      capturedAt,
    });
  }
}

async function resolveDocumentReferences(t: Tenant, entityType: string, entityId: string): Promise<Array<{ documentId: string; revisionId: string | null }>> {
  const { db } = t;
  if (entityType === "Document") return [{ documentId: entityId, revisionId: null }];
  if (entityType === "Revision") {
    const revision = await db.revision.findUnique({ where: { id: entityId }, select: { id: true, documentId: true } });
    return revision ? [{ documentId: revision.documentId, revisionId: revision.id }] : [];
  }
  if (entityType === "ReviewCycle") {
    const cycle = await db.reviewCycle.findUnique({ where: { id: entityId }, select: { revision: { select: { id: true, documentId: true } } } });
    return cycle ? [{ documentId: cycle.revision.documentId, revisionId: cycle.revision.id }] : [];
  }
  if (entityType === "ReviewComment") {
    const comment = await db.reviewComment.findUnique({ where: { id: entityId }, select: { cycle: { select: { revision: { select: { id: true, documentId: true } } } } } });
    return comment ? [{ documentId: comment.cycle.revision.documentId, revisionId: comment.cycle.revision.id }] : [];
  }
  if (entityType === "WorkflowRun") {
    const run = await db.workflowRun.findUnique({ where: { id: entityId }, select: { revision: { select: { id: true, documentId: true } } } });
    return run ? [{ documentId: run.revision.documentId, revisionId: run.revision.id }] : [];
  }
  if (entityType === "RegisteredCopy") {
    const copy = await db.registeredCopy.findUnique({ where: { id: entityId }, select: { revision: { select: { id: true, documentId: true } } } });
    return copy ? [{ documentId: copy.revision.documentId, revisionId: copy.revision.id }] : [];
  }
  if (entityType === "Transmittal") {
    const items = await db.transmittalItem.findMany({ where: { transmittalId: entityId }, select: { revision: { select: { id: true, documentId: true } } } });
    const unique = new Map(items.map((item) => [item.revision.documentId, { documentId: item.revision.documentId, revisionId: item.revision.id }]));
    return [...unique.values()];
  }
  return [];
}

export function parseSnapshotPayload(payload: string): DocumentSnapshotPayload {
  return JSON.parse(payload) as DocumentSnapshotPayload;
}

export function summarizeSnapshotChange(current: DocumentSnapshotPayload, previous: DocumentSnapshotPayload | null): string[] {
  if (!previous) return ["History baseline established"];
  const changes: string[] = [];
  const fields: Array<[keyof SnapshotDocument, string]> = [
    ["title", "Title"], ["state", "Document state"], ["docType", "Document type"], ["discipline", "Discipline"],
    ["criticality", "Criticality"], ["confidentiality", "Confidentiality"], ["retentionClass", "Retention class"], ["isPlaceholder", "Placeholder status"],
  ];
  for (const [field, label] of fields) {
    if (String(current.document[field] ?? "") !== String(previous.document[field] ?? "")) changes.push(`${label} changed`);
  }
  const oldRevisions = new Map(previous.document.revisions.map((revision) => [revision.id, revision]));
  for (const revision of current.document.revisions) {
    const old = oldRevisions.get(revision.id);
    if (!old) changes.push(`Revision ${revision.value} established`);
    else {
      if (old.state !== revision.state) changes.push(`Revision ${revision.value}: ${old.state.replaceAll("_", " ").toLowerCase()} → ${revision.state.replaceAll("_", " ").toLowerCase()}`);
      if (old.statusCode !== revision.statusCode) changes.push(`Revision ${revision.value}: status ${old.statusCode ?? "—"} → ${revision.statusCode ?? "—"}`);
      if (old.approvals.length !== revision.approvals.length) changes.push(`Revision ${revision.value}: approval evidence updated`);
      if (old.cycles.length !== revision.cycles.length) changes.push(`Revision ${revision.value}: review cycle added`);
      const oldComments = old.cycles.reduce((sum, cycle) => sum + cycle.comments.length, 0);
      const comments = revision.cycles.reduce((sum, cycle) => sum + cycle.comments.length, 0);
      if (oldComments !== comments) changes.push(`Revision ${revision.value}: review comments updated`);
      if (old.files.length !== revision.files.length) changes.push(`Revision ${revision.value}: file evidence updated`);
      if (old.transmittalItems.length !== revision.transmittalItems.length) changes.push(`Revision ${revision.value}: distribution evidence updated`);
    }
  }
  if (previous.document.baselineEntries.length !== current.document.baselineEntries.length) changes.push("Schedule requirements updated");
  if (previous.relationships.length !== current.relationships.length) changes.push("Relationships updated");
  return changes.length ? [...new Set(changes)].slice(0, 5) : ["Control evidence recorded; no material field difference"];
}
