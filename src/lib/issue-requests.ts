import type { SessionUser } from "./auth";
import type { Tenant } from "./tenant";
import { api, projectPath } from "./api/client";
import { holders as holdersOfVerb } from "./api/settings";
import { revisionStanding } from "./api/legacy";
import type { Distribution, IssueRequestView } from "./api/types";
import { holdersOf } from "./permissions";

/**
 * Asking for a revision to be sent somewhere.
 *
 * Releasing a revision and telling people about it are two different acts.
 * Releasing says the revision is the one in use; issuing says somebody has been
 * told. The second is asked for, by anybody with standing on the document —
 * whoever wrote it, whoever uploaded it, whoever started its review, whoever
 * decided it — at any time, as often as the work needs. "Issue it to the site
 * team now" and "ask the client to approve it next week" are two requests, not
 * one form filled in twice.
 *
 * Document Control carries a request out. Releasing is its own act and needs
 * nobody's request; issuing needs one, always. Where a project runs without a
 * control function, whoever asked carries it out themselves. Until somebody
 * asks, a released revision is simply not issued, and the record says so.
 */

export type RequestRecipients = {
  /** Our own people. The distribution matrix proposes them; the asker adjusts. */
  internalUserIds: string[];
  /** Organizations on this project. */
  partyIds: string[];
};

export const NO_RECIPIENTS: RequestRecipients = { internalUserIds: [], partyIds: [] };

export function parseRecipients(json: string | null | undefined): RequestRecipients {
  if (!json) return NO_RECIPIENTS;
  try {
    const raw = JSON.parse(json) as Partial<RequestRecipients> & { approvalUserIds?: string[] };
    return {
      // A request written before requests carried their reason kept the people
      // it was to be approved by in a list of their own; they are recipients
      // like any other, and the reason says what is wanted of them.
      internalUserIds: [
        ...(Array.isArray(raw.internalUserIds) ? raw.internalUserIds.map(String) : []),
        ...(Array.isArray(raw.approvalUserIds) ? raw.approvalUserIds.map(String) : []),
      ],
      partyIds: Array.isArray(raw.partyIds) ? raw.partyIds.map(String) : [],
    };
  } catch {
    return NO_RECIPIENTS;
  }
}

export function recipientsFromForm(formData: FormData): RequestRecipients {
  const many = (key: string) => formData.getAll(key).map(String).filter(Boolean);
  return { internalUserIds: many("internalUserIds"), partyIds: many("partyIds") };
}

/**
 * What a form says about a request, in the shape the engine stores. On the
 * deciding step the answer is one of two: who receives it, or leave it to
 * the author.
 */
export function requestFromForm(formData: FormData) {
  const needsApproval = formData.get("needsApproval") === "on";
  return {
    // Every decision that lets a revision out says who receives it, or leaves
    // that to its author; "nobody for now" is not an answer.
    give: true,
    reason: String(formData.get("issueReason") ?? "INFORMATION"),
    recipients: recipientsFromForm(formData),
    delegated: formData.get("delegateNextStep") === "on",
    note: String(formData.get("issueNote") ?? "").trim() || null,
    // An outside party may have to approve the revision before it is released
    // at all. Then the release waits for them, and their answer decides it.
    needsApproval,
    approverId: needsApproval ? String(formData.get("approverId") ?? "") || null : null,
  };
}

export function noRecipients(one: RequestRecipients): boolean {
  return !one.internalUserIds.length && !one.partyIds.length;
}

/**
 * Who may ask for a revision to be sent: the people with standing on it. Not a
 * permission in the matrix — the matrix says who may see and approve documents
 * of a class; this says who is close enough to this one to know who needs it.
 */
export async function mayRequestIssue(t: Tenant, revisionId: string, _userId: string): Promise<boolean> {
  // The backend decides standing: the revision is settled, its decision lets it
  // out, no route is running, and the caller wrote it, sat on its route, or sends.
  return (await revisionStanding(t, revisionId)).mayRequest;
}

/**
 * Whether the decision on this revision lets it out at all. A verdict that asks
 * for changes decides the revision as much as one that accepts it, but what it
 * decides is that nothing goes anywhere.
 */
export async function decisionLetsItOut(t: Tenant, revisionId: string): Promise<boolean> {
  return (await revisionStanding(t, revisionId)).letsItOut;
}

/** Whoever wrote the revision, for the sentence that offers to leave it to them. */
export async function authorOf(t: Tenant, revisionId: string): Promise<string | null> {
  return (await revisionStanding(t, revisionId)).author;
}

/**
 * Whether this project has a control function.
 *
 * Not a setting about workflow: a fact about the project. An organization that
 * puts somebody between the work and the record gives that function to
 * somebody, and then it receives, releases and sends. One that does not — a
 * small team, a consultancy of four, a project where the people doing the work
 * keep their own record — gives it to nobody, and those acts belong to the
 * people doing the work: the decision releases, and whoever asked for a
 * revision to go out sends it themselves.
 *
 * Nothing here is configured twice. Who holds which function is the matrix's
 * business, and this reads it.
 */
export async function hasControlFunction(t: Tenant): Promise<boolean> {
  return (await holdersOfVerb(t.projectId, "CONTROL")).length > 0;
}

/** @deprecated Read `hasControlFunction`; kept while callers are moved over. */
export async function issuePolicy(t: Tenant): Promise<{ controlReleases: boolean; asked: boolean }> {
  const control = await hasControlFunction(t);
  // Who receives it is asked only where releasing sends it; where releasing
  // means go ahead, nobody is asked.
  const { policy } = await import("./control-activities");
  const asked = (await policy(t, "POLICY_RELEASE")) !== "SEPARATE";
  return { controlReleases: control, asked };
}

export async function issueGateIsControl(t: Tenant): Promise<boolean> {
  return hasControlFunction(t);
}

/**
 * The lists an asker chooses from: our people the matrix puts on the
 * distribution for this document, everyone else on the project, and the
 * organizations on it.
 */
export async function requestChoices(
  t: Tenant,
  doc: { id?: string; deliverableType: string; docType: string; discipline: string; criticality: string | null; confidentiality: string | null; originator?: string | null },
) {
  // Who the matrix proposes, everyone else on the project, and the organizations on it: the backend's distribution.
  const found = await api<Distribution>(projectPath(t, `/documents/${doc.id}/distribution`));
  return {
    proposed: found.proposed.map((one) => ({ id: one.id, name: one.name, organization: one.function, basis: one.function })),
    others: found.others.map((person) => ({ id: person.id, name: person.name, organization: person.organization ?? "Unassigned organization" })),
    parties: found.parties.map((party) => ({ id: party.id, name: party.name })),
    // Only a document we produced waits on somebody outside approving it.
    ours: !doc.originator,
  };
}

/**
 * Is this revision ready to be released — that is, does somebody's answer exist
 * about where it goes, and is nothing outside still to answer?
 *
 * Three ways it is not ready: nobody has said at all; the choice was handed to
 * the initiator and they have not made it; an outside party has to approve it
 * and their answer is not back. The words are the ones the reader has to act
 * on, because this refusal is what they will see.
 */
export async function pendingIssue(
  _t: Tenant,
  _revisionId: string,
  _options: { recipients?: boolean } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  // The backend refuses a release that is not ready, with its reason; there is no hold awaiting an outside approval.
  return { ok: true };
}

/**
 * Who a revision goes back to when it is sent back: the organization that
 * supplied it, where it came from outside (its people here, or our liaison for
 * them), and otherwise whoever started its route — the author where no route
 * ran.
 */
export async function returnRecipients(t: Tenant, revisionId: string): Promise<{ ids: string[]; names: string }> {
  // It goes back to whoever wrote it; another organization's people get it through their own transmittal.
  const standing = await revisionStanding(t, revisionId);
  return { ids: standing.authorId ? [standing.authorId] : [], names: standing.author ?? "its author" };
}

/** The requests on a revision, as the screens read them: who asked, for what, to whom, and the transmittal it went in. */
export async function requestsOn(t: Tenant, revisionId: string) {
  const rows = await api<IssueRequestView[]>(projectPath(t, `/revisions/${revisionId}/issue-requests`));
  return rows.filter((one) => one.status !== "CANCELLED").map((one) => ({
    id: one.id, revisionId: one.revisionId, reason: one.reason, status: one.status, note: one.note,
    recipients: JSON.stringify({ internalUserIds: one.userIds, partyIds: one.partyIds }),
    raisedById: one.raisedById, raisedByName: one.raisedBy, raisedAt: new Date(one.raisedAt),
    carriedOutAt: one.status === "DONE" && one.closedAt ? new Date(one.closedAt) : null, carriedOutBy: one.status === "DONE" ? one.closedBy : null,
    // Leaving it to the author, and an outside approval before release, are not kept by the backend.
    delegated: false, needsApproval: false, approverId: null as string | null,
    transmittal: one.transmittalIds[0] ? { id: one.transmittalIds[0], number: one.transmittals[0] ?? "" } : null,
  }));
}

/** Ask for a revision to be sent. The backend checks standing; where nobody sends for the project, the asker's request goes at once. */
export async function raiseRequest(t: Tenant, revisionId: string, asked: ReturnType<typeof requestFromForm>) {
  return api<{ request: IssueRequestView; transmittals: string[] }>(projectPath(t, `/revisions/${revisionId}/issue-requests`), {
    body: { reason: asked.reason, userIds: asked.recipients.internalUserIds, partyIds: asked.recipients.partyIds, note: asked.note },
  });
}

/** Carry one request out: the backend raises its transmittals. */
export async function carryOutRequest(t: Tenant, requestId: string) {
  return api<{ request: IssueRequestView; transmittals: string[] }>(projectPath(t, `/issue-requests/${requestId}/carry-out`), { method: "POST" });
}

/** Withdraw a request. */
export async function cancelRequest(t: Tenant, requestId: string) {
  return api<IssueRequestView>(projectPath(t, `/issue-requests/${requestId}/cancel`), { method: "POST" });
}
