import type { Tenant } from "./tenant";

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
  return {
    give: formData.get("askNow") !== "off",
    reason: String(formData.get("issueReason") ?? "INFORMATION"),
    recipients: recipientsFromForm(formData),
    delegated: formData.get("delegateNextStep") === "on",
    note: String(formData.get("issueNote") ?? "").trim() || null,
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
export async function carryOutOpenRequests(t: Tenant, revisionId: string, user: { id: string; name: string }): Promise<number> {
  const open = await t.db.issueRequest.findMany({ where: { revisionId, status: "OPEN", delegated: false }, orderBy: { raisedAt: "asc" }, select: { id: true } });
  let raised = 0;
  for (const one of open) raised += (await carryOutRequest(t, one.id, user)).numbers.length;
  return raised;
}
