"use server";

import { revalidatePath } from "next/cache";
import { api, projectPath, refusal } from "@/lib/client";
import { requireScope } from "@/lib/core/scope";

type Result = { error?: string; ok?: string };

/** Switches a reader on or off for every project (administrators). */
export async function setOrganizationReaderAction(formData: FormData): Promise<void> {
  const key = String(formData.get("key") ?? "");
  await api(`/api/admin/viewers/${encodeURIComponent(key)}`, { method: "PUT", body: { on: formData.get("on") === "on" } });
  revalidatePath("/organization/settings/viewers");
}

/** Switches, on this project, a reader the organization has on (the control function, where it is free). */
export async function setProjectReaderAction(formData: FormData): Promise<void> {
  const ctx = await requireScope();
  const key = String(formData.get("key") ?? "");
  await api(projectPath(ctx, `/viewers/${encodeURIComponent(key)}`), { method: "PUT", body: { on: formData.get("on") === "on" } });
  revalidatePath("/settings/viewers");
}

/**
 * Asks DELIOS for a reader not installed here (Word and PowerPoint, heavy on the server) or not built (a certified DWG
 * reader, paid): kept for the app's owner and emailed to DELIOS. Administrators only (the backend checks).
 */
export async function askReaderAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const what = String(formData.get("what") ?? "");
  const message = String(formData.get("message") ?? "").trim();
  try {
    await api("/api/admin/product-requests", { method: "POST", body: { what, message: message || null } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/organization/settings/viewers");
  return { ok: "Asked. DELIOS answers you by email." };
}
