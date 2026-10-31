"use server";

import { revalidatePath } from "next/cache";
import { api, refusalForForm } from "@/lib/client";

type Result = { error?: string; ok?: string; fields?: string[] };
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

/** A request to DELIOS support: its kind, a subject, a message; who, which organization and which project are known. */
export async function askSupportAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const missing = ["kind", "subject", "message"].filter((name) => !text(formData, name));
  if (missing.length) return { error: "Say what it is about, give it a subject and write what happened.", fields: missing };
  try {
    await api("/api/support/requests", {
      body: { kind: text(formData, "kind"), subject: text(formData, "subject"), message: text(formData, "message"), projectId: text(formData, "projectId") || null },
    });
  } catch (e) {
    return refusalForForm(e);
  }
  revalidatePath("/guide");
  revalidatePath("/organization", "layout");
  return { ok: "Sent to DELIOS support. You are told here and on Notifications when they answer." };
}

/** Writing back on a request (owner: support is a conversation): support is told, as for a new request. */
export async function replySupportAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const message = text(formData, "text");
  if (!message) return { error: "Write your message.", fields: ["text"] };
  try {
    await api(`/api/support/requests/${text(formData, "requestId")}/messages`, { body: { text: message } });
  } catch (e) {
    return refusalForForm(e);
  }
  revalidatePath("/guide");
  revalidatePath("/organization", "layout");
  return { ok: "Sent: support reads it with the rest of the conversation." };
}
