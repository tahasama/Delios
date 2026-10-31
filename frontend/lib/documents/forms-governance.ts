"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath, refusal } from "@/lib/client";
import { backendRevision } from "@/lib/documents/api";

/**
 * Records confirmed and corrected, approvals withdrawn, comments reclassified.
 * Each keeps what was there and says what changed; the backend decides who may.
 */

type Result = { error?: string; ok?: string };
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
  return { ok: "Confirmed. The record is fixed from now on; a mistake is put right by a correction." };
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
  return { ok: "The correction is registered as a record of its own, pointing to the one it corrects. Both are kept." };
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
  return { ok: "Withdrawn, with your reason, kept in the document's History." };
}
