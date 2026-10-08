"use server";

import { PROJECT_KINDS } from "@/lib/profiles";
import { isContractRole } from "@/lib/contract-roles";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrgAdmin } from "@/lib/org-scope";
import { setActiveProject } from "@/lib/scope";
import { api, refusal } from "@/lib/api/client";
import { adminFunctions, adminParties, adminUsers } from "@/lib/api/admin";
import { orgSettings, setOrgSetting, setProjectSetting } from "@/lib/api/settings";

export type SetupState = { error?: string; ok?: string };

const CODE = /^[A-Z0-9][A-Z0-9-]{0,15}$/;

/** The function somebody added before any project existed will hold, until the first project opens: PENDING_FUNCTION:<userId>. */
const PENDING = "PENDING_FUNCTION:";

/**
 * Open the organization's first project, from the setup surface where no
 * project exists yet. Once this succeeds the ordinary app becomes reachable.
 */
export async function openFirstProjectAction(_prev: SetupState | undefined, formData: FormData): Promise<SetupState> {
  const scope = await requireOrgAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const kind = String(formData.get("kind") ?? "GENERIC");
  const role = String(formData.get("role") ?? "GENERIC");
  if (!name) return { error: "Give the project a name people will recognise." };
  if (!CODE.test(code)) return { error: "The code is short and uppercase — letters, digits and hyphens, e.g. P1." };
  if (!PROJECT_KINDS.some((k) => k.code === kind)) return { error: "Choose a project type." };
  if (!(await isContractRole(null, scope.orgId, role))) return { error: "Choose what this organization does on the project." };

  let projectId: string;
  try {
    // Whoever opens it is on it, as Document Control.
    projectId = (await api<{ id: string }>("/api/admin/projects", { body: { code, name, contractRole: role } })).id;
    await setProjectSetting(projectId, "PROJECT_INFO", JSON.stringify({
      kind, startDate: new Date().toISOString().slice(0, 10), endDate: null,
      scopeStatement: `All controlled information produced or received for ${name}, in any medium.`,
    }));
    // Everyone already in the organization joins, holding the function they were
    // given. Otherwise the people you just added would sit outside the first
    // project and see nothing.
    const pending = await orgSettings();
    for (const person of await adminUsers()) {
      const functionId = pending.get(PENDING + person.id);
      if (!functionId || !person.active || person.id === scope.user.id) continue;
      await api(`/api/admin/projects/${projectId}/members`, { method: "PUT", body: { userId: person.id, functionId, active: true } });
      await setOrgSetting(PENDING + person.id, null);
    }
  } catch (e) {
    return { error: refusal(e).message };
  }
  await setActiveProject(projectId, scope.user.id);
  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Add an account before any project exists. The function is recorded on the
 * account now; the membership that carries it is created when the first
 * project opens.
 */
export async function addPersonAction(_prev: SetupState | undefined, formData: FormData): Promise<SetupState> {
  const scope = await requireOrgAdmin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const functionId = String(formData.get("functionId") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!name || !email) return { error: "Name and email are required." };
  if (password.length < 8) return { error: "The password must be at least 8 characters." };
  const fn = (await adminFunctions()).find((one) => one.id === functionId && one.active);
  if (!fn) return { error: "Choose the function this person will hold." };
  const ours = (await adminParties()).find((one) => one.isInternal);
  try {
    const created = await api<{ id: string }>("/api/admin/users", { body: { name, email, password, partyId: ours?.id ?? null } });
    await setOrgSetting(PENDING + created.id, fn.id);
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/setup");
  return { ok: `${name} can sign in now. They join your first project when you open it.` };
}
