"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api/client";
import { requireSession, projectPath } from "@/lib/session";

/**
 * The register views somebody keeps: a name and the address that produced it.
 * They are per person and per project, kept by the backend.
 */
export async function saveRegisterView(formData: FormData) {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  if (!name) return;
  await api(projectPath(session, "/register/views"), { method: "PUT", body: { name, query: String(formData.get("query") ?? "") } });
  revalidatePath("/documents");
}

export async function deleteRegisterView(formData: FormData) {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  await api(projectPath(session, `/register/views/${id}`), { method: "DELETE" }).catch(() => undefined);
  revalidatePath("/documents");
}
