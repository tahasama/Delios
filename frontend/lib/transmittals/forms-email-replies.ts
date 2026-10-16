"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath, refusal } from "@/lib/client";

type Result = { error?: string; ok?: string };

/** the control function records a reply by email as received: a transmittal following ours, its files to check. */
export async function recordEmailReplyAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const replyId = String(formData.get("replyId") ?? "");
  let recorded: string;
  try {
    recorded = (await api<{ transmittalId: string }>(projectPath(ctx, `/email-replies/${replyId}/record`), { body: {} })).transmittalId;
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/transmittals");
  revalidatePath("/");
  redirect(`/transmittals/${recorded}`);
}

/** the control function sets a reply by email aside, with why. It is kept on the transmittal. */
export async function setAsideEmailReplyAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const replyId = String(formData.get("replyId") ?? "");
  const transmittalId = String(formData.get("transmittalId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "Say why it is set aside." };
  try {
    await api(projectPath(ctx, `/email-replies/${replyId}/set-aside`), { body: { reason } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(`/transmittals/${transmittalId}`);
  revalidatePath("/");
  return { ok: "Set aside. It stays on the transmittal, with why." };
}
