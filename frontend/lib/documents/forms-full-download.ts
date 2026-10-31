"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { api, refusalForForm } from "@/lib/client";

/** Asks for a full download: the backend fixes what the person may read now, and the worker makes the zip. */
export async function askFullDownloadAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string; fields?: string[] }> {
  const ctx = await requireScope();
  const whole = String(formData.get("scope") ?? "") === "organization";
  const layout = String(formData.get("layout") ?? "TREE");
  const levels = formData.getAll("level").map(String).filter(Boolean);
  try {
    const asked = await api<{ documents: number; leftOut: string[] }>("/api/full-downloads", {
      body: {
        projectId: whole ? null : ctx.project.id,
        layout,
        levels: layout === "LEVELS" ? [...new Set(levels)] : [],
        register: formData.get("register") === "on",
        reviews: formData.get("reviews") === "on",
        transmittals: formData.get("transmittals") === "on",
        audit: formData.get("audit") === "on",
      },
    });
    revalidatePath("/full-download");
    return { ok: `Being made: ${asked.documents} documents. You are told when it is ready.${asked.leftOut.length ? ` Left out: ${asked.leftOut.join("; ")}.` : ""}` };
  } catch (e) {
    return refusalForForm(e);
  }
}
