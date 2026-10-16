"use server";

import { applyDefaults } from "@/lib/organization/defaults";

import { revalidatePath } from "next/cache";
import { formPolicy, checkForm } from "@/lib/settings/field-policy";
import { requireAdminScope, setActiveProject } from "@/lib/core/scope";
import { PROJECT_KINDS } from "@/lib/settings/profiles";
import { contractRoleOptions } from "@/lib/settings/contract-roles";
import { api, refusal } from "@/lib/client";
import { projectSettings, setProjectSetting } from "@/lib/settings/api";
import { adminProjects, adminUsers } from "@/lib/settings/api-admin";

type ProjectState = { error?: string; ok?: string };

const CODE = /^[A-Z0-9][A-Z0-9-]{0,15}$/;

/** What a project says about itself that the backend has no column for: its type, dates and scope statement, in its settings. */
const PROJECT_INFO = "PROJECT_INFO";

/**
 * Open a project. Everything controlled lives in one, so this is the act that
 * creates a register — with its own numbering counters, its own scope
 * statement (§1.6) and its own people.
 *
 * Configuration is not copied: value sets, schemes and the permission matrix
 * are published once per organization and shared by every project it runs.
 */
export async function createProjectAction(_prev: ProjectState | undefined, formData: FormData): Promise<ProjectState> {
  const ctx = await requireAdminScope();
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const kind = String(formData.get("kind") ?? "GENERIC");
  const role = String(formData.get("role") ?? "GENERIC");
  const startDate = String(formData.get("startDate") ?? "").trim();
  const endDate = String(formData.get("endDate") ?? "").trim();
  const scopeStatement = String(formData.get("scopeStatement") ?? "").trim();
  const copyPeople = formData.get("copyPeople") === "on";
  if (!name) return { error: "A project needs a name." };
  if (!CODE.test(code)) return { error: "A code is letters, digits and hyphens — up to 16 characters, e.g. NP1." };
  if (!PROJECT_KINDS.some((k) => k.code === kind)) return { error: "Choose a project type." };
  const chosenRole = (await contractRoleOptions()).find((r) => r.code === role);
  if (!chosenRole) return { error: "Choose what this organization does on the project." };
  if (startDate && endDate && endDate < startDate) return { error: "The end date cannot fall before the start date." };
  // What this organization asks of a project.
  const policy = await formPolicy(ctx, "PROJECT");
  const asked = checkForm("PROJECT", policy, { code, name, kind, role, startDate, endDate, scopeStatement }, (n) => String(formData.get(n) ?? ""));
  if (asked.error) return { error: asked.error };

  let carried = 0;
  try {
    const project = await api<{ id: string }>("/api/admin/projects", { body: { code, name, contractRole: role, kind } });
    // §1.6 — a project is measured against the scope it states for itself.
    await setProjectSetting(project.id, PROJECT_INFO, JSON.stringify({
      kind, startDate: startDate || new Date().toISOString().slice(0, 10), endDate: endDate || null,
      scopeStatement: scopeStatement || `All controlled information produced or received for ${name}, in any medium.`,
    }));
    // The organization's defaults: who does what and how a project works, until the project changes them.
    await applyDefaults(project.id);
    if (copyPeople) {
      // Same people, same functions, on the new project. Far quicker than adding
      // a project team one row at a time, and easy to prune afterwards.
      for (const person of await adminUsers()) {
        const seat = person.memberships.find((m) => m.projectId === ctx.projectId && m.active);
        if (!seat || person.id === ctx.user.id) continue;
        await api(`/api/admin/projects/${project.id}/members`, {
          method: "PUT", body: { userId: person.id, functionId: seat.functionId, department: seat.department, active: true },
        });
        carried++;
      }
    }
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/projects", "layout");
  return { ok: `${code} opened${carried ? ` with ${carried} person(s) carried over` : ""}. Switch to it from the picker at the top left.` };
}

/** Archive a project, or bring it back, always with why (kept on its line). Nothing is deleted. */
export async function setProjectStatusAction(_prev: ProjectState | undefined, formData: FormData): Promise<ProjectState> {
  await requireAdminScope();
  const projectId = String(formData.get("projectId") ?? "");
  const status = String(formData.get("status") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (status !== "ACTIVE" && status !== "ARCHIVED") return { error: "Choose active or archived." };
  if (!reason) return { error: "Say why: it is kept on the project's line." };
  const projects = await adminProjects();
  const project = projects.find((one) => one.id === projectId);
  if (!project) return { error: "That project is not in your organization." };
  if (status === "ARCHIVED" && !projects.some((one) => one.status === "ACTIVE" && one.id !== projectId)) {
    return { error: "This is your only active project — archiving it would leave nobody anywhere to work." };
  }
  try {
    await api(`/api/admin/projects/${projectId}`, { method: "PUT", body: { status, reason } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/projects", "layout");
  return { ok: `${project.code} is now ${status.toLowerCase()}.` };
}

/** Switch to a project straight from the list. */
export async function openProjectAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminScope();
  const projectId = String(formData.get("projectId") ?? "");
  await setActiveProject(projectId, ctx.user.id);
  revalidatePath("/", "layout");
}

/**
 * Change a project's line: its name and code, type and our role, dates and scope statement. The code appears inside
 * every document number already allocated, so those numbers do not change: the code only decides what new numbers
 * look like, and the form says so.
 */
export async function saveProjectAction(_prev: ProjectState | undefined, formData: FormData): Promise<ProjectState> {
  await requireAdminScope();
  const projectId = String(formData.get("projectId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const kind = String(formData.get("kind") ?? "GENERIC");
  const role = String(formData.get("role") ?? "GENERIC");
  const startDate = String(formData.get("startDate") ?? "").trim();
  const endDate = String(formData.get("endDate") ?? "").trim();
  const scopeStatement = String(formData.get("scopeStatement") ?? "").trim();
  if (!name) return { error: "A project needs a name." };
  if (!CODE.test(code)) return { error: "A code is letters, digits and hyphens — up to 16 characters, e.g. NP1." };
  if (!PROJECT_KINDS.some((k) => k.code === kind)) return { error: "Choose a project type." };
  if (!(await contractRoleOptions()).some((r) => r.code === role)) return { error: "Choose what this organization does on the project." };
  if (startDate && endDate && endDate < startDate) return { error: "The end date cannot fall before the start date." };
  const project = (await adminProjects()).find((one) => one.id === projectId);
  if (!project) return { error: "That project is not in your organization." };
  try {
    await api(`/api/admin/projects/${projectId}`, { method: "PUT", body: { code, name, contractRole: role, kind } });
    let info: Record<string, unknown> = {};
    try { info = JSON.parse((await projectSettings(projectId)).get(PROJECT_INFO) ?? "{}"); } catch { info = {}; }
    await setProjectSetting(projectId, PROJECT_INFO, JSON.stringify({
      ...info, kind, startDate: startDate || info.startDate || project.createdAt.slice(0, 10), endDate: endDate || null,
      scopeStatement: scopeStatement || `All controlled information produced or received for ${name}, in any medium.`,
    }));
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/projects");
  revalidatePath("/");
  return { ok: code !== project.code ? `Saved. New numbers will use ${code}; documents already numbered keep ${project.code}.` : "Saved." };
}
