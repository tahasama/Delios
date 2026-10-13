"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { api, projectPath, refusal } from "@/lib/api/client";

/**
 * The register views somebody keeps.
 *
 * A view is a name and the address that produced it — the filters already live
 * in the query string, so nothing is copied and nothing goes stale. They are
 * per person: the question the piping lead asks every morning is not the
 * question Document Control asks, and a shared list would fill with both.
 */
export async function saveRegisterView(formData: FormData) {
  const ctx = await requireScope();
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  // Which page somebody happened to be on is not part of the question.
  const asked = new URLSearchParams(String(formData.get("query") ?? "").replace(/^\?/, ""));
  asked.delete("page");
  const query = asked.toString().slice(0, 2000);
  if (!name) return;

  // Saving under a name that is taken replaces it: the reader is refining the
  // same view, not collecting duplicates of it.
  try {
    await api(projectPath(ctx, "/register/views"), { method: "PUT", body: { name, query } });
  } catch (e) {
    // The form has nowhere to say why; the list simply stays as it was.
    refusal(e);
    return;
  }
  revalidatePath("/documents");
}

export async function deleteRegisterView(formData: FormData) {
  const ctx = await requireScope();
  const id = String(formData.get("id") ?? "");
  // A view belongs to the person who kept it, and to nobody else: the backend
  // removes only one of their own.
  try {
    await api(projectPath(ctx, `/register/views/${id}`), { method: "DELETE" });
  } catch (e) {
    refusal(e);
    return;
  }
  revalidatePath("/documents");
}
