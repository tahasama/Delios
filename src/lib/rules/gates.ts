import { registerGate, ok, warn, block, type Gate, type GateContext, type Subject } from "./registry";
import { ROLE_RANK, isEmptyTitle } from "../standard";

/**
 * The gates themselves, one per precondition the Standard states.
 *
 * Each is the declarative form of a condition that already lived as a `throw`
 * inside the act. Keeping them here means the screen can show the same list
 * before the act that the act enforces during it.
 */

// ── Shared lookups ───────────────────────────────────────────────────────────

async function revisionOf(ctx: GateContext, subject: Subject) {
  if (!subject.revisionId) return null;
  return ctx.db.revision.findFirst({
    where: { id: subject.revisionId },
    include: { document: true },
  });
}

/**
 * Gates read published values straight from the tenant client rather than
 * through `config.ts`, which is request-bound. That keeps them callable from a
 * batch job and from a test, not only from inside a request.
 */
async function activeValues(ctx: GateContext, setKey: string) {
  const rows = await ctx.db.configValue.findMany({
    where: { setKey, status: "ACTIVE" },
    orderBy: [{ sort: "asc" }, { code: "asc" }],
  });
  return rows.map((r) => {
    let props: Record<string, unknown> = {};
    if (r.props) {
      try { props = JSON.parse(r.props) as Record<string, unknown>; } catch { /* not declared */ }
    }
    return { code: r.code, label: r.label, props };
  });
}

/**
 * The published approval authority for a document class (§8.2). Most specific
 * matching row governs; a null field is a wildcard.
 */
async function authorityFor(
  ctx: GateContext,
  doc: { discipline: string; docType: string; criticality: string | null },
): Promise<{ minRole: string; version: number } | null> {
  const rows = await ctx.db.authorityRow.findMany({ where: { active: true } });
  if (!rows.length) return null;
  const specificity = (r: (typeof rows)[number]) =>
    (r.docType === doc.docType ? 4 : r.docType == null ? 0 : -1) +
    (r.discipline === doc.discipline ? 2 : r.discipline == null ? 0 : -1) +
    (r.criticality === doc.criticality ? 1 : r.criticality == null ? 0 : -1);
  const candidates = rows
    .filter(
      (r) =>
        (r.docType == null || r.docType === doc.docType) &&
        (r.discipline == null || r.discipline === doc.discipline) &&
        (r.criticality == null || r.criticality === doc.criticality),
    )
    .map((r) => ({ r, s: specificity(r) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s);
  if (!candidates.length) return null;
  return { minRole: candidates[0].r.minRole, version: candidates[0].r.version };
}

// ── Send for review (§7.5) ───────────────────────────────────────────────────

const submitState: Gate = {
  id: "SUB-STATE",
  intent: "SUBMIT_FOR_REVIEW",
  title: "Revision is in preparation",
  clause: "§7.5",
  async evaluate(ctx, subject) {
    const rev = await revisionOf(ctx, subject);
    if (!rev) return block("No revision selected.");
    if (rev.state === "IN_PREPARATION") return ok("In preparation.");
    return block(
      `This revision is ${rev.state.replace(/_/g, " ").toLowerCase()}, not in preparation.`,
 "A revision moves forward, never back. Start a new revision instead.",
    );
  },
};

const submitFile: Gate = {
  id: "SUB-FILE",
  intent: "SUBMIT_FOR_REVIEW",
  title: "Something to review",
  clause: "§10.1",
  async evaluate(ctx, subject) {
    const rev = await revisionOf(ctx, subject);
    if (!rev) return block("No revision selected.");
    if (rev.nativeFileId || rev.renditionFileId) return ok("A file is attached.");
    return warn(
      "No file is attached yet.",
      "Reviewers will have nothing to open. Attach the native file before sending.",
    );
  },
};

const submitReason: Gate = {
  id: "SUB-REASON",
  intent: "SUBMIT_FOR_REVIEW",
  title: "Reason for the revision",
  clause: "§6.6",
  preventsCheck: "RV-06",
  async evaluate(ctx, subject) {
    const rev = await revisionOf(ctx, subject);
    if (!rev) return block("No revision selected.");
    if (rev.reasonForRevision && rev.changeDescription) return ok("Reason and description of change recorded.");
    const missing = [!rev.reasonForRevision && "reason for revision", !rev.changeDescription && "description of change"]
      .filter(Boolean)
      .join(" and ");
    return warn(
      `No ${missing} yet.`,
 "Release will require it. Easier to write now, while you remember what changed.",
    );
  },
};

// ── Approve (Part 8) ─────────────────────────────────────────────────────────

const approveState: Gate = {
  id: "APP-STATE",
  intent: "APPROVE",
  title: "Revision is in review",
  clause: "§8.1",
  async evaluate(ctx, subject) {
    const rev = await revisionOf(ctx, subject);
    if (!rev) return block("No revision selected.");
    if (rev.state === "IN_REVIEW") return ok("In review.");
    return block(
      `Approval is recorded against a revision in review; this one is ${rev.state.replace(/_/g, " ").toLowerCase()}.`,
      "Send it for review first.",
    );
  },
};

const approveAuthority: Gate = {
  id: "APP-AUTHORITY",
  intent: "APPROVE",
  title: "You hold the authority",
  clause: "§8.2 · §8.3",
  preventsCheck: "AP-05",
  async evaluate(ctx, subject) {
    const rev = await revisionOf(ctx, subject);
    if (!rev) return block("No revision selected.");

    if (!ctx.can("APPROVE", rev.document)) {
 return block(ctx.why("APPROVE", rev.document), "The permission matrix decides this.");
    }

    return ok(`${ctx.user.functionName ?? "Your function"} holds Approve for this class in the distribution matrix.`);
  },
};

const approveSelfReview: Gate = {
  id: "APP-OWN-WORK",
  intent: "APPROVE",
  title: "Not your own work",
  clause: "§8.3",
  async evaluate(ctx, subject) {
    const rev = await revisionOf(ctx, subject);
    if (!rev) return block("No revision selected.");
    if (rev.document.createdById !== ctx.user.id) return ok("Someone else raised this document.");
    return warn(
      "You raised this document yourself.",
 "Approval attributed to the author carries less weight. Consider passing it to another approver.",
    );
  },
};

// ── Release (§7.5, §7.6) ─────────────────────────────────────────────────────

const releaseState: Gate = {
  id: "REL-STATE",
  intent: "RELEASE",
  title: "Revision can be released",
  clause: "§7.5",
  async evaluate(ctx, subject) {
    const rev = await revisionOf(ctx, subject);
    if (!rev) return block("No revision selected.");
    if (rev.state === "IN_REVIEW" || rev.state === "IN_PREPARATION") return ok("Ready to move to released.");
    return block(
      `A ${rev.state.replace(/_/g, " ").toLowerCase()} revision cannot be released.`,
 "States move forward only.",
    );
  },
};

const releaseApproval: Gate = {
  id: "REL-APPROVAL",
  intent: "RELEASE",
  title: "The binding verdict permits release",
  clause: "§7.5 · §8.1",
  preventsCheck: "AP-01",
  async evaluate(ctx, subject) {
    if (!subject.revisionId) return block("No revision selected.");
    // A binding verdict that proceeds is recorded as the approval — one decision.
    const approval = await ctx.db.approval.findFirst({
      where: { revisionId: subject.revisionId, withdrawnAt: null },
      orderBy: { decidedAt: "desc" },
    });
    if (approval) return ok(`Decided by ${approval.approverName}.`);
    return block(
      "No binding verdict lets this revision proceed yet.",
 "Nothing is released until the review's deciding step gives a verdict that proceeds.",
    );
  },
};

const releaseStatus: Gate = {
  id: "REL-STATUS",
  intent: "RELEASE",
  title: "What it may be used for",
  clause: "§7.7",
  async evaluate(ctx, subject) {
    const rev = await revisionOf(ctx, subject);
    const code = subject.statusCode ?? rev?.proposedStatus ?? null;
    if (!code) {
      return warn(
        "The reviewers have not said what it may be used for.",
        "The verdict that lets a revision proceed also says its status. Ask for it on the deciding step.",
      );
    }
    const statuses = await activeValues(ctx, "STATUSES");
    const status = statuses.find((s) => s.code === code);
    if (status) return ok(`Decided by the reviewers: ${status.code} — ${status.label}.`);
    return block(
      `“${subject.statusCode}” is not in the published status set.`,
 "Choose a published status, or publish that one first.",
    );
  },
};

const releaseMetadata: Gate = {
  id: "REL-METADATA",
  intent: "RELEASE",
  title: "Core metadata is complete",
  clause: "§4.8",
  preventsCheck: "MD-07",
  async evaluate(ctx, subject) {
    const rev = await revisionOf(ctx, subject);
    if (!rev) return block("No revision selected.");
    const doc = rev.document;
    const missing: string[] = [];
    if (isEmptyTitle(doc.title)) missing.push("a descriptive title");
    if (!doc.docType) missing.push("document type");
    if (!doc.discipline) missing.push("discipline");
    if (!doc.retentionClass) missing.push("retention class");
    if (!doc.criticality) missing.push("criticality");
    if (!doc.confidentiality) missing.push("confidentiality");
    if (!rev.reasonForRevision) missing.push("reason for revision");
    if (!rev.changeDescription) missing.push("description of change");
 if (!rev.renditionFileId) missing.push("a rendition");
    if (!missing.length) return ok("Everything the Standard requires is recorded.");
    return block(
      `Missing: ${missing.join(", ")}.`,
 "Complete it on the document, then release.",
    );
  },
};

const releaseBlockingComments: Gate = {
  id: "REL-COMMENTS",
  intent: "RELEASE",
  title: "No blocking comments open",
  clause: "§9.6 · §17.3",
  preventsCheck: "RO-04",
  async evaluate(ctx, subject) {
    if (!subject.revisionId) return block("No revision selected.");
    const open = await ctx.db.reviewComment.count({
      where: { cycle: { revisionId: subject.revisionId }, progressionPreventing: true, status: "OPEN" },
    });
    if (open === 0) return ok("No progression-preventing comment is open.");
    return block(
      `${open} progression-preventing comment${open === 1 ? "" : "s"} still open.`,
 "Releasing over one is a structural contradiction. Close or reclassify them first.",
    );
  },
};

// ── Issue a transmittal (Part 11) ────────────────────────────────────────────

const issueItems: Gate = {
  id: "ISS-ITEMS",
  intent: "ISSUE",
  title: "Something to issue",
  clause: "§11.3",
  async evaluate(ctx, subject) {
    if (!subject.transmittalId) return ok("Items are chosen as you build the transmittal.");
    const count = await ctx.db.transmittalItem.count({ where: { transmittalId: subject.transmittalId } });
    if (count > 0) return ok(`${count} item(s) listed.`);
 return block("No items are listed on this transmittal.", "A transmittal issues something.");
  },
};

const issueRecipients: Gate = {
  id: "ISS-RECIPIENTS",
  intent: "ISSUE",
  title: "Recipients are named",
  clause: "§11.4",
  preventsCheck: "IS-08",
  async evaluate(ctx, subject) {
    if (!subject.transmittalId) return ok("Recipients are chosen as you build the transmittal.");
    const count = await ctx.db.transmittalRecipient.count({ where: { transmittalId: subject.transmittalId } });
    if (count > 0) return ok(`${count} recipient(s) named.`);
 return block("Nobody is named as a recipient.", "Recipients are recorded individually.");
  },
};

// ── Void and withdraw (Part 12) ──────────────────────────────────────────────

const voidState: Gate = {
  id: "VOID-STATE",
  intent: "VOID",
  title: "Revision is released",
  clause: "§7.2",
  async evaluate(ctx, subject) {
    const rev = await revisionOf(ctx, subject);
    if (!rev) return block("No revision selected.");
    if (rev.state === "RELEASED") return ok("Released, so it can be voided.");
    return block(
      `Only a released revision can be voided; this one is ${rev.state.replace(/_/g, " ").toLowerCase()}.`,
      "An unreleased revision is simply replaced.",
    );
  },
};

const voidConsequence: Gate = {
  id: "VOID-REASSESS",
  intent: "VOID",
  title: "What was built from it",
  clause: "§12.6",
  preventsCheck: "OB-04",
  async evaluate(ctx, subject) {
    const rev = await revisionOf(ctx, subject);
    if (!rev) return block("No revision selected.");
    const issued = await ctx.db.transmittalItem.count({ where: { revisionId: rev.id } });
    if (issued === 0) return ok("Never issued to anyone.");
    return warn(
      `This revision was issued on ${issued} transmittal${issued === 1 ? "" : "s"}.`,
 "Voiding leaves an unresolved-void exposure until someone checks what was built from it. Record the reassessment.",
    );
  },
};

const withdrawRequired: Gate = {
  id: "WDR-REQUIRED",
  intent: "WITHDRAW",
  title: "Nothing still requires it",
  clause: "§12.6",
  preventsCheck: "OB-05",
  async evaluate(ctx, subject) {
    if (!subject.documentId) return block("No document selected.");
    const [entries, members] = await Promise.all([
      ctx.db.baselineEntry.count({ where: { documentId: subject.documentId } }),
      ctx.db.packageMember.count({ where: { documentId: subject.documentId } }),
    ]);
    if (entries === 0 && members === 0) return ok("No action or package depends on it.");
    const parts = [entries && `${entries} baseline entr${entries === 1 ? "y" : "ies"}`, members && `${members} package member${members === 1 ? "" : "s"}`]
      .filter(Boolean)
      .join(" and ");
    return warn(
      `Still required by ${parts}.`,
 "Withdrawing leaves an orphaned-withdrawal exposure until those are dealt with.",
    );
  },
};

// ── Create a document (§3.9, §5.x) ───────────────────────────────────────────

const createClassification: Gate = {
  id: "CRE-CLASS",
  intent: "CREATE_DOCUMENT",
  title: "Classification sets are published",
  clause: "§1.3 · §4.7",
  async evaluate(ctx) {
    const [types, disciplines] = await Promise.all([
      activeValues(ctx, "DOCUMENT_TYPES"),
      activeValues(ctx, "DISCIPLINES"),
    ]);
    if (types.length && disciplines.length) return ok("Document types and disciplines are published.");
    const missing = [!types.length && "document types", !disciplines.length && "disciplines"].filter(Boolean).join(" and ");
    return block(
      `No ${missing} are published.`,
 "The Standard is not implemented until the value sets are published. Publish them in Admin.",
    );
  },
};

// ── Record a review outcome (Part 9) ─────────────────────────────────────────

const outcomeCycleOpen: Gate = {
  id: "OUT-OPEN",
  intent: "RECORD_OUTCOME",
  title: "Cycle is open",
  clause: "§9.4",
  preventsCheck: "RO-02",
  async evaluate(ctx, subject) {
    if (!subject.cycleId) return block("No review cycle selected.");
    const cycle = await ctx.db.reviewCycle.findFirst({ where: { id: subject.cycleId } });
    if (!cycle) return block("That review cycle no longer exists.");
    if (cycle.outcome) {
      return block(
        `This cycle already carries the outcome “${cycle.outcome}”.`,
 "One outcome per cycle, immutable once recorded. Open a new cycle if the position has changed.",
      );
    }
    if (cycle.status !== "OPEN") return block("This cycle is closed.", "Only an open cycle takes an outcome.");
    return ok("Open, with no outcome yet.");
  },
};

const outcomeAssigned: Gate = {
  id: "OUT-ASSIGNED",
  intent: "RECORD_OUTCOME",
  title: "You are the one to record it",
  clause: "§9.1 · §9.7",
  async evaluate(ctx, subject) {
    if (!subject.cycleId) return block("No review cycle selected.");
    const assigned = await ctx.db.reviewAssignment.findFirst({
      where: { cycleId: subject.cycleId, userId: ctx.user.id },
    });
    if (assigned) return ok("You are assigned to this cycle.");
    if (ctx.can("CONTROL")) return ok("You act as the control function.");
    return block(
      "You are not assigned to this review.",
 "The outcome is recorded by an assigned reviewer, or by the control function.",
    );
  },
};

const outcomeSerialOrder: Gate = {
  id: "OUT-SERIAL",
  intent: "RECORD_OUTCOME",
  title: "Your turn in the sequence",
  clause: "§9.7",
  async evaluate(ctx, subject) {
    if (!subject.cycleId) return block("No review cycle selected.");
    const cycle = await ctx.db.reviewCycle.findFirst({
      where: { id: subject.cycleId },
      include: { assignments: { orderBy: { order: "asc" } } },
    });
    if (!cycle) return block("That review cycle no longer exists.");
    if (cycle.mode !== "SERIAL") return ok("Parallel review — no order to wait for.");
    const mine = cycle.assignments.find((a) => a.userId === ctx.user.id);
    if (!mine) return ok("Not in the sequence.");
    const before = cycle.assignments.filter((a) => a.order < mine.order && !a.completedAt);
    if (!before.length) return ok("Everyone before you has finished.");
    return block(
      `${before.map((a) => a.userName).join(", ")} must finish before you.`,
 "In a serial review each reviewer acts on the previous one's output.",
    );
  },
};

const outcomePublished: Gate = {
  id: "OUT-SET",
  intent: "RECORD_OUTCOME",
  title: "Outcome is in the published set",
  clause: "§9.2",
  async evaluate(ctx, subject) {
 if (!subject.outcomeCode) return warn("No outcome chosen yet.", "Every cycle ends with exactly one.");
    const cycle = subject.cycleId
      ? await ctx.db.reviewCycle.findFirst({ where: { id: subject.cycleId }, select: { outcomeSetKey: true } })
      : null;
    const setKey = cycle?.outcomeSetKey ?? "REVIEW_OUTCOMES";
    const values = await activeValues(ctx, setKey);
    const match = values.find((v) => v.code === subject.outcomeCode);
    if (match) return ok(`Recording “${match.label}”.`);
    return block(
      `“${subject.outcomeCode}” is not in the published set ${setKey}.`,
 "Choose a published outcome.",
    );
  },
};

// ── Start a revision (Part 6) ────────────────────────────────────────────────

const reviseDocumentLive: Gate = {
  id: "REV-DOC-STATE",
  intent: "CREATE_REVISION",
  title: "Document is still in use",
  clause: "§12.1",
  async evaluate(ctx, subject) {
    if (!subject.documentId) return block("No document selected.");
    const doc = await ctx.db.document.findFirst({ where: { id: subject.documentId } });
    if (!doc) return block("That document no longer exists.");
    if (doc.state === "WITHDRAWN" || doc.state === "CANCELLED" || doc.state === "ARCHIVED") {
      return block(
        `This document is ${doc.state.toLowerCase()}.`,
 "An end state is final; nothing is revised out of it.",
      );
    }
    if (doc.kind === "RECORD") {
      return block(
        "This is a record, not a document.",
 "A record is fixed and never revised. Issue a correction instead.",
      );
    }
    return ok("Active, so it can be revised.");
  },
};

const reviseNoOpenRevision: Gate = {
  id: "REV-OPEN",
  intent: "CREATE_REVISION",
  title: "No revision already in flight",
  clause: "§6.3",
  async evaluate(ctx, subject) {
    if (!subject.documentId) return block("No document selected.");
    const open = await ctx.db.revision.findFirst({
      where: { documentId: subject.documentId, state: { in: ["IN_PREPARATION", "IN_REVIEW"] } },
    });
    if (!open) return ok("Nothing open.");
    return block(
      `Revision ${open.value} is already ${open.state.replace(/_/g, " ").toLowerCase()}.`,
 "Finish or void it before starting another — two live revisions of one document cannot both be current.",
    );
  },
};

const reviseAuthorised: Gate = {
  id: "REV-AUTH",
  intent: "CREATE_REVISION",
  title: "There is a reason to revise",
  clause: "§6.5",
  async evaluate(ctx, subject) {
    if (!subject.documentId) return block("No document selected.");
    const released = await ctx.db.revision.findFirst({
      where: { documentId: subject.documentId, state: "RELEASED" },
      orderBy: { releasedAt: "desc" },
      include: { cycles: { orderBy: { sequence: "desc" }, take: 1 } },
    });
    if (!released) return ok("First revision of this document.");
    const outcome = released.cycles[0]?.outcome;
    if (outcome) return ok(`Authorised by the outcome “${outcome}” on the released revision.`);
    return warn(
      "No review outcome requires this revision.",
 "Record why it is being revised — authorisation to revise is part of the record.",
    );
  },
};

// ── Accept a transmittal (§11.9) ─────────────────────────────────────────────

const acceptIssued: Gate = {
  id: "ACC-ISSUED",
  intent: "ACCEPT_TRANSMITTAL",
  title: "Transmittal has been issued",
  clause: "§11.9",
  async evaluate(ctx, subject) {
    if (!subject.transmittalId) return block("No transmittal selected.");
    const t = await ctx.db.transmittal.findFirst({ where: { id: subject.transmittalId } });
    if (!t) return block("That transmittal no longer exists.");
    if (t.status === "ISSUED") return ok(`Issued on ${t.dateOfIssue.toISOString().slice(0, 10)}.`);
    return block(
      `This transmittal is ${t.status.toLowerCase()}, not issued.`,
 "The acceptance check runs once on receipt, against what was issued.",
    );
  },
};

const acceptConditionsPublished: Gate = {
  id: "ACC-CONDITIONS",
  intent: "ACCEPT_TRANSMITTAL",
  title: "Acceptance conditions are published",
  clause: "§11.9",
  async evaluate(ctx) {
    const scope = await ctx.db.scopeConfig.findFirst();
 if (scope) return ok("The five minimum conditions apply.");
    return warn(
      "No scope statement is published for this project.",
 "The organization publishes the acceptance conditions a transmittal must satisfy.",
    );
  },
};

const gates: Gate[] = [
  submitState,
  submitFile,
  submitReason,
  approveState,
  approveAuthority,
  approveSelfReview,
  releaseState,
  releaseApproval,
  releaseStatus,
  releaseMetadata,
  releaseBlockingComments,
  issueItems,
  issueRecipients,
  voidState,
  voidConsequence,
  withdrawRequired,
  createClassification,
  outcomeCycleOpen,
  outcomeAssigned,
  outcomeSerialOrder,
  outcomePublished,
  reviseDocumentLive,
  reviseNoOpenRevision,
  reviseAuthorised,
  acceptIssued,
  acceptConditionsPublished,
];

for (const gate of gates) registerGate(gate);

export { gates };
