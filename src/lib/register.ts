import type { Tenant } from "./tenant";
import type { SessionUser } from "./auth";
import { audit } from "./audit";
import { allocateNumber } from "./numbering";
import { retentionFor } from "./retention";

/**
 * Registering a document — the act itself, once.
 *
 * It lived inside the server action, which needs a request, a form and a cache
 * to revalidate. So the bulk importer wrote its own copy and the demo seeds
 * wrote a third, and the three disagreed about what gets recorded: the seeded
 * documents carry no allocated number and no audit entry, which is why the
 * assurance checks flag them. Everything that registers a document now comes
 * through here, including the seeds, so demo data is made the way real data is.
 *
 * What it does not do is read a form, talk to the cache, or decide whether the
 * person is allowed — those belong to the caller.
 */

export type RegisterInput = {
  title: string;
  deliverableType: string;
  docType: string;
  discipline: string;
  projectCode?: string | null;
  originator?: string | null;
  subProject?: string | null;
  contractRef?: string | null;
  criticality?: string | null;
  confidentiality?: string | null;
  retentionClass?: string | null;
  receivedDate?: Date | null;
  plannedDate?: Date | null;
  assetCode?: string | null;
  kind?: "DOCUMENT" | "RECORD";
  /** Answers to the fields this organization added for itself. */
  extras?: Record<string, string>;
  /** Where it came from, for the audit entry. */
  how?: string;
  /** When it was registered, where that is not now — a demo with a history. */
  at?: Date;
};

export type Registered = { id: string; docNumber: string };

/** The fields a numbering scheme draws on, from what was asked for. */
function schemeFields(input: RegisterInput): Record<string, string> {
  return {
    "Project code": input.projectCode ?? "",
    Subproject: input.subProject ?? "",
    "Supplier code": input.originator ?? "",
    "Purchase order": input.contractRef ?? "",
    Discipline: input.discipline,
    "Document type": input.docType,
  };
}

/**
 * Put a document in the register: allocate its number, create the entry as a
 * placeholder, and record that it happened.
 */
export async function registerDocument(t: Tenant, user: SessionUser, input: RegisterInput): Promise<Registered> {
  const kind = input.kind ?? "DOCUMENT";
  const { docNumber } = await allocateNumber(t, input.deliverableType, schemeFields(input));
  const retentionClass = input.retentionClass ?? (await retentionFor(t, input.criticality ?? null));

  const doc = await t.db.document.create({
    data: {
      projectId: t.projectId,
      docNumber,
      title: input.title,
      deliverableType: input.deliverableType,
      docType: input.docType,
      discipline: input.discipline,
      originator: input.originator ?? null,
      subProject: input.subProject ?? null,
      contractRef: input.contractRef ?? null,
      criticality: input.criticality ?? null,
      confidentiality: input.confidentiality ?? "INTERNAL",
      retentionClass,
      state: "PLANNED",
      kind,
      isPlaceholder: true,
      createdById: user.id,
      createdByName: user.name,
      receivedDate: input.receivedDate ?? null,
      extras: input.extras && Object.keys(input.extras).length ? JSON.stringify(input.extras) : null,
      plannedDate: input.plannedDate ?? null,
      latestPlannedAt: input.plannedDate ?? null,
      ...(input.at ? { createdAt: input.at, createdDate: input.at } : {}),
    },
  });

  // An asset the document describes, where one was named and exists.
  if (input.assetCode) {
    const asset = await t.db.assetItem.findFirst({ where: { code: input.assetCode } });
    if (asset) {
      await t.db.relationship.create({
        data: { projectId: t.projectId, kind: "DOC_ASSET", fromType: "Document", fromId: doc.id, toType: "AssetItem", toId: asset.id, createdById: user.id },
      });
    }
  }

  await audit({
    tenant: t,
    actor: user,
    action: "REGISTER_ENTRY",
    entityType: "Document",
    entityId: doc.id,
    entityLabel: docNumber,
    detail: `${kind === "RECORD" ? "Record — fixed evidence, never revised" : "Document, placeholder"}; state Planned. Number ${docNumber} allocated by the system.${input.how ? ` ${input.how}` : ""}`,
  });

  return { id: doc.id, docNumber };
}

export type RevisionInput = {
  /** What the revision is called. The caller decides the sequence. */
  value: string;
  statusCode?: string | null;
  phase?: string | null;
  reasonForRevision?: string | null;
  plannedSubmissionDate?: Date | null;
  /** Who authorised a revision nobody's verdict asked for. */
  authorizedByName?: string | null;
  authorizationReason?: string | null;
  /** When it was started, where that is not now. */
  at?: Date;
};

/**
 * Start a revision, and say so.
 *
 * A revision that nothing authorised and whose start was never logged is a
 * finding in its own right — two of the checks look for exactly that — so the
 * authorization and the state transition are written here rather than left to
 * whoever is calling.
 */
export async function startRevision(t: Tenant, user: SessionUser, documentId: string, input: RevisionInput) {
  const document = await t.db.document.findUniqueOrThrow({ where: { id: documentId } });
  const revision = await t.db.revision.create({
    data: {
      projectId: t.projectId,
      documentId,
      value: input.value,
      state: "IN_PREPARATION",
      statusCode: input.statusCode ?? null,
      phase: input.phase ?? null,
      reasonForRevision: input.reasonForRevision ?? null,
      plannedSubmissionDate: input.plannedSubmissionDate ?? null,
      authorizedById: user.id,
      authorizedByName: input.authorizedByName ?? user.name,
      authorizationReason: input.authorizationReason ?? input.reasonForRevision ?? "Started by the author.",
      authorizedAt: input.at ?? new Date(),
      ...(input.at ? { createdAt: input.at } : {}),
    },
  });

  // The register's copy of what is in hand, so it does not wait for a restate.
  await t.db.document.update({
    where: { id: documentId },
    data: {
      state: document.state === "PLANNED" ? "ACTIVE" : document.state,
      isPlaceholder: false,
      latestRevisionId: revision.id,
      latestRevValue: revision.value,
      latestRevState: revision.state,
      latestStatusCode: revision.statusCode,
      latestPhase: revision.phase,
      latestRevAt: revision.createdAt,
    },
  });

  await audit({
    tenant: t,
    actor: user,
    action: "STATE_TRANSITION",
    entityType: "Revision",
    entityId: revision.id,
    entityLabel: `${document.docNumber} rev ${revision.value}`,
    oldValue: null,
    newValue: "IN_PREPARATION",
    detail: `Revision ${revision.value} started. ${input.reasonForRevision ?? "Started by the author."}`,
  });

  return revision;
}
