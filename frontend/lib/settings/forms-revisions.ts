"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { api, refusal } from "@/lib/client";
import { adminNumbering, type RevisionSeries } from "@/lib/settings/api-admin";

/**
 * How revisions are named (Settings, Revisions): the schemes and which deliverable type follows which. The backend
 * checks every series and keeps a series revisions already carry (SERIES_IN_USE); the screen only sends what was written.
 */

type Result = { error?: string; ok?: string };
const failed = (e: unknown): Result => ({ error: refusal(e).message });
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

/** The lines of the form, in order: each for a phase, or the default line (no phase). */
function seriesOf(formData: FormData): RevisionSeries[] {
  const rows: RevisionSeries[] = [];
  for (let i = 0; formData.has(`kind_${i}`); i++) {
    rows.push({
      code: text(formData, `code_${i}`).toUpperCase(), label: text(formData, `label_${i}`), phase: text(formData, `phase_${i}`) || null,
      kind: text(formData, `kind_${i}`) || "LETTERS",
      prefix: text(formData, `prefix_${i}`),
      start: text(formData, `start_${i}`),
      width: Number(text(formData, `width_${i}`)) || 0,
      lowercase: formData.get(`lowercase_${i}`) === "on",
      excludedLetters: text(formData, `excluded_${i}`).toUpperCase().split(/[\s,]+/).filter((one) => one.length === 1),
    });
  }
  return rows;
}

/** A new revision scheme. */
export async function createRevisionSchemeAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  await requireScope();
  const name = text(formData, "name");
  if (!name) return { error: "Give the scheme a name." };
  try {
    await api("/api/admin/revisions/schemes", { body: { name, forwardOnly: formData.get("forwardOnly") === "on", series: seriesOf(formData) } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/revisions");
  return { ok: `${name} added. Choose which deliverable types follow it.` };
}

/** A scheme changed: its name, its series, whether it only goes forward, and whether it is the default. */
export async function updateRevisionSchemeAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  await requireScope();
  const id = text(formData, "id");
  try {
    await api(`/api/admin/revisions/schemes/${id}`, {
      method: "PUT",
      body: {
        name: text(formData, "name"), forwardOnly: formData.get("forwardOnly") === "on", series: seriesOf(formData),
        isDefault: formData.get("isDefault") === "on" ? true : null,
      },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/revisions");
  return { ok: "Saved. Revisions already named keep their values." };
}

/** Which scheme each deliverable type follows; none chosen, the default. Only the ones changed are sent. */
export async function routeRevisionSchemeAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  await requireScope();
  const { revisionRouting } = await adminNumbering();
  const changed = formData.getAll("deliverableType").map(String).filter((type) =>
    (text(formData, `scheme_${type}`) || null) !== (revisionRouting.find((r) => r.deliverableType === type)?.schemeId ?? null));
  try {
    for (const deliverableType of changed) {
      await api("/api/admin/revisions/routing", { method: "PUT", body: { deliverableType, schemeId: text(formData, `scheme_${deliverableType}`) || null } });
    }
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/revisions");
  return { ok: changed.length ? `Saved: ${changed.join(", ")}. Documents not revised yet follow it; those already started keep counting the way they began.` : "Nothing changed." };
}
