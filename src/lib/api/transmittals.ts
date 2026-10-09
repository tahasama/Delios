import "server-only";
import { cache } from "react";
import { api, ApiProblem, projectPath, type Query } from "./client";
import { backendDocument, documentContext } from "./legacy";
import { getMe } from "./me";
import { holders } from "./settings";
import type { Addressees, IssueRequestView, TransmittalItem, TransmittalLog, TransmittalView, Work } from "./types";

/**
 * Transmittals as the screens read them. The backend records a transmittal as
 * it went: numbered, with what it carried and who it reached, opened,
 * acknowledged or sent on by hand. The screens were written against the old
 * record, which also held drafts, copies, acceptance and threads; these build
 * that shape from the backend's, leaving empty what the backend does not keep.
 *
 * How the backend's records map:
 *   every transmittal              → issued (there are no drafts)
 *   incoming, a submission waiting for Document Control's check on arrival,
 *   or something unplanned not yet registered → issued, "to check"
 *   incoming, a submission returned on arrival → rejected
 *   incoming, everything checked and registered → accepted
 *   an unplanned item's files       → the files that came with it
 */

type Scope = { projectId: string };

const date = (iso: string | null | undefined) => (iso ? new Date(iso) : null);

/** One page of the transmittal log, filtered and sorted by the backend. */
export async function transmittalLog(scope: Scope, query: Query): Promise<TransmittalLog> {
  return api<TransmittalLog>(projectPath(scope, "/transmittals/log"), { query });
}

/** One transmittal, or null when it does not exist or is not the reader's to see. Reading it records a recipient's first opening. */
export const backendTransmittal = cache(async (scope: Scope, id: string): Promise<TransmittalView | null> => {
  try {
    return await api<TransmittalView>(projectPath(scope, `/transmittals/${id}`));
  } catch (e) {
    if (e instanceof ApiProblem && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
});

/** Who a transmittal can go to; empty for someone outside our organization, who may not ask. */
export const addressees = cache(async (scope: Scope): Promise<Addressees> =>
  api<Addressees>(projectPath(scope, "/addressees")).catch(() => ({ people: [], parties: [] })));

/** What waits on the signed-in person in this project. */
const work = cache(async (scope: Scope): Promise<Work> => api<Work>(projectPath(scope, "/work")));

/**
 * Our organization's name as the record carries it: what was sent to us reads
 * as sent to our own party, and without one, to the organization.
 */
export async function ourOrganizationName(): Promise<string> {
  const me = await getMe();
  return me?.user.party?.isInternal ? me.user.party.name : me?.tenant.name ?? "Our organization";
}

/** A file's kind, read from its name: the backend lists what an item carried without saying which is the rendition. */
const kindOf = (name: string) => (/\.pdf$/i.test(name) ? "RENDITION" : "NATIVE");


/** Where an incoming submission stands with Document Control: still to check, returned, or accepted. */
function arrivalOf(item: TransmittalItem, revision: { state: string; submission: number; returnedReason: string | null; submissions: { number: number; outcome: string | null; decidedBy: string | null; decidedAt: string | null }[] } | null) {
  if (!revision || item.kind !== "SUBMISSION") return null;
  const mine = revision.submissions.find((one) => one.number === item.submission) ?? null;
  const current = revision.submission === item.submission;
  if (current && revision.state === "RECEIVED") return { state: "TO_CHECK" as const, by: null, at: null, note: null };
  const returned = current ? revision.state === "CORRECTING" || revision.state === "RETURNED" : !!mine?.outcome && mine.outcome !== "ACCEPTED";
  return { state: returned ? ("RETURNED" as const) : ("ACCEPTED" as const), by: mine?.decidedBy ?? null, at: date(mine?.decidedAt), note: returned ? revision.returnedReason : null };
}

/** The transmittal as the old database held it, with its items' documents, recipients and the files that came with it. */
export const legacyTransmittal = cache(async (scope: Scope, id: string) => {
  const t = await backendTransmittal(scope, id);
  if (!t) return null;
  const incoming = t.direction === "INCOMING";
  const issuedAt = new Date(t.issuedAt);

  // The documents it carried, each read once: their revisions now, and the
  // reviews, transmittals and activities around them.
  const documentIds = [...new Set(t.items.map((one) => one.documentId).filter((one): one is string => !!one))];
  const docs = new Map(await Promise.all(documentIds.map(async (documentId) => {
    const [doc, context] = await Promise.all([backendDocument(scope, documentId), documentContext(scope, documentId).catch(() => null)]);
    return [documentId, { doc, context }] as const;
  })));

  // Only what is in the register is an item; something unplanned waits on the
  // transmittal, as files that came with it, until it is registered.
  const carried = t.items.filter((one) => one.documentId);
  const items = carried.map((item) => {
    const { doc, context } = docs.get(item.documentId!) ?? { doc: null, context: null };
    const revision = doc?.revisions.find((one) => one.id === item.revisionId) ?? null;
    const latest = doc?.revisions.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
    return {
      id: item.id,
      kind: item.kind,
      revisionId: item.revisionId ?? "",
      markedSuperseded: false,
      arrival: arrivalOf(item, revision),
      revision: {
        id: item.revisionId ?? "",
        documentId: item.documentId!,
        value: item.revision,
        // What was sent for, as the item recorded it; a placeholder is asked for, with no revision yet.
        statusCode: item.status,
        state: item.kind === "PLACEHOLDER" ? "REQUESTED" : revision?.state ?? "RELEASED",
        files: item.files.map((f) => ({ id: f.id, name: f.name, kind: kindOf(f.name), sha256: f.sha256 })),
        document: {
          docNumber: item.documentNumber,
          title: item.title,
          revisions: latest ? [{ value: latest.value }] : [],
          baselineEntries: (context?.activities ?? []).map((a) => ({ action: { code: a.code, name: a.name } })),
        },
      },
    };
  });

  // The reviews it opened: on what came in, those started since it arrived; on
  // what went to a party for its step, the review that step belongs to.
  const cycles = items.flatMap((item) => {
    const reviews = (docs.get(item.revision.documentId)?.context?.reviews ?? [])
      .filter((one) => one.revisionId === item.revisionId && (incoming ? new Date(one.startedAt) >= issuedAt : !!t.reviewStepId))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return reviews.slice(0, 1).map((one) => ({
      id: one.id, revisionId: one.revisionId, submittedAt: new Date(one.startedAt),
      status: one.state === "RELEASED" || one.state === "RETURNED" ? "CLOSED" : "OPEN",
    }));
  });

  // How often each document went out before this one did.
  const sentBefore = new Map<string, number>();
  for (const [documentId, { context }] of docs) {
    sentBefore.set(documentId, (context?.transmittals ?? [])
      .filter((one) => one.id !== t.id && one.direction === "OUTGOING" && new Date(one.issuedAt) < issuedAt).length);
  }

  // What came in unplanned: kept with it as it arrived.
  const files = t.items.filter((one) => one.kind === "UNPLANNED").flatMap((item) => item.files.map((f) => ({
    id: f.id, name: f.name, size: f.size, sha256: f.sha256, uploadedByName: t.issuedBy, createdAt: issuedAt,
  })));
  const unregistered = t.items.some((one) => one.kind === "UNPLANNED" && !one.registeredAt);
  const arrivals = items.map((one) => one.arrival).filter((one): one is NonNullable<typeof one> => !!one);
  const returned = arrivals.find((one) => one.state === "RETURNED") ?? null;
  const status = t.state === "DRAFT" ? "DRAFT" : !incoming ? "ISSUED"
    : unregistered || arrivals.some((one) => one.state === "TO_CHECK") ? "ISSUED"
      : returned ? "REJECTED" : "ACCEPTED";
  // Who checked it: whoever last accepted, returned or registered what came.
  const checks = [
    ...arrivals.filter((one) => one.at).map((one) => ({ by: one.by, at: one.at! })),
    ...t.items.filter((one) => one.registeredAt).map((one) => ({ by: one.registeredBy, at: new Date(one.registeredAt!) })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const checked = status === "ACCEPTED" || status === "REJECTED" ? checks[0] ?? null : null;

  const recipients = t.recipients.map((r) => ({
    id: r.id,
    kind: r.kind ?? "TO",
    name: r.name,
    organization: r.organization,
    userId: r.userId,
    partyId: r.partyId,
    openedAt: date(r.openedAt),
    lastViewedAt: date(r.lastViewedAt ?? r.acknowledgedAt ?? r.openedAt),
    // Opened before each opening was counted: once at least.
    viewCount: Math.max(r.viewCount ?? 0, r.openedAt ? 1 : 0),
    notifiedAt: date(r.notifiedAt) ?? (r.person ? issuedAt : null),
    dispatchedAt: date(r.dispatchedAt),
    dispatchChannel: r.dispatchChannel,
    dispatchRef: r.dispatchRef,
    dispatchedByName: r.dispatchedBy,
    proof: r.proofFileId ? { id: r.proofFileId, name: "proof of sending" } : null,
    party: r.person ? null : { id: r.partyId!, name: r.organization ?? r.name, evidenceRequired: false, externalSystem: null as string | null },
  }));

  // The request it carried out, and what the asker wrote.
  const firstRevision = items.find((one) => one.revisionId)?.revisionId;
  const requests = t.issueRequestId && firstRevision
    ? (await api<IssueRequestView[]>(projectPath(scope, `/revisions/${firstRevision}/issue-requests`)).catch(() => []))
        .filter((one) => one.id === t.issueRequestId).map((one) => ({ id: one.id, reason: one.reason, note: one.note }))
    : [];

  return {
    id: t.id,
    number: t.number,
    direction: t.direction,
    subject: t.subject as string | null,
    message: t.message,
    reasonForIssue: t.reason,
    status,
    dateOfIssue: issuedAt,
    createdAt: issuedAt,
    createdByName: t.issuedBy,
    issuingParty: incoming ? t.from ?? t.issuedBy : await ourOrganizationName(),
    receivedDate: incoming ? issuedAt : null,
    receivedByParty: incoming ? t.to : null,
    responseRequired: t.responseRequired,
    responseDueDate: date(t.responseDue),
    checkedByName: checked?.by ?? null,
    acceptanceCheckedAt: checked?.at ?? null,
    acceptanceNotes: t.receiptNote,
    rejectionReason: status === "REJECTED" ? returned?.note ?? null : null,
    conditionsResult: null as string | null,
    followKind: t.followKind,
    items,
    recipients,
    cycles,
    files,
    issueRequests: requests,
    sentBefore,
    // The exchange around it: what it answers and follows, and what answered and followed it.
    inReplyTo: t.inReplyTo ? { id: t.inReplyTo.id, number: t.inReplyTo.number, subject: t.inReplyTo.subject as string | null } : null,
    follows: t.follows ? { id: t.follows.id, number: t.follows.number, subject: t.follows.subject as string | null } : null,
    followedBy: (t.followedBy ?? []).map((one) => ({
      id: one.id, number: one.number, subject: one.subject as string | null, followKind: one.followKind, status: "ISSUED", dateOfIssue: new Date(one.issuedAt),
      _count: { items: one.items, recipients: one.recipients },
    })),
    answers: (t.answers ?? []).map((one) => ({
      id: one.id, number: one.number, subject: one.subject as string | null, dateOfIssue: new Date(one.issuedAt), status: "ISSUED",
      createdByName: one.issuedBy, issuingParty: one.from ?? one.issuedBy, direction: one.direction, _count: { items: one.items },
    })),
    backend: t,
  };
});

export type LegacyTransmittal = NonNullable<Awaited<ReturnType<typeof legacyTransmittal>>>;

/**
 * Who of ours carries each organization a transmittal went to by hand, and
 * whether that is the reader. The backend lists the reader's own sending as
 * work; who else carries it is not published, so the names are Document Control's.
 */
export async function carriersOf(scope: Scope, t: LegacyTransmittal): Promise<Map<string, { names: string; mine: boolean }>> {
  const outside = t.recipients.filter((one) => one.partyId && !one.userId);
  const result = new Map<string, { names: string; mine: boolean }>();
  if (!outside.length) return result;
  const [mine, control] = await Promise.all([
    work(scope).then((w) => new Set(w.issues.filter((one) => one.kind === "DISPATCH_TRANSMITTAL" && one.transmittalId === t.id).map((one) => one.recipientId)))
      .catch(() => new Set<string | null>()),
    holders(scope.projectId, "CONTROL").catch(() => []),
  ]);
  const names = control.filter((one) => one.internal).map((one) => one.name).join(", ") || "Document Control";
  for (const one of outside) {
    const before = result.get(one.partyId!);
    result.set(one.partyId!, { names, mine: (before?.mine ?? false) || mine.has(one.id) });
  }
  return result;
}

/** The transmittal a recipient row belongs to, when sending it on is the reader's to record. */
export async function dispatchOf(scope: Scope, recipientId: string): Promise<string | null> {
  const found = (await work(scope)).issues.find((one) => one.kind === "DISPATCH_TRANSMITTAL" && one.recipientId === recipientId);
  return found?.transmittalId ?? null;
}

/**
 * The unplanned item a file came on, for registering it. The backend keeps the
 * file on its item, so it is found among what still waits to be registered.
 */
export async function unplannedItemOfFile(scope: Scope, fileId: string): Promise<{ transmittal: TransmittalView; item: TransmittalItem } | null> {
  const waiting = await transmittalLog(scope, { status: "TO_REGISTER", per: 250 });
  for (const row of waiting.rows) {
    const t = await backendTransmittal(scope, row.id);
    const item = t?.items.find((one) => one.kind === "UNPLANNED" && !one.registeredAt && one.files.some((f) => f.id === fileId));
    if (t && item) return { transmittal: t, item };
  }
  return null;
}

/** What registering an unplanned item takes (RegisterDocumentRequest): what is left empty is taken from the item. */
export type RegisterItem = {
  title?: string | null; deliverableType?: string | null; docType?: string | null; discipline?: string | null; subproject?: string | null;
  contractRef?: string | null; criticality?: string | null; confidentiality?: string | null; retentionClass?: string | null;
  receivedDate?: string | null; plannedDate?: string | null; kind?: string | null;
};

/** Document Control puts an unplanned item in the register, under our numbering; throws the backend's refusal. */
export async function registerUnplannedItem(scope: Scope, transmittalId: string, itemId: string, body: RegisterItem): Promise<TransmittalView> {
  return api<TransmittalView>(projectPath(scope, `/transmittals/${transmittalId}/items/${itemId}/register`), { body });
}

/** The drafts the reader may see, newest first: written, not sent, no number yet. */
export async function transmittalDrafts(scope: Scope) {
  return api<{ id: string; subject: string; createdAt: string; createdBy: string; reason: string | null; documents: number; people: number; parties: number; copies: number }[]>(
    projectPath(scope, "/transmittals/drafts")).catch(() => []);
}
