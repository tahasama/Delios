"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";

/**
 * The register views somebody keeps.
 *
 * A view is a name and the address that produced it — the filters already live
 * in the query string, so nothing is copied and nothing goes stale. They are
 * per person: the question the piping lead asks every morning is not the
 * question Document Control asks, and a shared list would fill with both.
 */
export async function saveRegisterView(formData: FormData) {
  const { user, projectId, db } = await requireScope();
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  // Which page somebody happened to be on is not part of the question.
  const asked = new URLSearchParams(String(formData.get("query") ?? "").replace(/^\?/, ""));
  asked.delete("page");
  const query = asked.toString().slice(0, 2000);
  if (!name) return;

  // Saving under a name that is taken replaces it: the reader is refining the
  // same view, not collecting duplicates of it.
  await db.registerView.upsert({
    where: { projectId_userId_name: { projectId, userId: user.id, name } },
    update: { query },
    create: { projectId, userId: user.id, name, query },
  });
  revalidatePath("/documents");
}

export async function deleteRegisterView(formData: FormData) {
  const { user, db } = await requireScope();
  const id = String(formData.get("id") ?? "");
  const view = await db.registerView.findUnique({ where: { id }, select: { userId: true } });
  // A view belongs to the person who kept it, and to nobody else.
  if (!view || view.userId !== user.id) return;
  await db.registerView.delete({ where: { id } });
  revalidatePath("/documents");
}
