"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { refusal } from "@/lib/client";
import { PROFILES, draftProfile } from "@/lib/settings/profiles";

type State = { error?: string; ok?: string };

/** Add a starter profile's missing values to the lists, as the profile has them. */
export async function draftProfileAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONFIGURE")) return { error: "Publishing value sets needs Configure." };
  const profile = PROFILES.find((p) => p.id === String(formData.get("profile") ?? ""));
  if (!profile) return { error: "Unknown starter profile." };
  let drafted: string[];
  try {
    ({ drafted } = await draftProfile(ctx, profile));
  } catch (e) {
    return { error: refusal(e).message };
  }
  if (!drafted.length) return { error: "Nothing to add: every value is already there." };
  revalidatePath("/settings/dmp");
  revalidatePath("/settings/config");
  return { ok: `Added the ${profile.name} values to: ${drafted.join(", ").toLowerCase().replaceAll("_", " ")}. Rename or retire any of them in Disciplines, types & sets.` };
}
