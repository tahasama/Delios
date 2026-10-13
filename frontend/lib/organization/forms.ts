"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, apiFetch, problemOf, projectPath, refusal } from "@/lib/client";
import { createSession } from "@/lib/core/auth";
import { requireScope, rememberProject } from "@/lib/core/scope";

type Result = { error?: string; ok?: string };
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const failed = (e: unknown): Result => ({ error: refusal(e).message });

/** We invite the organization one of our parties stands for, through someone we know there. */
export async function inviteOrganizationAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const partyId = text(formData, "partyId");
  const email = text(formData, "email");
  if (!email) return { error: "Give the email of someone you know there." };
  try {
    await api(`/api/admin/parties/${partyId}/link`, { body: { email } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/parties");
  revalidatePath("/organization");
  return { ok: "Invited. Their administrator accepts or refuses it on their organization's page." };
}

/** Their administrator (us) accepts an invitation to work on another organization's projects. */
export async function acceptLinkAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  try {
    await api(`/api/organization/links/${text(formData, "linkId")}/accept`, { body: { note: text(formData, "note") || null } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/organization");
  revalidatePath("/");
  return { ok: "Accepted. Their projects we take part in now appear under Projects." };
}

/** We refuse an invitation, saying why. */
export async function refuseLinkAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const note = text(formData, "note");
  if (!note) return { error: "Say why: they read it." };
  try {
    await api(`/api/organization/links/${text(formData, "linkId")}/refuse`, { body: { note } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/organization");
  revalidatePath("/");
  return {};
}

/** Either side ends a link (or takes back an invitation not answered yet), saying why. */
export async function endLinkAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const note = text(formData, "note");
  if (!note) return { error: "Say why it ends: the other organization reads it." };
  try {
    await api(`/api/organization/links/${text(formData, "linkId")}/end`, { body: { note } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/organization");
  revalidatePath("/settings/parties");
  return { ok: "Ended. Their accounts on our projects (or ours on theirs) have stopped." };
}

/** Our administrator puts one of our people on a project of another organization's, or takes them off. */
export async function joinPersonAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const linkId = text(formData, "linkId");
  const projectId = text(formData, "projectId");
  const userId = text(formData, "userId");
  if (!userId) return { error: "Choose someone of ours." };
  try {
    await api(`/api/organization/joined/${linkId}/projects/${projectId}/people`, {
      method: "PUT", body: { userId, active: text(formData, "active") !== "off" },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/organization");
  return {};
}

/** Document Control says an organization takes part in this project (or no longer does), its role, and its people's starting function. */
export async function setProjectOrganizationAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const partyId = text(formData, "partyId");
  if (!partyId) return { error: "Choose the organization." };
  try {
    await api(projectPath(ctx, `/organizations/${partyId}`), {
      method: "PUT",
      body: { role: text(formData, "role") || null, startFunctionId: text(formData, "startFunctionId") || null, active: text(formData, "active") !== "off" },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/parties");
  return {};
}

/**
 * Opens a project of another organization's (or goes back home): the backend moves the session onto the account
 * standing for this person there, with the same sign-in. Then that project opens.
 */
export async function switchOrganizationAction(formData: FormData): Promise<void> {
  const tenantId = text(formData, "tenantId");
  const projectId = text(formData, "projectId");
  const response = await apiFetch("/api/auth/switch", { method: "POST", body: { tenantId } });
  if (!response.ok) {
    const problem = await problemOf(response);
    redirect(`/?switchRefused=${encodeURIComponent(problem.message)}`);
  }
  const token = response.headers.getSetCookie().find((c) => c.startsWith("delios_session="))?.slice("delios_session=".length).split(";")[0];
  if (!token) redirect("/login");
  await createSession(token);
  if (projectId) await rememberProject(projectId);
  revalidatePath("/", "layout");
  redirect("/");
}

/** The administrator makes one of our projects' choices (who does what, how it works) the defaults for projects opened afterwards. */
export async function makeDefaultsAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const { requireOrgAdmin } = await import("@/lib/core/org-scope");
  const { defaultsFrom, DEFAULTS_KEY } = await import("@/lib/organization/defaults");
  const { setOrgSetting } = await import("@/lib/settings/api");
  const { adminProjects } = await import("@/lib/settings/api-admin");
  const scope = await requireOrgAdmin();
  const projectId = text(formData, "projectId");
  const project = (await adminProjects().catch(() => [])).find((one) => one.id === projectId);
  if (!project) return { error: "Choose one of our projects." };
  try {
    const values = await defaultsFrom(projectId);
    await setOrgSetting(DEFAULTS_KEY, JSON.stringify({ fromProject: project.code, at: new Date().toISOString(), by: scope.user.name, values }));
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/organization");
  return { ok: `New projects now start with ${project.code}'s choices. Projects already open keep theirs.` };
}

/** A guest account another organization made for one of our people becomes theirs here: same email, same password. */
export async function bringOverAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  try {
    await api(`/api/organization/joined/${text(formData, "linkId")}/guests/${text(formData, "guestId")}/bring`, { body: {} });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/organization");
  return { ok: "Brought over. They sign in here from now on, with the same password, and keep their projects there." };
}
