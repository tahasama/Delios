"use server";

import { revalidatePath } from "next/cache";
import { getScope } from "@/lib/core/scope";
import { api, projectPath, refusal } from "@/lib/client";
import { adminNumbering, projectRevisions, type RevisionSeries } from "@/lib/settings/api-admin";

/**
 * How revisions are named (Settings, Revisions): the schemes and which deliverable type follows which. The backend
 * checks every series and keeps a series revisions already carry (SERIES_IN_USE); the screen only sends what was written.
 */

type Result = { error?: string; ok?: string };
const failed = (e: unknown): Result => ({ error: refusal(e).message });
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

/**
 * Where a change goes: the organization's naming (its Settings, an administrator), or the project's (only where
 * revisions are free; its first change makes the project's own copy). The backend checks both.
 */
const organization = (formData: FormData) => text(formData, "level") === "organization";
async function base(formData: FormData): Promise<string> {
  if (organization(formData)) return "/api/admin/revisions";
  const scope = await getScope();
  if (!scope) throw new Error("No project is open.");
  return projectPath(scope, "/revisions");
}
function revalidate() {
  revalidatePath("/settings/revisions");
  revalidatePath("/organization/settings/revisions");
}

/** The lines of the form, in order: each for a phase, or the default line (no phase). */
function seriesOf(formData: FormData): RevisionSeries[] {
  const rows: RevisionSeries[] = [];
  for (let i = 0; formData.has(`kind_${i}`); i++) {
    rows.push({
      code: text(formData, `code_${i}`).toUpperCase(), label: text(formData, `label_${i}`), phase: text(formData, `phase_${i}`) || null,
      kind: text(formData, `kind_${i}`) || "LETTERS",
      prefix: text(formData, `prefix_${i}`),
      start: text(formData, `start_${i}`),
      // Small letters and digits are read from the start as written ("a", "01"), by the backend.
      width: 0,
      lowercase: false,
      excludedLetters: text(formData, `excluded_${i}`).toUpperCase().split(/[\s,]+/).filter((one) => one.length === 1),
    });
  }
  return rows;
}

/** A new revision scheme. */
export async function createRevisionSchemeAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const name = text(formData, "name");
  if (!name) return { error: "Give the scheme a name." };
  try {
    await api(`${await base(formData)}/schemes`, { body: { name, forwardOnly: formData.get("forwardOnly") === "on", series: seriesOf(formData) } });
  } catch (e) {
    return failed(e);
  }
  revalidate();
  return { ok: `${name} added. Choose which deliverable types follow it.` };
}

/** A scheme changed: its name, its series, whether it only goes forward, and whether it is the default. */
export async function updateRevisionSchemeAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const id = text(formData, "id");
  try {
    await api(`${await base(formData)}/schemes/${id}`, {
      method: "PUT",
      body: {
        name: text(formData, "name"), forwardOnly: formData.get("forwardOnly") === "on", series: seriesOf(formData),
        isDefault: formData.get("isDefault") === "on" ? true : null,
      },
    });
  } catch (e) {
    return failed(e);
  }
  revalidate();
  return { ok: "Saved. Revisions already named keep their values." };
}

/** Which scheme each deliverable type follows; none chosen, the default. Only the ones changed are sent. */
export async function routeRevisionSchemeAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const { revisionRouting } = organization(formData) ? await adminNumbering() : await projectRevisions();
  const changed = formData.getAll("deliverableType").map(String).filter((type) =>
    (text(formData, `scheme_${type}`) || null) !== (revisionRouting.find((r) => r.deliverableType === type)?.schemeId ?? null));
  try {
    for (const deliverableType of changed) {
      await api(`${await base(formData)}/routing`, { method: "PUT", body: { deliverableType, schemeId: text(formData, `scheme_${deliverableType}`) || null } });
    }
  } catch (e) {
    return failed(e);
  }
  revalidate();
  return { ok: changed.length ? `Saved: ${changed.join(", ")}. Documents not revised yet follow it; those already started keep counting the way they began.` : "Nothing changed." };
}
