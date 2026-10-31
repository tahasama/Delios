"use server";

import { revalidatePath } from "next/cache";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { api, refusal } from "@/lib/client";

type Result = { error?: string; ok?: string };
type Opened = { id: string; code: string; name: string };

function refresh() {
  revalidatePath("/organization", "layout");
  revalidatePath("/", "layout");
}

/** Puts the training space away (archived, out of every list, nothing deleted) and opens a fresh one. */
export async function trainingAgainAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  await requireOrgAdmin();
  const reason = String(formData.get("reason") ?? "").trim();
  try {
    const opened = await api<Opened>("/api/admin/training/again", { body: { reason: reason || null } });
    refresh();
    return { ok: `Started again: ${opened.code} is open and empty. The old one is put away, nothing deleted. Put trainees on it from People.` };
  } catch (e) {
    return { error: refusal(e).message };
  }
}
