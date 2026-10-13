"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { api, projectPath, refusal } from "@/lib/api/client";

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
