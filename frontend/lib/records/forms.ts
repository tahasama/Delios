"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath, refusal } from "@/lib/client";

/**
 * From the register opened for an asset (as for an action): what was ticked is linked to it, what was unticked is
 * unlinked. Back on the asset's page, where the result is.
 */
export async function setAssetDocumentsAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const assetId = String(formData.get("assetId") ?? "");
  const add = formData.getAll("add").map(String).filter(Boolean);
  const remove = formData.getAll("remove").map(String).filter(Boolean);
  if (!add.length && !remove.length) return { error: "Nothing changed: tick a document to link it, untick one to unlink it." };
  try {
    await api(projectPath(ctx, `/assets/${assetId}/documents`), { body: { add, remove } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(`/assets/${assetId}`);
  revalidatePath("/assets");
  redirect(`/assets/${assetId}`);
}
