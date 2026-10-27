"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath, refusal } from "@/lib/client";
import { once } from "@/lib/core/once";

type State = { error?: string; ok?: string };

/** Sends a notice to the people chosen, about one matter; the backend keeps it, so the next one counts from the first. */
export async function sendNoticeAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const people = formData.getAll("people").map(String).filter(Boolean);
  if (!people.length) return { error: "Choose at least one person." };
  const link = String(formData.get("link") ?? "");
  try {
    await api(projectPath(ctx, "/notices"), {
      body: {
        subject: String(formData.get("subject") ?? ""),
        title: String(formData.get("title") ?? ""),
        body: String(formData.get("body") ?? "").trim() || null,
        link: link || null,
        // A supplier's people cannot open the schedule: they are sent to their own document.
        outsideLink: String(formData.get("outsideLink") ?? "") || null,
        people,
      },
      idempotencyKey: once(formData, "notice"),
    });
  } catch (e) {
    return { error: refusal(e).message };
  }
  if (link.startsWith("/")) revalidatePath(link);
  return { ok: `Sent to ${people.length} ${people.length === 1 ? "person" : "people"}.` };
}
