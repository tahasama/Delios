import type { SessionUser } from "./auth";
import type { Tenant } from "./tenant";
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
 * deciding step the box is ticked by default: the moment of deciding is the
 * moment somebody knows who needs it. Unticking it is a deliberate "not now".
 */
export function requestFromForm(formData: FormData) {
  const needsApproval = formData.get("needsApproval") === "on";
  return {
    give: formData.get("askNow") !== "off",
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
export async function mayRequestIssue(t: Tenant, revisionId: string, userId: string): Promise<boolean> {
  const { db } = t;
  const rev = await db.revision.findUnique({
    where: { id: revisionId },
    select: { state: true, authoredById: true, uploadedById: true, document: { select: { createdById: true } } },
  });
  if (!rev) return false;
  // A revision that is not going anywhere has nobody to send it to: one sent
  // back, one voided, and one whose decision asked for changes rather than
  // letting it out.
  if (rev.state === "RETURNED" || rev.state === "VOID" || rev.state === "SUPERSEDED") return false;
  if (!(await decisionLetsItOut(t, revisionId))) return false;
  // While a route is still running, the only person who may attach a request is
  // the one deciding, and they do it with their verdict. Everybody else waits
  // for the route to finish — including the Document Control step, where the
  // route draws one — because until then nobody knows what it is being issued
  // as.
  const running = await db.workflowRun.findFirst({ where: { revisionId, status: "ACTIVE" }, select: { id: true } });
  if (running) return false;
  if (rev.authoredById === userId || rev.uploadedById === userId || rev.document.createdById === userId) return true;
  // Whoever started the review, and anybody who sat on one of its steps.
  const onTheRoute = await db.reviewCycle.findFirst({
    where: { revisionId, OR: [{ openedById: userId }, { assignments: { some: { userId } } }] },
    select: { id: true },
  });
  if (onTheRoute) return true;
  const started = await db.workflowRun.findFirst({ where: { revisionId, startedById: userId }, select: { id: true } });
  return !!started;
}

/**
 * Whether the decision on this revision lets it out at all. A verdict that asks
 * for changes decides the revision as much as one that accepts it, but what it
 * decides is that nothing goes anywhere.
 */
export async function decisionLetsItOut(t: Tenant, revisionId: string): Promise<boolean> {
  const decided = await t.db.reviewCycle.findFirst({
    where: { revisionId, binding: true, outcome: { not: null } },
    orderBy: { sequence: "desc" },
    select: { outcome: true, outcomeSetKey: true },
  });
  if (!decided?.outcome) return true;
  const value = await t.db.configValue.findFirst({ where: { setKey: decided.outcomeSetKey ?? "REVIEW_OUTCOMES", code: decided.outcome, status: "ACTIVE" } });
  if (!value) return true;
  try {
    return (JSON.parse(value.props ?? "{}") as { proceed?: boolean }).proceed === true;
  } catch {
    return true;
  }
}

/** Whoever wrote the revision, for the sentence that offers to leave it to them. */
export async function authorOf(t: Tenant, revisionId: string): Promise<string | null> {
  const rev = await t.db.revision.findUnique({
    where: { id: revisionId },
    select: { authoredByName: true, document: { select: { createdByName: true } } },
  });
  return rev?.authoredByName ?? rev?.document.createdByName ?? null;
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
  const { holdersOf } = await import("./permissions");
  return (await holdersOf(t, "CONTROL")).length > 0;
}

/** @deprecated Read `hasControlFunction`; kept while callers are moved over. */
export async function issuePolicy(t: Tenant): Promise<{ controlReleases: boolean; asked: boolean }> {
  const control = await hasControlFunction(t);
  return { controlReleases: control, asked: true };
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
  doc: { deliverableType: string; docType: string; discipline: string; criticality: string | null; confidentiality: string | null },
) {
  const { recipientsFor } = await import("./distribution");
  const onTheMatrix = await recipientsFor(t, doc);
  const proposedIds = new Set(onTheMatrix.map((one) => one.userId));
  const everyone = await t.db.user.findMany({
    where: { active: true, memberships: { some: { projectId: t.projectId, active: true } } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, organization: true, party: { select: { name: true, isInternal: true } } },
  });
  const named = (person: (typeof everyone)[number]) => person.party?.name ?? person.organization ?? "Unassigned organization";
  return {
    proposed: onTheMatrix.map((one) => ({ id: one.userId, name: one.name, organization: one.functionName, basis: one.basis })),
    others: everyone.filter((person) => !proposedIds.has(person.id)).map((person) => ({ id: person.id, name: person.name, organization: named(person) })),
    parties: await t.db.party.findMany({ where: { isInternal: false, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  };
}

/**
 * Carry out one request: raise its transmittals and mark it done.
 *
 * One transmittal per destination, because that is what a recipient receives
 * and acknowledges: our own people in one, each outside organization in its own.
 */
export async function carryOutRequest(
  t: Tenant,
  requestId: string,
  actor: { id: string; name: string },
): Promise<{ numbers: string[]; error?: string }> {
  const { db, projectId } = t;
  const request = await db.issueRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { revision: { include: { document: true } } },
  });
  if (request.status !== "OPEN") return { numbers: [], error: "That request has already been dealt with." };
  if (request.revision.state !== "RELEASED") return { numbers: [], error: "Only a released revision can be issued." };
  if (request.needsApproval) return { numbers: [], error: "It waits for the outside approval first." };
  if (request.revision.heldAt) return { numbers: [], error: "It is on hold, not for use." };
  const to = parseRecipients(request.recipients);
  if (request.delegated || noRecipients(to)) return { numbers: [], error: "That request names nobody to send it to." };

  const { nextRecordNumber } = await import("./numbering-records");
  const { audit, notifyMany } = await import("./audit");
  const [internal, project] = await Promise.all([
    db.party.findFirst({ where: { isInternal: true }, select: { code: true, name: true } }),
    db.project.findUnique({ where: { id: projectId }, select: { code: true } }),
  ]);
  const rev = request.revision;
  const label = `${rev.document.docNumber} rev ${rev.value}`;
  const numbers: string[] = [];
  let firstId: string | null = null;

  const raise = async (receiverCode: string | null, people: { name: string; organization: string | null; userId?: string }[]) => {
    if (!people.length) return;
    const number = await nextRecordNumber(
      t,
      "TRANSMITTAL",
      { project: project?.code ?? "", sender: internal?.code ?? null, receiver: receiverCode, reason: request.reason },
      "TR",
    );
    const raised = await db.transmittal.create({
      data: {
        projectId,
        number,
        direction: "OUTGOING",
        reasonForIssue: request.reason,
        dateOfIssue: new Date(),
        issuingParty: internal?.name ?? "Our organization",
        subject: `${label} — ${rev.statusCode ?? "issued"}`,
        message: request.note,
        status: "ISSUED",
        createdById: actor.id,
        createdByName: actor.name,
        items: { create: [{ projectId, revisionId: rev.id }] },
        recipients: { create: people.map((one) => ({ projectId, name: one.name, organization: one.organization, userId: one.userId })) },
      },
    });
    numbers.push(number);
    firstId = firstId ?? raised.id;
    await notifyMany(
      people.map((one) => one.userId).filter((id): id is string => !!id),
      "TRANSMITTAL_RECEIVED",
      `${label} — ${number}`,
      `Issued to you: ${request.reason.toLowerCase()}.`,
      `/documents/${rev.documentId}`,
      t,
    );
  };

  const people = await db.user.findMany({
    where: { id: { in: to.internalUserIds } },
    select: { id: true, name: true, organization: true, party: { select: { name: true } } },
  });
  await raise(
    internal?.code ?? null,
    people.map((one) => ({ name: one.name, organization: one.party?.name ?? one.organization ?? null, userId: one.id })),
  );

  for (const partyId of to.partyIds) {
    const party = await db.party.findUnique({
      where: { id: partyId },
      select: { code: true, name: true, users: { where: { active: true }, select: { id: true, name: true } } },
    });
    if (!party) continue;
    await raise(
      party.code,
      party.users.length
        ? party.users.map((one) => ({ name: one.name, organization: party.name, userId: one.id }))
        : [{ name: party.name, organization: party.name }],
    );
  }

  await db.issueRequest.update({
    where: { id: requestId },
    data: { status: "DONE", carriedOutAt: new Date(), carriedOutBy: actor.name, transmittalId: firstId },
  });
  await audit({
    tenant: t,
    actor: actor as never,
    action: "ISSUED",
    entityType: "Revision",
    entityId: rev.id,
    entityLabel: label,
    newValue: numbers.join(", "),
    detail: `Issued as ${request.raisedByName} asked: ${numbers.length} transmittal${numbers.length === 1 ? "" : "s"}, ${request.reason.toLowerCase()}.`,
  });
  return { numbers };
}

/** Every open request on a revision, carried out in the order they were asked. */
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
  t: Tenant,
  revisionId: string,
  /**
   * `recipients` false where the project releases without issuing: then nobody
   * need have said where it goes, and only an outside approval holds it.
   */
  { recipients = true }: { recipients?: boolean } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const requests = await t.db.issueRequest.findMany({
    where: { revisionId, status: "OPEN" },
    include: { approver: { select: { name: true } } },
  });
  const waitingOnOutside = requests.find((one) => one.needsApproval);
  if (waitingOnOutside) {
    const answered = await t.db.reviewCycle.findFirst({ where: { issueRequestId: waitingOnOutside.id, status: "CLOSED" }, orderBy: { outcomeAt: "desc" } });
    return {
      ok: false,
      error: answered
        ? `Release blocked: ${waitingOnOutside.approver?.name ?? "the outside party"} did not approve this revision. Send it back.`
        : `Release blocked: ${waitingOnOutside.approver?.name ?? "an outside party"} has to approve this revision first. Document Control releases and issues it when their answer comes back.`,
    };
  }
  if (!recipients) return { ok: true };
  if (!requests.length) {
    return {
      ok: false,
      error: "Release blocked: nobody has said who this revision goes to. Releasing it is sending it, so say who receives it — our own people, an outside party, or both.",
    };
  }
  const named = requests.find((one) => !one.delegated && !noRecipients(parseRecipients(one.recipients)));
  if (!named) {
    return {
      ok: false,
      error: "Release blocked: the choice of who receives this revision was left to whoever started the route, and they have not made it yet.",
    };
  }
  return { ok: true };
}

/**
 * Open the step that carries an outside approval, where a request asks for one.
 *
 * It is an ordinary step of the record — a party, a date, a verdict — so it is
 * dispatched, chased and answered like any other, and the revision stays not
 * released while it is open.
 */
export async function openApprovalStep(
  t: Tenant,
  revisionId: string,
  user: { id: string; name: string },
): Promise<{ opened: boolean; party?: string }> {
  const request = await t.db.issueRequest.findFirst({
    where: { revisionId, status: "OPEN", needsApproval: true },
    include: { approver: { select: { id: true, name: true } } },
    orderBy: { raisedAt: "asc" },
  });
  if (!request?.approver) return { opened: false };
  const already = await t.db.reviewCycle.findFirst({ where: { issueRequestId: request.id, status: "OPEN" } });
  if (already) return { opened: true, party: request.approver.name };

  const { reviewNumber } = await import("./workflow");
  const sequence = (await t.db.reviewCycle.count({ where: { revisionId } })) + 1;
  await t.db.reviewCycle.create({
    data: {
      projectId: t.projectId,
      number: await reviewNumber(t),
      revisionId,
      issueRequestId: request.id,
      partyId: request.approver.id,
      mode: "PARALLEL",
      sequence,
      // Their answer is what releases the revision, so the step binds.
      binding: true,
      openedById: user.id,
      openedByName: user.name,
      submittedAt: new Date(),
      receivedAt: new Date(),
      status: "OPEN",
    },
  });
  return { opened: true, party: request.approver.name };
}

/**
 * The outside party has answered. Like every decided revision, it goes to
 * Document Control: an approval lets them release and issue it — or lift the
 * hold on one already released — and a refusal leaves release blocked until
 * they send it back, with a reason, to whoever it goes back to.
 */
export async function settleApproval(
  t: Tenant,
  cycleId: string,
  /** Whoever wrote the answer down: the act is theirs, the verdict is the party's. */
  user: SessionUser,
  accepted: boolean,
): Promise<{ released: boolean }> {
  const cycle = await t.db.reviewCycle.findUnique({
    where: { id: cycleId },
    include: { revision: { include: { document: true } }, issueRequest: { include: { approver: { select: { name: true } } } } },
  });
  if (!cycle?.issueRequest) return { released: false };
  const { audit, notifyMany } = await import("./audit");
  const party = cycle.issueRequest.approver?.name ?? "The outside party";
  const label = `${cycle.revision.document.docNumber} rev ${cycle.revision.value}`;
  // Approved: the request is an ordinary one again. Refused: it stays waiting,
  // which is what keeps release blocked until Document Control sends it back.
  if (accepted) await t.db.issueRequest.update({ where: { id: cycle.issueRequest.id }, data: { needsApproval: false } });
  const held = !!cycle.revision.heldAt;
  const next = accepted ? (held ? "lift the hold" : "release and issue it") : "send it back";
  await audit({
    tenant: t, actor: user, action: accepted ? "OUTSIDE_APPROVED" : "OUTSIDE_REFUSED", entityType: "Revision", entityId: cycle.revisionId,
    entityLabel: label, detail: `${party} ${accepted ? "approved it" : "did not approve it"} — with Document Control to ${next}.`,
  });
  const control = await holdersOf(t, "CONTROL");
  await notifyMany(control.map((one) => one.id), accepted ? "OUTSIDE_APPROVED" : "OUTSIDE_REFUSED",
    `${party} ${accepted ? "approved" : "did not approve"} ${label}`, `Yours to ${next}.`, `/documents/${cycle.revision.documentId}`, t);
  return { released: false };
}

export async function carryOutOpenRequests(t: Tenant, revisionId: string, user: { id: string; name: string }): Promise<number> {
  const open = await t.db.issueRequest.findMany({ where: { revisionId, status: "OPEN", delegated: false }, orderBy: { raisedAt: "asc" }, select: { id: true } });
  let raised = 0;
  for (const one of open) raised += (await carryOutRequest(t, one.id, user)).numbers.length;
  return raised;
}

/**
 * Who a revision goes back to when it is sent back: the organization that
 * supplied it, where it came from outside (its people here, or our liaison for
 * them), and otherwise whoever started its route — the author where no route
 * ran.
 */
export async function returnRecipients(t: Tenant, revisionId: string): Promise<{ ids: string[]; names: string }> {
  const rev = await t.db.revision.findUniqueOrThrow({ where: { id: revisionId }, include: { document: true } });
  const supplier = rev.document.originator
    ? await t.db.party.findFirst({ where: { code: rev.document.originator, isInternal: false } })
    : null;
  let ids: string[] = [];
  if (supplier) {
    const { partyStepHolders } = await import("./workflow");
    ids = (await partyStepHolders(t, supplier.id)).ids;
  }
  if (!ids.length) {
    const run = await t.db.workflowRun.findFirst({ where: { revisionId }, orderBy: { createdAt: "desc" }, select: { startedById: true } });
    ids = [run?.startedById ?? rev.document.createdById];
  }
  const people = await t.db.user.findMany({ where: { id: { in: ids } }, select: { name: true } });
  return { ids, names: supplier ? `${supplier.name} (${people.map((one) => one.name).join(", ")})` : people.map((one) => one.name).join(", ") };
}

/**
 * Put a released revision on hold, not for use, while an outside approval it
 * turned out to need is awaited. Idempotent: holding what is already held
 * changes nothing.
 */
export async function holdRevision(t: Tenant, revisionId: string, user: SessionUser, partyName: string) {
  const rev = await t.db.revision.findUniqueOrThrow({ where: { id: revisionId }, include: { document: true } });
  if (rev.state !== "RELEASED" || rev.heldAt) return;
  const reason = `Awaiting approval by ${partyName}.`;
  const heldAt = new Date();
  await t.db.revision.update({ where: { id: revisionId }, data: { heldAt, heldReason: reason, heldByName: user.name } });
  const { policy } = await import("./control-activities");
  if ((await policy(t, "POLICY_PDF_STAMP")) === "ON") await stampHold(t, revisionId, user, heldAt);
  const { audit } = await import("./audit");
  await audit({
    tenant: t, actor: user, action: "REVISION_HELD", entityType: "Revision", entityId: revisionId,
    entityLabel: `${rev.document.docNumber} rev ${rev.value}`,
    detail: `On hold, not for use — ${reason}`,
  });
}

/**
 * The outside party approved a revision that was held for their answer:
 * Document Control lifts the hold, and whatever was asked for it is sent.
 */
export async function liftHold(t: Tenant, revisionId: string, user: SessionUser): Promise<{ sent: number }> {
  const rev = await t.db.revision.findUniqueOrThrow({ where: { id: revisionId }, include: { document: true } });
  if (!rev.heldAt) throw new Error("This revision is not on hold.");
  const pending = await pendingIssue(t, revisionId, { recipients: false });
  if (!pending.ok) throw new Error(pending.error.replace("Release blocked", "The hold stays"));
  // The viewable copy goes back to the one it had before the hold was stamped.
  const before = await t.db.storedFile.findFirst({
    where: { revisionId, kind: "RENDITION", createdAt: { lt: rev.heldAt } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  await t.db.revision.update({
    where: { id: revisionId },
    data: { heldAt: null, heldReason: null, heldByName: null, ...(before ? { renditionFileId: before.id } : {}) },
  });
  const { audit } = await import("./audit");
  await audit({
    tenant: t, actor: user, action: "REVISION_HOLD_LIFTED", entityType: "Revision", entityId: revisionId,
    entityLabel: `${rev.document.docNumber} rev ${rev.value}`,
    detail: "Approved outside — the hold is lifted and it is in use again.",
  });
  return { sent: await carryOutOpenRequests(t, revisionId, user) };
}

/**
 * The outside party refused a revision that was held for their answer. It
 * stays on hold, not for use, for good — people hold copies of it, and the
 * record says why they may not use them — and whoever it goes back to may
 * start the next revision.
 */
export async function returnHeld(t: Tenant, revisionId: string, user: SessionUser, reason: string, copyIds: string[]) {
  const rev = await t.db.revision.findUniqueOrThrow({ where: { id: revisionId }, include: { document: true } });
  if (!rev.heldAt) throw new Error("This revision is not on hold.");
  if (!reason.trim()) throw new Error("Say why it is going back — whoever gets it has to know what to do.");
  await t.db.revision.update({
    where: { id: revisionId },
    data: {
      heldReason: `Not approved outside — ${reason}`,
      authorizationReason: `Sent back by the control function: ${reason}`,
      authorizedById: user.id,
      authorizedByName: user.name,
      authorizedAt: new Date(),
    },
  });
  await t.db.issueRequest.updateMany({ where: { revisionId, status: "OPEN", needsApproval: true }, data: { status: "CANCELLED" } });
  await tellReturn(t, rev, reason, copyIds, user, "stays on hold, not for use");
}

/** Tell whoever a revision goes back to, and whoever Document Control copies in. */
export async function tellReturn(
  t: Tenant,
  rev: { id: string; value: string; documentId: string; document: { docNumber: string } },
  reason: string,
  copyIds: string[],
  user: SessionUser,
  what: string,
) {
  const to = await returnRecipients(t, rev.id);
  const copies = copyIds.filter((id) => !to.ids.includes(id));
  const copied = copies.length ? await t.db.user.findMany({ where: { id: { in: copies } }, select: { name: true } }) : [];
  const { audit, notifyMany } = await import("./audit");
  await audit({
    tenant: t, actor: user, action: "RELEASE_REFUSED", entityType: "Revision", entityId: rev.id,
    entityLabel: `${rev.document.docNumber} rev ${rev.value}`, newValue: to.names,
    detail: `${reason} — back to ${to.names}${copied.length ? `; copied in: ${copied.map((one) => one.name).join(", ")}` : ""}. It ${what}.`,
  });
  await notifyMany(to.ids, "RELEASE_REFUSED", `Sent back to you: ${rev.document.docNumber} rev ${rev.value}`, `${reason} — it ${what}.`, `/documents/${rev.documentId}`, t);
  await notifyMany(copies, "RELEASE_REFUSED", `Sent back: ${rev.document.docNumber} rev ${rev.value}`, `Back to ${to.names}. ${reason}`, `/documents/${rev.documentId}`, t);
}

/**
 * Stamp the viewable copy ON HOLD — NOT FOR USE, the way a superseded copy is
 * stamped: a new copy, kept beside the old one, which stays on record and comes
 * back when the hold is lifted. Best effort — the hold is the record's state
 * whether or not the PDF could be marked.
 */
async function stampHold(t: Tenant, revisionId: string, user: SessionUser, heldAt: Date) {
  try {
    const rev = await t.db.revision.findUniqueOrThrow({ where: { id: revisionId }, include: { document: true } });
    if (!rev.renditionFileId) return;
    const row = await t.db.storedFile.findUnique({ where: { id: rev.renditionFileId } });
    if (!row || row.mime !== "application/pdf") return;
    const { readStored, saveBuffer } = await import("./files");
    const { stampPdf } = await import("./stamp");
    const marked = await stampPdf(new Uint8Array(await readStored(row.path)), {
      docNumber: rev.document.docNumber, rev: rev.value, statusLabel: rev.statusCode ?? "On hold",
      date: heldAt, state: "HELD", title: rev.document.title,
    });
    const made = await saveBuffer(t, marked, rev.document.docNumber, "RENDITION", rev.value, user.name, user.id);
    await t.db.storedFile.update({ where: { id: made.id }, data: { revisionId, createdAt: new Date(heldAt.getTime() + 1) } });
    await t.db.revision.update({ where: { id: revisionId }, data: { renditionFileId: made.id } });
  } catch {
    // the hold stands without the stamp; the record says it is not for use
  }
}
