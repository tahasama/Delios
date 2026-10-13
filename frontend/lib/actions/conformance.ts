"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { isController, isAdmin } from "@/lib/auth";
import { runAllChecks } from "@/lib/checks/engine";
import { CHECK_BY_ID } from "@/lib/checks/catalog";
import { api, projectPath, refusal } from "@/lib/api/client";
import { runAndWait, CHECK_OFF_KEY, type DefectView } from "@/lib/api/conformance";
import { setProjectSetting } from "@/lib/api/settings";

/**
 * The checks' acts. The backend runs the checks, keeps the defects and decides
 * who may; these send what the form says and show its refusal word for word.
 */

type Result = { error?: string };
const failed = (e: unknown): Result => ({ error: refusal(e).message });

export async function runChecksAction(): Promise<void> {
  const ctx = await requireScope();
  const { user } = ctx;
  if (!isController(user) && !isAdmin(user)) return;
  try {
    await runAllChecks(ctx, user);
  } catch (e) {
    // Already queued or running: the page shows that run when it is done.
    refusal(e);
  }
  revalidatePath("/conformance");
  revalidatePath("/conformance/checks");
  revalidatePath("/");
}

/** Accept a defect as it is, with the reason on the record; it continues to be counted. */
export async function acceptDefectAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const defectId = String(formData.get("defectId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "Acceptance requires a recorded reason." };
  // The date to look at it again is not kept by the backend.
  try {
    await api(projectPath(ctx, `/defects/${defectId}/accept`), { body: { reason } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/conformance");
  revalidatePath("/conformance/checks");
  return {};
}

/**
 * A defect closes only when the checks, run again, no longer return the item.
 * The backend closes it on that run; this runs them and says whether it did.
 */
export async function closeDefectAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const defectId = String(formData.get("defectId") ?? "");
  try {
    const run = await runAndWait(ctx);
    if (run.status !== "DONE") return { error: run.error ?? "The checks are still running. Look again in a moment." };
    const still = (await api<DefectView[]>(projectPath(ctx, "/defects"))).find((d) => d.id === defectId);
    if (still) return { error: `Closure refused — the check still returns this item. Correct the controlled source, then re-run ${still.checkId}.` };
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/conformance");
  revalidatePath("/conformance/checks");
  return {};
}

/**
 * Switching a check off.
 *
 * An organization is answerable for its own register, so it may decide a check
 * does not apply to it — but only on the record: who decided, when, and why.
 * The backend stops asking, its findings close, and the catalogue says so.
 */
export async function retireCheckAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const { user } = ctx;
  const checkId = String(formData.get("checkId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!CHECK_BY_ID.has(checkId)) return { error: "No such check." };
  if (reason.length < 10) return { error: "Say why it does not apply — the reason is the record." };
  try {
    await api(projectPath(ctx, `/checks/${checkId}/opt-out`), { method: "PUT", body: { reason } });
    // Who decided and when: the backend keeps the reason only.
    await setProjectSetting(ctx.projectId, CHECK_OFF_KEY + checkId, JSON.stringify({ by: user.name, at: new Date().toISOString() }));
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/conformance/checks");
  revalidatePath("/conformance");
  return {};
}

/** Ask it again. */
export async function restoreCheckAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const checkId = String(formData.get("checkId") ?? "");
  try {
    await api(projectPath(ctx, `/checks/${checkId}/opt-out`), { method: "DELETE" });
    await setProjectSetting(ctx.projectId, CHECK_OFF_KEY + checkId, null);
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/conformance/checks");
  revalidatePath("/conformance");
  return {};
}
