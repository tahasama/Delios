"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { audit } from "@/lib/audit";
import { PROFILES, draftProfile } from "@/lib/profiles";

type State = { error?: string; ok?: string };

/** Prepare a starter profile's missing values as drafts, for the usual approval. */
export async function draftProfileAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONFIGURE")) return { error: "Publishing value sets needs Configure." };
  const profile = PROFILES.find((p) => p.id === String(formData.get("profile") ?? ""));
  if (!profile) return { error: "Unknown starter profile." };
  const { drafted, skipped } = await draftProfile(ctx, profile);
  if (!drafted.length) return { error: skipped.length ? `A change to ${skipped.join(", ")} is already waiting — decide on it first.` : "Nothing to add: every value is already published." };
  await audit({ actor: ctx.user, action: "PROFILE_DRAFTED", entityType: "ControlledSet", entityId: profile.id, entityLabel: profile.name, detail: `Drafted additions to ${drafted.join(", ")}` });
  revalidatePath("/admin/dmp");
  revalidatePath("/admin/controlled");
  return { ok: `Drafted: ${drafted.join(", ")}. Submit them in Controlled changes; another administrator approves.${skipped.length ? ` Skipped ${skipped.join(", ")} — a change is already waiting there.` : ""}` };
}
