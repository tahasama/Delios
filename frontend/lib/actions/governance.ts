"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { api, projectPath, refusal } from "@/lib/api/client";
import { backendRevision } from "@/lib/api/legacy";

/**
 * Records confirmed and corrected, approvals withdrawn, comments reclassified.
 * Each keeps what was there and says what changed; the backend decides who may.
 */

type Result = { error?: string };
const failed = (e: unknown): Result => ({ error: refusal(e).message });

// ── §2.2–2.4 Records: confirmed, fixed, never revised; corrections are new records ──

export async function confirmRecordAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const documentId = String(formData.get("documentId") ?? "");
  try {
    await api(projectPath(ctx, `/documents/${documentId}/confirm`), { method: "POST" });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/documents/${documentId}`);
  return {};
}

/** §2.3 — a correction is a NEW record referencing the record corrected; both retained. */
export async function correctRecordAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const documentId = String(formData.get("documentId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "The correction needs its own descriptive title." };
  try {
    await api(projectPath(ctx, `/documents/${documentId}/correction`), { body: { title } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/documents/${documentId}`);
  return {};
}

// ── §8.7 Withdrawal of approval ─────────────────────────────────────────────

export async function withdrawApprovalAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const revisionId = String(formData.get("revisionId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "A withdrawal is recorded with its reason." };
  let documentId: string;
  try {
    documentId = (await backendRevision(ctx, revisionId)).documentId;
    await api(projectPath(ctx, `/revisions/${revisionId}/withdraw-approval`), { body: { reason } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/documents/${documentId}`);
  return {};
}

// ── §9.6 Reclassification: the executing party may force it ────────────────

export async function reclassifyCommentAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const commentId = String(formData.get("commentId") ?? "");
  const cycleId = String(formData.get("cycleId") ?? "");
  try {
    await api(projectPath(ctx, `/reviews/${cycleId}/comments/${commentId}/reclassify`), {
      body: { blocking: formData.get("prevent") === "on", note: String(formData.get("note") ?? "").trim() || null },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/reviews/${cycleId}`);
  return {};
}
