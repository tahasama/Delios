"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { api, projectPath, refusal } from "@/lib/api/client";
import { backendRevision, backendReview } from "@/lib/api/legacy";
import { upload, filesOf } from "@/lib/api/uploads";
import { requestFromForm } from "@/lib/issue-requests";
import { formPolicy, checkForm } from "@/lib/field-policy";
import { setOrgSetting } from "@/lib/api/settings";
import { adminParties, PARTY_KEY } from "@/lib/api/admin";

/**
 * Review routes and the answers given on them. A run on these screens is the
 * backend's review, and so is each of its cycles: their ids are the review's.
 * The backend picks the people of each step from their functions, decides who
 * may act, and refuses with the reason.
 */

type Result = { error?: string; ok?: string };
const failed = (e: unknown): Result => ({ error: refusal(e).message });
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

// ── Workflow templates (organization-defined routing) ────────────────────────

/** Routes are set up in the backend's configuration; there is no screen-side editing of them yet. */
export async function saveTemplateAction(_prev: { error?: string } | undefined, _formData: FormData): Promise<{ error?: string }> {
  return { error: "Editing review routes here is not supported yet." };
}

export async function deleteTemplateAction(_prev: { error?: string } | undefined, _formData: FormData): Promise<{ error?: string }> {
  return { error: "Editing review routes here is not supported yet." };
}

/**
 * The one way to send documents down a review route — from a document, a
 * selection in the register, or an accepted incoming transmittal.
 */
export async function sendForReviewAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const revisionIds = formData.getAll("revisionIds").map(String).filter(Boolean);
  const routeId = text(formData, "templateId");
  if (!revisionIds.length) return { error: "Nothing to send." };
  if (!routeId) return { error: "Choose a route." };
  const sent: string[] = [];
  const refused: string[] = [];
  for (const revisionId of revisionIds) {
    try {
      const revision = await backendRevision(ctx, revisionId);
      await api(projectPath(ctx, `/revisions/${revisionId}/reviews`), { body: { routeId }, idempotencyKey: `review-${revisionId}-${routeId}` });
      sent.push(`rev ${revision.value}`);
      revalidatePath(`/documents/${revision.documentId}`);
    } catch (e) {
      refused.push(refusal(e).message);
    }
  }
  revalidatePath("/"); revalidatePath("/documents");
  if (!sent.length) return { error: refused.join(" · ") || "Nothing was sent." };
  return { ok: `Sent ${sent.length}: ${sent.join(", ")}.`, error: refused.length ? refused.join(" · ") : undefined };
}

// ── Recording decisions on the active step ───────────────────────────────────

/** Whoever holds the open step sends the route back to an earlier one. */
export async function rewindRouteAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const runId = text(formData, "runId");
  const toStep = Number(formData.get("toStep") ?? "");
  if (!runId || !toStep) return { error: "Say which step it goes back to." };
  try {
    await api(projectPath(ctx, `/reviews/${runId}/rewind`), {
      body: { toStep, reason: text(formData, "returnReason") || null, note: text(formData, "reason") || null },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/");
  return { ok: "Sent back." };
}

/** The answer on the open step: a verdict and status where it decides, advice where it does not. */
async function answer(runId: string, formData: FormData, note: string | null): Promise<Result> {
  const ctx = await requireScope();
  try {
    const review = await backendReview(ctx, runId);
    const open = review.steps.find((one) => one.state === "OPEN");
    if (!open) return { error: "This step of the review route is closed." };
    const asked = requestFromForm(formData);
    const issue = open.deciding && (asked.recipients.internalUserIds.length || asked.recipients.partyIds.length)
      ? { reason: asked.reason, userIds: asked.recipients.internalUserIds, partyIds: asked.recipients.partyIds, note: asked.note }
      : null;
    await api(projectPath(ctx, `/reviews/${runId}/answer`), {
      body: { verdict: open.deciding ? text(formData, "outcome") || null : null, status: open.deciding ? text(formData, "issuedFor") || null : null, note, issue },
    });
    revalidatePath(`/documents/${review.documentId}`);
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/");
  return { ok: "Recorded." };
}

export async function recordStepOutcomeAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  if (!text(formData, "outcome")) return { error: "Choose the verdict." };
  return answer(text(formData, "runId"), formData, text(formData, "comment") || null);
}

export async function recordStepApprovalAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  if (!text(formData, "outcome")) return { error: "Choose an outcome." };
  return answer(text(formData, "runId"), formData, text(formData, "note") || null);
}

// ── Parties (§0.3) ───────────────────────────────────────────────────────────

/** A party is never deleted: revoking it ends its people's access and keeps every record meaning what it meant. */
export async function deletePartyAction(_prev: { error?: string } | undefined, _formData: FormData): Promise<{ error?: string }> {
  return { error: "An organization is not removed: revoke its access instead, and the record keeps its name." };
}

export async function savePartyAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const id = text(formData, "id");
  const code = text(formData, "code").toUpperCase();
  const name = text(formData, "name");
  const contactId = text(formData, "contactId") || null;
  const backupId = text(formData, "backupId") || null;
  // How this party takes part in a review route, and who carries it when they do not answer here.
  const kind = ["COLLABORATOR", "GUEST", "OFFLINE"].includes(text(formData, "kind")) ? text(formData, "kind") : "COLLABORATOR";
  const participation = kind === "OFFLINE" ? "BY_PROXY" : "IN_APP";
  const custodianFunction = text(formData, "liaisonFunction");
  if (contactId && backupId && contactId === backupId) return { error: "The backup has to be someone other than the contact." };
  try {
    let partyId = id;
    if (id) {
      const party = (await adminParties()).find((one) => one.id === id);
      if (!party) return { error: "That party no longer exists." };
      if (code && code !== party.code) return { error: "An organization's code does not change: documents and transmittals were issued under it." };
      const active = formData.get("active") === "on";
      if (!name) return { error: "A party needs a name." };
      if (party.isInternal && !active) return { error: "Your own organization cannot be switched off." };
      // Somebody has to answer for a party we exchange documents with.
      if (!party.isInternal && active && !contactId) return { error: `Name the person who answers for ${name}. The backup is optional.` };
      await api(`/api/admin/parties/${id}`, {
        method: "PUT",
        body: party.isInternal
          ? { name, active }
          : { name, active, participation, custodianFunction, evidenceRequired: kind === "OFFLINE" },
      });
    } else {
      // What this organization asks of an organization it adds.
      const policy = await formPolicy(ctx, "PARTY");
      const asked = checkForm("PARTY", policy, { code, name, kind, contactId, backupId, liaisonFunction: custodianFunction || null }, (n) => String(formData.get(n) ?? ""));
      if (asked.error) return { error: asked.error };
      const created = await api<{ id: string }>("/api/admin/parties", {
        body: { code, name, isInternal: false, participation, custodianFunction, evidenceRequired: kind === "OFFLINE" },
      });
      partyId = created.id;
    }
    await setOrgSetting(PARTY_KEY + partyId, JSON.stringify({ kind, contactId, backupId }));
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/parties");
  revalidatePath("/settings/users");
  return {};
}

export async function setUserPartyAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  await requireScope();
  const userId = text(formData, "userId");
  const partyId = text(formData, "partyId") || null;
  try {
    await api(`/api/admin/users/${userId}`, { method: "PUT", body: partyId ? { partyId } : { clearParty: true } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/users");
  return {};
}

/**
 * The pack went out. Records when, by what channel, under whose reference, and
 * with the proof of sending attached. The clock on the step runs from here.
 */
export async function markDispatchedAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const cycleId = text(formData, "cycleId");
  const channel = text(formData, "channel");
  if (!channel) return { error: "Say where it went." };
  const proof = filesOf(formData, "evidence")[0];
  // This step leaves our system, so the only thing that makes it a record is what proves it left.
  if (!proof) return { error: "Attach the proof it was sent — the email, or the receipt their system gave you." };
  try {
    const proofFileId = await upload(ctx, { reviewId: cycleId }, proof);
    await api(projectPath(ctx, `/reviews/${cycleId}/dispatch`), { body: { channel, reference: text(formData, "reference") || null, proofFileId } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/reviews/${cycleId}`);
  return { ok: "Recorded as sent." };
}

/** A type the organization does not review goes straight to release: not in the backend yet. */
export async function submitForReleaseAction(_prev: Result | undefined, _formData: FormData): Promise<Result> {
  return { error: "Releasing a document type without review is not supported yet." };
}
