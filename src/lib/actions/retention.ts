"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { api, projectPath, refusal } from "@/lib/api/client";

/**
 * Distribution rules, legal hold and disposal. Who receives a document comes
 * from the backend's distribution matrix, set up there. Legal hold is the
 * control function's; disposal is refused (nothing is removed but by the app owner).
 */

type Result = { error?: string };

export async function saveDistributionRuleAction(_prev: Result | undefined, _formData: FormData): Promise<Result> {
  return { error: "Editing distribution rules here is not supported yet." };
}

export async function deleteDistributionRuleAction(_formData: FormData) {
  // Distribution rules are not edited here yet.
}

// ── §13.5 Disposal & legal hold ──────────────────────────────────────────────

export async function setLegalHoldAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const documentId = String(formData.get("documentId") ?? "");
  const on = formData.get("hold") === "on";
  try {
    await api(projectPath(ctx, `/documents/${documentId}/legal-hold`), { body: { on, reason: String(formData.get("reason") ?? "").trim() || null } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(`/documents/${documentId}`);
  return {};
}

export async function disposeDocumentAction(_prev: Result | undefined, _formData: FormData): Promise<Result> {
  return { error: "Documents are not disposed of: only the app owner removes anything." };
}
