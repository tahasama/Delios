"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath, refusal } from "@/lib/client";

type State = { error?: string; ok?: string };

/** Management confirms someone on the project: they join. */
export async function confirmPersonAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const id = String(formData.get("membershipId") ?? "");
  try {
    await api(projectPath(ctx, `/people/${id}/confirm`), { method: "POST" });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/people/confirm");
  revalidatePath("/settings/users");
  revalidatePath("/");
  return { ok: "Confirmed: they are on the project." };
}

/** Management refuses someone, with why: they do not join, and whoever added them reads why. */
export async function refusePersonAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const id = String(formData.get("membershipId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { error: "Say why; whoever added them reads it." };
  try {
    await api(projectPath(ctx, `/people/${id}/refuse`), { body: { note } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/people/confirm");
  revalidatePath("/settings/users");
  revalidatePath("/");
  return { ok: "Refused." };
}

/**
 * Asks for someone to join this project: someone with an account (`userId`) or someone new (name, email,
 * organization), with their function, department, why, who confirms, and (Document Control) the email or letter the
 * request came on, kept with it as proof. The backend decides whether it is put on now or asked of management first
 * (`POST /people/requests`), and says which.
 */
export async function askToJoinAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const text = (name: string) => String(formData.get(name) ?? "").trim();
  const { upload, filesOf } = await import("@/lib/documents/api-uploads");
  const proof = filesOf(formData, "proof")[0];
  let result: { held: boolean; said: string; invited: boolean; link: string | null };
  try {
    const proofFileId = proof ? await upload(ctx, { loose: true, proof: true }, proof) : null;
    result = await api(projectPath(ctx, "/people/requests"), {
      body: {
        userId: text("userId") || null,
        name: text("name") || null,
        email: text("email").toLowerCase() || null,
        partyId: text("partyId") || null,
        functionId: text("functionId"),
        department: text("department") || null,
        why: text("why"),
        confirmerId: text("confirmerId") || null,
        proofFileId,
      },
    });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/users");
  revalidatePath("/people/ask");
  revalidatePath("/people/confirm");
  if (result.held) return { ok: `Asked: ${result.said}. They join once confirmed, and are told then.` };
  return {
    ok: `Done: ${result.said}. They are told by notification and email.${result.link ? ` Email is off here: give them this link to choose their password (7 days, once): ${result.link}` : ""}`,
  };
}
