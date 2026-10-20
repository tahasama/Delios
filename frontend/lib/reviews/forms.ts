"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath, refusal } from "@/lib/client";
import { backendRevision, backendReview } from "@/lib/documents/api";
import { upload, filesOf } from "@/lib/documents/api-uploads";
import { requestFromForm, issueAsk } from "@/lib/transmittals/issue-requests";
import { backendRoute, type EditorRouteStep } from "@/lib/settings/api-admin";

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

/**
 * Where a route change goes: the organization's routes (its Settings, an administrator) or the project's (only where
 * routes are free; its first change makes the project's own copy). The backend checks who may.
 */
async function routesBase(formData: FormData): Promise<string> {
  if (text(formData, "level") === "organization") return "/api/admin/routes";
  return projectPath(await requireScope(), "/routes");
}

function revalidateRoutes() {
  revalidatePath("/settings/workflow-templates");
  revalidatePath("/organization/settings/routes");
}

export async function saveTemplateAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  // "routeId", never "id": a field named id hides the form's own id, and the Save button outside it finds no form.
  const id = text(formData, "routeId");
  const name = text(formData, "name");
  const classes = text(formData, "classes") || "*";
  if (!name) return { error: "Name is required." };
  if (classes !== "*") {
    try {
      const parsed = JSON.parse(classes);
      if (!Array.isArray(parsed) || !parsed.length) return { error: "Choose at least one document class or all documents." };
    } catch {
      return { error: "The document-class scope is invalid." };
    }
  }
  let steps: EditorRouteStep[];
  try { steps = JSON.parse(String(formData.get("steps") ?? "[]")); } catch { return { error: "Steps are not valid JSON." }; }
  if (!Array.isArray(steps) || steps.length === 0) return { error: "Add at least one step." };
  const route = await backendRoute(classes, steps);
  if ("error" in route) return { error: route.error };
  const body = {
    name, description: text(formData, "description") || null, isDefault: formData.get("isDefault") === "on",
    // The set of the review outcomes it decides from; empty: the set serving each document's deliverable type.
    verdicts: text(formData, "outcomeSetKey"),
    // The set of the review advice its advising steps answer from; empty: the set serving each document's deliverable type.
    advice: text(formData, "adviceSetKey"), ...route,
  };
  try {
    const base = await routesBase(formData);
    if (id) await api(`${base}/${id}`, { method: "PUT", body });
    else await api(base, { body });
  } catch (e) {
    return failed(e);
  }
  revalidateRoutes();
  // Saved, the route reads again as it is (the page without the form open).
  redirect(text(formData, "level") === "organization" ? "/organization/settings/routes" : "/settings/workflow-templates");
}

/** A route is taken out of use, never deleted: reviews that ran on it keep its name. */
export async function deleteTemplateAction(formData: FormData) {
  await api(`${await routesBase(formData)}/${text(formData, "id")}`, { method: "PUT", body: { active: false } }).catch(() => undefined);
  revalidateRoutes();
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
  // The people the sender kept or chose on each step: every step names at least one (owner), but another
  // organization answering as itself (one of ours records its answer).
  const people: string[][] = [];
  const empty: string[] = [];
  for (let i = 0; formData.has(`stepShown_${i}`); i++) {
    const chosen = formData.getAll(`participants_${i}`).map(String).filter(Boolean);
    if (!chosen.length && !formData.has(`stepItself_${i}`)) empty.push(`step ${i + 1} (${text(formData, `stepTitle_${i}`) || "untitled"})`);
    people.push(chosen);
  }
  if (empty.length) return { error: `Name who answers ${empty.join(" and ")}: nobody is on ${empty.length > 1 ? "them" : "it"}.` };
  // One key per press of Send: a revision sent again later is a new review, not a replay of the old one.
  // Copied in (cc): told it went out for review and of what comes of it, never asked to answer.
  const copies = [...new Set(formData.getAll("copyUsers").map(String).filter(Boolean))];
  const attempt = text(formData, "attempt") || crypto.randomUUID();
  const sent: string[] = [];
  const opened: string[] = [];
  const refused: string[] = [];
  for (const revisionId of revisionIds) {
    try {
      const revision = await backendRevision(ctx, revisionId);
      const started = await api<{ id: string }>(projectPath(ctx, `/revisions/${revisionId}/reviews`), { body: { routeId, people: people.length ? people : null, copies }, idempotencyKey: `review-${revisionId}-${attempt}` });
      sent.push(`rev ${revision.value}`);
      opened.push(started.id);
      revalidatePath(`/documents/${revision.documentId}`);
    } catch (e) {
      refused.push(refusal(e).message);
    }
  }
  revalidatePath("/"); revalidatePath("/documents");
  if (!sent.length) return { error: refused.join(" · ") || "Nothing was sent." };
  // One review started: open it.
  if (opened.length === 1 && !refused.length) redirect(`/reviews/${opened[0]}`);
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

/**
 * A type the organization does not review goes straight to release: whoever
 * would send it for review settles its status and who receives it. Document
 * Control releases it, or it is released at once where nobody holds that function.
 */
export async function submitForReleaseAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const revisionId = text(formData, "revisionId");
  const status = text(formData, "issuedFor");
  if (!status) return { error: "Choose the status it is released at." };
  const asked = requestFromForm(formData);
  if (asked.needsApproval && !asked.approverId) return { error: "Say which party has to approve it before it is released." };
  const issue = issueAsk(asked);
  let documentId: string;
  try {
    documentId = (await backendRevision(ctx, revisionId)).documentId;
    await api(projectPath(ctx, `/revisions/${revisionId}/send-on`), { body: { status, issue } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/");
  return { ok: "Sent on for release." };
}

/**
 * Which set of Review outcomes a route decides with, changed on its own from the Control room's Review step: a set by
 * name, or empty for the set serving each document's deliverable type. The rest of the route stays as it is.
 */
export async function setRouteVerdictsAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const id = text(formData, "id");
  if (!id) return { error: "Choose a route." };
  try {
    await api(`${projectPath(await requireScope(), "/routes")}/${id}`, { method: "PUT", body: { verdicts: text(formData, "value") } });
  } catch (e) {
    return failed(e);
  }
  revalidateRoutes();
  revalidatePath("/settings/flow");
  return { ok: "Saved: the route decides with that set from now on." };
}
