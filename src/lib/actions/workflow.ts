"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { mayContributeToDocument } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { startWorkflowRun, recordStepOutcome, recordStepApproval, normalizeRoute, rewindRoute, readyForRelease, type WfStep } from "@/lib/workflow";
import { typeSkipsReview } from "@/lib/review-need";
import { notifyMany } from "@/lib/audit";
import { isReadOnly } from "@/lib/auth";
import { hasVerb, isAdmin, isController } from "@/lib/auth";
import { getActiveSet } from "@/lib/config";
import { requestFromForm } from "@/lib/issue-requests";

// ── Workflow templates (organization-defined routing) ────────────────────────

export async function saveTemplateAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  try {
    const ctx = await requireScope();
  const { user: admin, db, projectId, orgId } = ctx;
    if (!hasVerb(admin, "ROUTES")) return { error: "Maintaining review routes needs the Review routes permission — an administrator grants it in the distribution matrix." };
    const id = String(formData.get("id") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    const classes = String(formData.get("classes") ?? "*").trim() || "*";
    const outcomeSetKey = String(formData.get("outcomeSetKey") ?? "REVIEW_OUTCOMES");
    const isDefault = formData.get("isDefault") === "on";
    const stepsRaw = String(formData.get("steps") ?? "[]");

    if (!name) return { error: "Name is required." };
    if (classes !== "*") {
      try {
        const parsedClasses = JSON.parse(classes);
        if (!Array.isArray(parsedClasses) || !parsedClasses.length) return { error: "Choose at least one document class or all documents." };
      } catch {
        return { error: "The document-class scope is invalid." };
      }
    }
    if (!await db.configSet.findFirst({ where: { key: outcomeSetKey } })) return { error: "Choose a published review-outcome set." };
    let steps: unknown;
    try { steps = JSON.parse(stepsRaw); } catch { return { error: "Steps are not valid JSON." }; }
    if (!Array.isArray(steps) || steps.length === 0) return { error: "Add at least one step." };
    // What a step says about the status has to name statuses the organization
    // published, and an intermediate status has to be one a step may hand on at.
    const statusValues = await getActiveSet("STATUSES");
    const byCode = new Set(statusValues.map((value) => value.code));
    for (const [index, st] of (steps as Record<string, unknown>[]).entries()) {
      if (!["REVIEW", "APPROVAL"].includes(String(st.act))) return { error: "Each step is REVIEW or APPROVAL." };
      if (!["ANY_OF", "ALL_CONSOLIDATOR", "SERIAL", "ALL"].includes(String(st.mode))) return { error: "Choose how each step decides." };
      if (Array.isArray(st.grantsStatuses)) {
        const unknown = (st.grantsStatuses as unknown[]).map(String).filter((code) => !byCode.has(code));
        if (unknown.length) return { error: `Not published statuses: ${unknown.join(", ")}.` };
      }
      // A step that names nobody is fine: when sent, it is assigned from the
      // distribution matrix by the documents' discipline, and the sender adjusts.
    }
    // The last step decides; every earlier step advises.
    steps = normalizeRoute(steps as WfStep[]);

    if (isDefault) await db.workflowTemplate.updateMany({ where: { classes, ...(id ? { NOT: { id } } : {}) }, data: { isDefault: false } });
    if (id) {
      await db.workflowTemplate.update({ where: { id }, data: { name, description, classes, steps: JSON.stringify(steps), outcomeSetKey, isDefault } });
    } else {
      await db.workflowTemplate.create({ data: { orgId, id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${Date.now().toString(36)}`, name, description, classes, steps: JSON.stringify(steps), outcomeSetKey, isDefault, createdByName: admin.name } });
    }
    await audit({ actor: admin, action: "TEMPLATE_SAVED", entityType: "WorkflowTemplate", entityId: id || name, entityLabel: name, detail: `${(steps as unknown[]).length} step(s), outcome set ${outcomeSetKey}.` });
    revalidatePath("/settings/workflow-templates");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function deleteTemplateAction(formData: FormData) {
  try {
    const ctx = await requireScope();
  const { user: admin, db, projectId, orgId } = ctx;
    if (!hasVerb(admin, "ROUTES")) return;
    const id = String(formData.get("id") ?? "");
    await db.workflowTemplate.update({ where: { id }, data: { active: false } }).catch(async () => {
      await db.workflowTemplate.delete({ where: { id } }).catch(() => undefined);
    });
    await audit({ actor: admin, action: "TEMPLATE_REMOVED", entityType: "WorkflowTemplate", entityId: id });
    revalidatePath("/settings/workflow-templates");
  } catch {
    // ignore
  }
}

// ── Starting workflows (single document or several) ──────────────────────────


/**
 * The one way to send documents down a review route — from a document, a
 * selection in the register, or an accepted incoming transmittal. The people
 * chosen for each step apply to every document sent.
 */
export async function sendForReviewAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot send documents for review." };
  const revisionIds = formData.getAll("revisionIds").map(String).filter(Boolean);
  const templateId = String(formData.get("templateId") ?? "");
  if (!revisionIds.length) return { error: "Nothing to send." };
  if (!templateId) return { error: "Choose a route." };
  const overrides: string[][] = [];
  for (const key of new Set([...formData.keys()].filter((k) => k.startsWith("participants_")))) {
    overrides[Number(key.replace("participants_", ""))] = formData.getAll(key).map(String).filter(Boolean);
  }
  const template = await db.workflowTemplate.findUniqueOrThrow({ where: { id: templateId } });
  const stepCount = (JSON.parse(template.steps) as unknown[]).length;
  for (let i = 0; i < stepCount; i++) if (!overrides[i]?.length) return { error: `Choose at least one person for step ${i + 1}.` };

  const sent: string[] = [];
  const failed: string[] = [];
  const isStaff = isController(user);
  // Copied in: told it went out for review, never put on the route. Only
  // people on this project, and nobody twice.
  const copyIds = [...new Set(formData.getAll("copyUsers").map(String).filter(Boolean))];
  const copied = copyIds.length
    ? await db.user.findMany({ where: { id: { in: copyIds }, active: true, memberships: { some: { projectId: ctx.projectId, active: true } } }, select: { id: true, name: true } })
    : [];
  for (const rid of revisionIds) {
    const rev = await db.revision.findUnique({ where: { id: rid }, include: { document: true } });
    if (!rev) continue;
    const label = `${rev.document.docNumber} rev ${rev.value}`;
    // The author sends internal work; Document Control sends anything a supplier or other party produced.
    const allowed = mayContributeToDocument(user, rev.document) && (isStaff || (!rev.document.originator && rev.document.createdById === user.id));
    if (!allowed) { failed.push(`${label}: only ${rev.document.originator ? "Document Control" : "its author or Document Control"} can send it`); continue; }
    const res = await startWorkflowRun(ctx, rid, templateId, user, overrides);
    if (res.ok) {
      sent.push(label);
      revalidatePath(`/documents/${rev.documentId}`);
      if (copied.length) {
        await notifyMany(copied.map((one) => one.id), "REVIEW_COPIED", `For your information: ${label} is out for review`, `${user.name} copied you in. Nothing is asked of you.`, `/documents/${rev.documentId}`, ctx);
        await audit({
          tenant: ctx, actor: user, action: "REVIEW_COPIED", entityType: "Revision", entityId: rid, entityLabel: label,
          newValue: copied.map((one) => one.name).join(", "), detail: `Copied in on the review: ${copied.map((one) => one.name).join(", ")}.`,
        });
      }
    }
    else failed.push(`${label}: ${res.error}`);
  }
  revalidatePath("/"); revalidatePath("/documents");
  if (!sent.length) return { error: failed.join(" · ") || "Nothing was sent." };
  return { ok: `Sent ${sent.length}: ${sent.join(", ")}.`, error: failed.length ? failed.join(" · ") : undefined };
}


// ── Recording decisions on the active step ───────────────────────────────────

/** Whoever holds the open step sends the route back to an earlier one. */
export async function rewindRouteAction(_prev: { ok?: string; error?: string } | undefined, formData: FormData): Promise<{ ok?: string; error?: string }> {
  const ctx = await requireScope();
  const { user } = ctx;
  const runId = String(formData.get("runId") ?? "");
  const toStep = Number(formData.get("toStep") ?? "");
  if (!runId || !toStep) return { error: "Say which step it goes back to." };
  const res = await rewindRoute(
    ctx,
    runId,
    user,
    toStep,
    String(formData.get("returnReason") ?? "").trim(),
    String(formData.get("reason") ?? "").trim(),
  );
  if (!res.ok) return { error: res.error };
  revalidatePath("/");
  return { ok: "Sent back." };
}

export async function recordStepOutcomeAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const runId = String(formData.get("runId") ?? "");
  const outcomeCode = String(formData.get("outcome") ?? "");
  // The comment a verdict carries when it says something is wrong. Every step
  // answers with a verdict, so there is always a code.
  const note = String(formData.get("comment") ?? "").trim() || undefined;
  const issuedFor = String(formData.get("issuedFor") ?? "").trim() || undefined;
  if (!outcomeCode) return { error: "Choose the verdict." };
  try {
    const res = await recordStepOutcome(ctx, runId, user, outcomeCode, note, issuedFor, formData.get("confirmStatus") === "on", Number(formData.get("closesWithStep") ?? "") || null, requestFromForm(formData));
    if (!res.ok) return { error: res.error };
    revalidatePath("/");
    return { ok: res.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function recordStepApprovalAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const runId = String(formData.get("runId") ?? "");
  const note = String(formData.get("note") ?? "").trim() || undefined;
  // The decision is a code from the organization's outcome set; whether it
  // counts as approval is that code's published "proceed" property.
  const outcome = String(formData.get("outcome") ?? "");
  const value = outcome ? await db.configValue.findFirst({ where: { setKey: "REVIEW_OUTCOMES", code: outcome, status: "ACTIVE" } }) : null;
  if (!value) return { error: "Choose an outcome." };
  let props: { proceed?: boolean } = {};
  try { props = value.props ? JSON.parse(value.props) : {}; } catch { props = {}; }
  const approve = props.proceed === true;
  if (!approve && !note) return { error: `${value.label} needs a reason for the author.` };
  try {
    const res = await recordStepApproval(ctx, runId, user, approve, note, outcome);
    if (!res.ok) return { error: res.error };
    revalidatePath("/");
    return { ok: res.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}

// ── Parties (§0.3) ───────────────────────────────────────────────────────────

/**
 * Remove a party that was added by mistake. Only one that never had a person,
 * never held a review step, and whose code appears on no document or
 * transmittal: anything that has been used is revoked instead, so the record
 * keeps meaning what it meant.
 */
export async function deletePartyAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user: admin, db } = ctx;
  if (!isAdmin(admin)) return { error: "Administrators only." };
  const id = String(formData.get("id") ?? "").trim();
  const party = await db.party.findFirst({ where: { id }, include: { _count: { select: { users: true, cycles: true } } } });
  if (!party) return { error: "That party no longer exists." };
  if (party.isInternal) return { error: "Your own organization cannot be removed." };
  if (party._count.users) return { error: `${party.name} has ${party._count.users} ${party._count.users === 1 ? "person" : "people"}. Revoke its access instead — removing it would orphan them.` };
  if (party._count.cycles) return { error: `${party.name} has answered a review step. Revoke its access instead; the record keeps its name.` };

  const used = await Promise.all([
    db.document.count({ where: { originator: party.code } }),
    db.transmittal.count({ where: { issuingParty: party.name } }),
    db.transmittalRecipient.count({ where: { organization: party.name } }),
  ]);
  if (used.some((n) => n > 0)) return { error: `${party.name} appears on documents or transmittals. Revoke its access instead.` };

  await db.party.delete({ where: { id } });
  await audit({ actor: admin, action: "PARTY_REMOVED", entityType: "Party", entityId: party.code, entityLabel: party.name, detail: "Removed: it never held a person, a step, a document or a transmittal." });
  revalidatePath("/settings/parties");
  return {};
}

export async function savePartyAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  try {
    const ctx = await requireScope();
  const { user: admin, db, projectId, orgId } = ctx;
    if (!isAdmin(admin)) return { error: "Administrators only." };
    const id = String(formData.get("id") ?? "").trim();
    const code = String(formData.get("code") ?? "").trim().toUpperCase();
    const name = String(formData.get("name") ?? "").trim();
    // Our own organization is registered once, at setup. Everything added here
    // is another organization.
    const isInternal = false;
    const contactId = String(formData.get("contactId") ?? "") || null;
    const backupId = String(formData.get("backupId") ?? "") || null;
    // How this party takes part in a review route, and who carries it when they
    // do not answer here.
    const kind = ["COLLABORATOR", "GUEST", "OFFLINE"].includes(String(formData.get("kind") ?? ""))
      ? String(formData.get("kind"))
      : "COLLABORATOR";
    // The older wording is kept in step with the kind, so records and code that
    // still read it stay correct.
    const participation = kind === "OFFLINE" ? "BY_PROXY" : "IN_APP";
    // Anything recorded for an organization that is not here carries its proof.
    // It is a rule, not a preference, so it is not asked.
    const evidenceRequiredForKind = kind === "OFFLINE";
    const liaisonFunction = String(formData.get("liaisonFunction") ?? "").trim() || null;
    if (contactId && backupId && contactId === backupId) return { error: "The backup has to be someone other than the contact." };
    if (id) {
      const party = await db.party.findFirst({ where: { id } });
      if (!party) return { error: "That party no longer exists." };
      // The code can be corrected, but what was issued under the old one keeps
      // it: a document number is a record, not a pointer.
      if (code && code !== party.code) {
        const clash = await db.party.findFirst({ where: { orgId, code, NOT: { id } } });
        if (clash) return { error: `${clash.name} already uses the code ${code}.` };
        await db.party.update({ where: { id }, data: { code } });
        await audit({ actor: admin, action: "PARTY_CODE_CHANGED", entityType: "Party", entityId: code, entityLabel: name || party.name, oldValue: party.code, newValue: code, detail: "Documents and transmittals already issued keep the old code." });
      }
      const active = formData.get("active") === "on";
      if (!name) return { error: "A party needs a name." };
      if (party.isInternal && !active) return { error: "Your own organization cannot be switched off." };
      // Somebody has to answer for a party we exchange documents with.
      if (!party.isInternal && active && !contactId) return { error: `Name the person who answers for ${name}. The backup is optional.` };
      await db.party.update({
        where: { id },
        data: party.isInternal
          ? { name, active, contactId, backupId }
          : { name, active, contactId, backupId, kind, participation, liaisonFunction, evidenceRequired: evidenceRequiredForKind },
      });
      if (party.active !== active || party.name !== name) {
        await audit({ actor: admin, action: active ? "PARTY_UPDATED" : "PARTY_REVOKED", entityType: "Party", entityId: party.code, entityLabel: name, oldValue: `${party.name}${party.active ? "" : " (revoked)"}`, newValue: `${name}${active ? "" : " (revoked)"}`, detail: active ? undefined : "Access revoked: its people can no longer sign in." });
      }
    } else {
      if (!code || !name) return { error: "Code and name are required." };
      // A new party has no people yet, so the contact is named from its own
      // people once they exist — not borrowed from ours.
      await db.party.create({ data: { orgId, code, name, isInternal, contactId, backupId, kind, participation, evidenceRequired: evidenceRequiredForKind } });
    }
    revalidatePath("/settings/parties");
    revalidatePath("/settings/users");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function setUserPartyAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  try {
    const ctx = await requireScope();
  const { user: admin, db, projectId, orgId } = ctx;
    if (!isAdmin(admin)) return { error: "Administrators only." };
    const userId = String(formData.get("userId") ?? "");
    const partyId = String(formData.get("partyId") ?? "") || null;
    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { party: true } });
    const party = partyId ? await db.party.findUnique({ where: { id: partyId } }) : null;
    await db.user.update({ where: { id: userId }, data: { partyId, organization: party?.name ?? user.organization } });
    await audit({ actor: admin, action: "USER_UPDATED", entityType: "User", entityId: user.email, entityLabel: user.name, field: "party", oldValue: user.party?.name ?? user.organization ?? "—", newValue: party?.name ?? "—" });
    revalidatePath("/settings/users");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}

// ── Steps answered by a party that is not in this system ─────────────────────

/**
 * The pack went out. Records when, by what channel, under whose reference, and
 * with the proof of sending attached. The clock on the step runs from here.
 */
export async function markDispatchedAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const cycleId = String(formData.get("cycleId") ?? "");
  const channel = String(formData.get("channel") ?? "").trim();
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const when = String(formData.get("sentOn") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!channel) return { error: "Say where it went." };

  const cycle = await db.reviewCycle.findUnique({
    where: { id: cycleId },
    include: { party: true, revision: { include: { document: true } }, assignments: true },
  });
  if (!cycle || !cycle.partyId) return { error: "This step is not answered by an outside party." };
  if (cycle.status !== "OPEN") return { error: "This step is closed." };
  if (!cycle.assignments.some((seat) => seat.userId === user.id) && !isController(user) && !isAdmin(user)) {
    return { error: "Only the person carrying this exchange records that it was sent." };
  }

  const proof = formData.get("evidence");
  // This step leaves our system, so the only thing that makes it a record is
  // what proves it left.
  if (!(proof instanceof File) || proof.size === 0) {
    return { error: "Attach the proof it was sent — the email, or the receipt their system gave you." };
  }
  let evidence: string | null = null;
  if (proof instanceof File && proof.size > 0) {
    const { saveUpload } = await import("@/lib/files");
    const saved = await saveUpload(ctx, proof, cycle.revision.document.docNumber, "EVIDENCE", cycle.revision.value);
    const file = await db.storedFile.create({
      data: {
        projectId: ctx.projectId, name: saved.name, path: saved.relPath, size: saved.size, mime: saved.mime,
        sha256: saved.sha256, kind: "EVIDENCE", revisionId: cycle.revisionId, cycleId: cycle.id,
        uploadedById: user.id, uploadedByName: user.name,
      },
    });
    evidence = file.id;
  }

  const sentAt = when ? new Date(`${when}T12:00:00`) : new Date();

  // Sending it out is a handover between parties, so it belongs in the register
  // of correspondence as well as on the step. The transmittal is raised here,
  // at the moment it actually left, and the step points at it.
  let transmittalId = cycle.transmittalId;
  if (!transmittalId) {
    const { nextRecordNumber } = await import("@/lib/numbering-records");
    const [internal, project] = await Promise.all([
      db.party.findFirst({ where: { isInternal: true }, select: { code: true, name: true } }),
      db.project.findUnique({ where: { id: ctx.projectId }, select: { code: true } }),
    ]);
    const number = await nextRecordNumber(
      ctx,
      "TRANSMITTAL",
      { project: project?.code ?? "", sender: internal?.code ?? null, receiver: cycle.party?.code ?? null, reason: "REVIEW" },
      "TR",
    );
    const raised = await db.transmittal.create({
      data: {
        projectId: ctx.projectId,
        number,
        direction: "OUTGOING",
        reasonForIssue: "REVIEW",
        dateOfIssue: sentAt,
        issuingParty: internal?.name ?? "Our organization",
        subject: `${cycle.revision.document.docNumber} rev ${cycle.revision.value} — for review`,
        message: `Sent to ${cycle.party?.name ?? "an outside party"} by ${channel}${reference ? ` (${reference})` : ""}.`,
        status: "ISSUED",
        createdById: user.id,
        createdByName: user.name,
        items: { create: [{ projectId: ctx.projectId, revisionId: cycle.revisionId }] },
        recipients: cycle.party
          ? { create: [{ projectId: ctx.projectId, name: cycle.party.contactName ?? cycle.party.name, organization: cycle.party.name, partyId: cycle.party.id }] }
          : undefined,
      },
    });
    transmittalId = raised.id;
  }
  // The transmittal's row for them says the same thing the step does: it went,
  // how, when, by whom, and the proof — so it reads as sent rather than unseen.
  if (cycle.party) {
    await db.transmittalRecipient.updateMany({
      where: { transmittalId, userId: null, dispatchedAt: null, OR: [{ partyId: cycle.party.id }, { partyId: null, organization: cycle.party.name }] },
      data: { partyId: cycle.party.id, dispatchedAt: sentAt, dispatchChannel: channel, dispatchRef: reference, dispatchedByName: user.name, proofFileId: evidence },
    });
  }

  // An approval asked for after release: the revision is on hold, not for use,
  // from the moment it goes to them.
  if (cycle.issueRequestId && cycle.revision.state === "RELEASED") {
    const { holdRevision } = await import("@/lib/issue-requests");
    await holdRevision(ctx, cycle.revisionId, user, cycle.party?.name ?? "the outside party");
  }
  await db.reviewCycle.update({
    where: { id: cycleId },
    data: {
      dispatchedAt: sentAt,
      dispatchChannel: channel,
      dispatchRef: note ? `${reference ?? ""}${reference ? " · " : ""}${note}` : reference,
      transmittalId,
    },
  });
  await audit({
    tenant: ctx, actor: user, action: "STEP_DISPATCHED", entityType: "ReviewCycle", entityId: cycleId,
    entityLabel: `${cycle.revision.document.docNumber} rev ${cycle.revision.value}`,
    detail: `Sent to ${cycle.party?.name ?? "an outside party"} outside our system, by ${channel}${reference ? ` (${reference})` : ""}. Proof attached.`,
  });
  revalidatePath("/");
  return { ok: "Recorded as sent." };
}

/**
 * A revision of a type the organization does not review, sent from preparation
 * straight to release. Whoever would have sent it for review sends it here:
 * they settle the status it is released at and, as the deciding step would,
 * who receives it. From there it is any decided revision — an outside approval
 * asked for opens first, and Document Control's gate publishes it.
 */
export async function submitForReleaseAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot release documents." };
  const revisionId = String(formData.get("revisionId") ?? "");
  const statusCode = String(formData.get("issuedFor") ?? "").trim();
  const rev = await db.revision.findUnique({ where: { id: revisionId }, include: { document: true } });
  if (!rev) return { error: "That revision no longer exists." };
  const label = `${rev.document.docNumber} rev ${rev.value}`;
  if (rev.state !== "IN_PREPARATION") return { error: `${label} is not being prepared.` };
  if (!(await typeSkipsReview(ctx, rev.document.docType))) return { error: `${rev.document.docType} is reviewed before release — send it for review.` };
  const allowed = mayContributeToDocument(user, rev.document) && (isController(user) || (!rev.document.originator && rev.document.createdById === user.id));
  if (!allowed) return { error: `Only ${rev.document.originator ? "Document Control" : "its author or Document Control"} can send it on.` };
  if (!rev.renditionFileId && !rev.nativeFileId) return { error: "Attach the file first — a PDF is what is released." };
  const status = (await getActiveSet("STATUSES")).find((one) => one.code === statusCode);
  if (!status) return { error: "Choose the status it is released at." };

  // Who receives it, asked here as the deciding step would ask it — where
  // releasing sends it. Where it means go ahead, only an outside approval stays.
  const { issuePolicy, noRecipients } = await import("@/lib/issue-requests");
  const asked = (await issuePolicy(ctx)).asked;
  const formRequest = requestFromForm(formData);
  const request = asked ? formRequest : { ...formRequest, give: formRequest.needsApproval, recipients: { internalUserIds: [], partyIds: [] }, delegated: false };
  if (request.give) {
    if (asked && !request.delegated && noRecipients(request.recipients)) return { error: "Say who it goes to, or leave it to the author." };
    if (request.needsApproval && !request.approverId) return { error: "Say which party has to approve it before it is released." };
  }

  await db.revision.update({
    where: { id: rev.id },
    data: { state: "NOT_RELEASED", statusCode: status.code, statusSetAt: new Date(), statusSetByName: user.name, submittedAt: new Date() },
  });
  if (request.give) {
    await db.issueRequest.create({
      data: {
        projectId, revisionId: rev.id, reason: request.reason, recipients: JSON.stringify(request.recipients),
        note: request.note ?? null, delegated: request.delegated, needsApproval: !!request.needsApproval,
        approverId: request.approverId ?? null, raisedById: user.id, raisedByName: user.name,
      },
    });
    if (request.delegated) {
      await notifyMany([rev.document.createdById], "ISSUE_DELEGATED", `Who should get ${label}?`, "It was left to you to say who this revision goes to. Ask for it when you know.", `/documents/${rev.documentId}`, ctx);
    }
  }
  await audit({
    tenant: ctx, actor: user, action: "SUBMITTED_FOR_RELEASE", entityType: "Revision", entityId: rev.id, entityLabel: label,
    newValue: status.code, detail: `Not reviewed: document type ${rev.document.docType} goes from preparation straight to release.`,
  });
  await readyForRelease(ctx, rev.id, user, `${label} is a type that is not reviewed — sent on for release.`, "the document type, which is not reviewed");
  revalidatePath(`/documents/${rev.documentId}`);
  revalidatePath("/");
  return { ok: "Sent on for release." };
}
