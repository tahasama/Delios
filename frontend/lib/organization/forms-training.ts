"use server";

import { revalidatePath } from "next/cache";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { api, refusal } from "@/lib/client";
import { setProjectSetting } from "@/lib/settings/api";
import { applyDefaults } from "@/lib/organization/defaults";

type Result = { error?: string; ok?: string };
type Opened = { id: string; code: string; name: string; organizations: { id: string }[] };

/**
 * The training space (docs/APP-DECISIONS.md §84) is set up as any new project is: what it is (PROJECT_INFO) and the
 * organization's answers for new projects; its lists, numbering, forms and functions are the organization's, read live.
 */
async function setUp(opened: Opened) {
  await setProjectSetting(opened.id, "PROJECT_INFO", JSON.stringify({
    kind: "GENERIC", startDate: new Date().toISOString().slice(0, 10), endDate: null,
    description: "The organization's training space: nothing in it is real, and no email leaves it.",
    scopeStatement: "Practice only: documents, reviews and transmittals made here are not controlled information.",
  }));
  await applyDefaults(opened.id);
}

function refresh() {
  revalidatePath("/organization", "layout");
  revalidatePath("/", "layout");
}

/** Opens the training space, with one made-up organization for each role. Administrators only. */
export async function openTrainingAction(_prev: Result | undefined, _formData: FormData): Promise<Result> {
  await requireOrgAdmin();
  try {
    const opened = await api<Opened>("/api/admin/training", { body: {} });
    await setUp(opened);
    refresh();
    return { ok: `${opened.code} is open, with ${opened.organizations.length} made-up organization(s), one for each role. Put trainees on it from People; open it from the project list in the top bar.` };
  } catch (e) {
    return { error: refusal(e).message };
  }
}

/** Puts the training space away (archived, out of every list, nothing deleted) and opens a fresh one. */
export async function trainingAgainAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  await requireOrgAdmin();
  const reason = String(formData.get("reason") ?? "").trim();
  try {
    const opened = await api<Opened>("/api/admin/training/again", { body: { reason: reason || null } });
    await setUp(opened);
    refresh();
    return { ok: `Started again: ${opened.code} is open and empty. The old one is put away, nothing deleted. Put trainees on the new one from People.` };
  } catch (e) {
    return { error: refusal(e).message };
  }
}
