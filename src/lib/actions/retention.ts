"use server";

/**
 * Distribution rules, legal hold and disposal. Who receives a document comes
 * from the backend's distribution matrix, set up there; legal hold and disposal
 * are not in the backend (nothing is removed but by the app owner).
 */

type Result = { error?: string };

export async function saveDistributionRuleAction(_prev: Result | undefined, _formData: FormData): Promise<Result> {
  return { error: "Editing distribution rules here is not supported yet." };
}

export async function deleteDistributionRuleAction(_formData: FormData) {
  // Distribution rules are not edited here yet.
}

// ── §13.5 Disposal & legal hold ──────────────────────────────────────────────

export async function setLegalHoldAction(_prev: Result | undefined, _formData: FormData): Promise<Result> {
  return { error: "Legal hold is not supported yet." };
}

export async function disposeDocumentAction(_prev: Result | undefined, _formData: FormData): Promise<Result> {
  return { error: "Documents are not disposed of: only the app owner removes anything." };
}
