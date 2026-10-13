"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath, refusal } from "@/lib/api/client";

type State = { error?: string; ok?: string };

const failed = (e: unknown): State => ({ error: refusal(e).message });

/**
 * Step 8 — before the activity, a department confirms its documents are
 * available. Declaring a shortage needs a note, and alerts Document Control.
 */
export async function confirmReadinessAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const actionId = String(formData.get("actionId") ?? "");
  const answer = String(formData.get("available") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  // Available or not is a choice, never a box left as it was; and "not
  // available" is what Document Control is alerted with, so it says why.
  if (answer !== "yes" && answer !== "no") return { error: "Choose Available or Not available." };
  if (answer === "no" && !note) return { error: "Say what is missing, and when it will be there." };
  try {
    await api(projectPath(ctx, `/activities/${actionId}/readiness`), {
      body: {
        department: String(formData.get("department") ?? ""), available: answer === "yes",
        note,
      },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/actions", "layout");
  return { ok: "Recorded." };
}

/** Document Control takes a department's confirmation back (an honest mistake), with why. */
export async function revokeReadinessAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "Say why the confirmation is taken back." };
  try {
    await api(projectPath(ctx, `/activities/${String(formData.get("actionId") ?? "")}/readiness/revoke`), {
      body: { department: String(formData.get("department") ?? ""), reason },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/actions", "layout");
  return { ok: "Taken back. The discipline confirms again." };
}
