import type { Tenant } from "./tenant";
import type { SessionUser } from "./auth";
import { api, projectPath } from "./api/client";

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

/** A date as the day the backend takes. */
function day(at: Date | null | undefined): string | null {
  return at ? at.toISOString().slice(0, 10) : null;
}

/**
 * Put a document in the register. The backend allocates its number, creates
 * the entry as a placeholder and records that it happened; asset links, the
 * organization's own fields and a back-dated registration are not kept there.
 */
export async function registerDocument(t: Tenant, _user: SessionUser, input: RegisterInput): Promise<Registered> {
  const doc = await api<{ id: string; number: string }>(projectPath(t, "/documents"), {
    body: {
      title: input.title,
      deliverableType: input.deliverableType,
      docType: input.docType,
      discipline: input.discipline,
      originator: input.originator ?? null,
      subproject: input.subProject ?? null,
      contractRef: input.contractRef ?? null,
      criticality: input.criticality ?? null,
      confidentiality: input.confidentiality ?? null,
      retentionClass: input.retentionClass ?? null,
      receivedDate: day(input.receivedDate),
      plannedDate: day(input.plannedDate),
      kind: input.kind ?? "DOCUMENT",
    },
  });
  return { id: doc.id, docNumber: doc.number };
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
 * finding in its own right, so the backend authorises and logs it. It also
 * decides what the revision is called; files follow later.
 */
export async function startRevision(t: Tenant, _user: SessionUser, documentId: string, input: RevisionInput) {
  return api<{ id: string; value: string; state: string }>(projectPath(t, `/documents/${documentId}/revisions`), {
    body: { fileIds: [], reasonForRevision: input.reasonForRevision ?? input.authorizationReason ?? null, filesLater: true },
  });
}
