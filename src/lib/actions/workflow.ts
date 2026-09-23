"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { mayContributeToDocument } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { startWorkflowRun, recordStepOutcome, recordStepApproval, normalizeRoute, type WfStep } from "@/lib/workflow";
import { isReadOnly } from "@/lib/auth";
import { hasVerb, isAdmin, isController } from "@/lib/auth";

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
    for (const st of steps as Record<string, unknown>[]) {
      if (!["REVIEW", "APPROVAL"].includes(String(st.act))) return { error: "Each step is REVIEW or APPROVAL." };
      if (!["ANY_OF", "ALL_CONSOLIDATOR", "SERIAL", "ALL"].includes(String(st.mode))) return { error: "Choose how each step decides." };
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
    revalidatePath("/admin/workflow-templates");
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
    revalidatePath("/admin/workflow-templates");
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
  for (const rid of revisionIds) {
    const rev = await db.revision.findUnique({ where: { id: rid }, include: { document: true } });
    if (!rev) continue;
    const label = `${rev.document.docNumber} rev ${rev.value}`;
    // The author sends internal work; Document Control sends anything a supplier or other party produced.
    const allowed = mayContributeToDocument(user, rev.document) && (isStaff || (!rev.document.originator && rev.document.createdById === user.id));
    if (!allowed) { failed.push(`${label}: only ${rev.document.originator ? "Document Control" : "its author or Document Control"} can send it`); continue; }
    const res = await startWorkflowRun(ctx, rid, templateId, user, overrides);
    if (res.ok) { sent.push(label); revalidatePath(`/documents/${rev.documentId}`); }
    else failed.push(`${label}: ${res.error}`);
  }
  revalidatePath("/"); revalidatePath("/documents");
  if (!sent.length) return { error: failed.join(" · ") || "Nothing was sent." };
  return { ok: `Sent ${sent.length}: ${sent.join(", ")}.`, error: failed.length ? failed.join(" · ") : undefined };
}


// ── Recording decisions on the active step ───────────────────────────────────

export async function recordStepOutcomeAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const runId = String(formData.get("runId") ?? "");
  const outcomeCode = String(formData.get("outcome") ?? "");
  const note = String(formData.get("note") ?? "").trim() || undefined;
  if (!outcomeCode) return { error: "Choose the outcome from the set." };
  try {
    const res = await recordStepOutcome(ctx, runId, user, outcomeCode, note);
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

export async function savePartyAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  try {
    const ctx = await requireScope();
  const { user: admin, db, projectId, orgId } = ctx;
    if (!isAdmin(admin)) return { error: "Administrators only." };
    const id = String(formData.get("id") ?? "").trim();
    const code = String(formData.get("code") ?? "").trim().toUpperCase();
    const name = String(formData.get("name") ?? "").trim();
    const isInternal = formData.get("isInternal") === "on";
    const contactId = String(formData.get("contactId") ?? "") || null;
    const backupId = String(formData.get("backupId") ?? "") || null;
    if (contactId && backupId && contactId === backupId) return { error: "The backup has to be someone other than the contact." };
    if (id) {
      // The code is fixed once issued: document numbers and originators carry it.
      const party = await db.party.findFirst({ where: { id } });
      if (!party) return { error: "That party no longer exists." };
      const active = formData.get("active") === "on";
      if (!name) return { error: "A party needs a name." };
      if (party.isInternal && !active) return { error: "Your own organization cannot be switched off." };
      // Somebody has to answer for a party we exchange documents with.
      if (!party.isInternal && active && !contactId) return { error: `Name the person who answers for ${name}. The backup is optional.` };
      await db.party.update({ where: { id }, data: { name, active, contactId, backupId } });
      if (party.active !== active || party.name !== name) {
        await audit({ actor: admin, action: active ? "PARTY_UPDATED" : "PARTY_REVOKED", entityType: "Party", entityId: party.code, entityLabel: name, oldValue: `${party.name}${party.active ? "" : " (revoked)"}`, newValue: `${name}${active ? "" : " (revoked)"}`, detail: active ? undefined : "Access revoked: its people can no longer sign in." });
      }
    } else {
      if (!code || !name) return { error: "Code and name are required." };
      if (!isInternal && !contactId) return { error: "Name the person who answers for this party." };
      await db.party.create({ data: { orgId, code, name, isInternal, contactId, backupId } });
    }
    revalidatePath("/admin/parties");
    revalidatePath("/admin/users");
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
    revalidatePath("/admin/users");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}
