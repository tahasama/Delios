"use server";

/**
 * Records confirmed and corrected, approvals withdrawn, comments reclassified.
 * None of these acts is in the backend yet; each answers so, and the screen
 * shows it where it shows any refusal.
 */

type Result = { error?: string };

// ── §2.2–2.4 Records: confirmed, fixed, never revised; corrections are new records ──

export async function confirmRecordAction(_prev: Result | undefined, _formData: FormData): Promise<Result> {
  return { error: "Confirming a record is not supported yet." };
}

/** §2.3 — a correction is a NEW record referencing the record corrected; both retained. */
export async function correctRecordAction(_prev: Result | undefined, _formData: FormData): Promise<Result> {
  return { error: "Correcting a record is not supported yet." };
}

export async function withdrawApprovalAction(_prev: Result | undefined, _formData: FormData): Promise<Result> {
  return { error: "Withdrawing an approval is not supported yet." };
}

export async function reclassifyCommentAction(_prev: Result | undefined, _formData: FormData): Promise<Result> {
  return { error: "Reclassifying a comment is not supported yet." };
}
