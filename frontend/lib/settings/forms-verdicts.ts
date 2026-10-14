"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { api, refusal } from "@/lib/client";

/**
 * Verdict lists (Settings, Verdict lists): a list and its verdicts, each with what it means, sent in one go. The backend
 * checks every verdict has a meaning and that one lets a revision be released (`VerdictListEndpoints`).
 */

type Result = { error?: string; ok?: string };
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

/** The verdict rows of the form, in order; a row with neither code nor label is left out. */
function verdictsOf(formData: FormData) {
  const rows: { code: string; label: string; meaning: string; retired: boolean }[] = [];
  for (let i = 0; formData.has(`code_${i}`); i++) {
    const code = text(formData, `code_${i}`);
    const label = text(formData, `label_${i}`);
    if (!code && !label) continue;
    rows.push({ code: code || label, label: label || code, meaning: text(formData, `meaning_${i}`), retired: formData.get(`retired_${i}`) === "on" });
  }
  return rows;
}

export async function createVerdictListAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  await requireScope();
  const title = text(formData, "title");
  try {
    await api("/api/admin/verdict-lists", { body: { title, description: text(formData, "description") || null, verdicts: verdictsOf(formData) } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/verdicts");
  revalidatePath("/settings/workflow-templates");
  return { ok: `${title} published. Choose it on a review route.` };
}

export async function updateVerdictListAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  await requireScope();
  const key = text(formData, "key");
  try {
    await api(`/api/admin/verdict-lists/${encodeURIComponent(key)}`, {
      method: "PUT", body: { title: text(formData, "title") || null, description: text(formData, "description") || null, verdicts: verdictsOf(formData) },
    });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/verdicts");
  revalidatePath("/settings/workflow-templates");
  return { ok: "Saved." };
}
