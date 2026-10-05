"use server";

import { STANDARD_VERSION } from "@/lib/standard";

import { revalidatePath } from "next/cache";
import { formPolicy, checkForm } from "@/lib/field-policy";
import { requireAdminScope, setActiveProject } from "@/lib/scope";
import { audit } from "@/lib/audit";
import { functionForRole } from "@/lib/bootstrap";
import { db as bare } from "@/lib/db";
import { tenantFor } from "@/lib/tenant";
import { profileForKind, draftProfile, PROJECT_KINDS } from "@/lib/profiles";
import { contractRoleOptions } from "@/lib/contract-roles";
import { publishRoleMatrix } from "@/lib/profiles/publish-roles";

export type ProjectState = { error?: string; ok?: string };

const CODE = /^[A-Z0-9][A-Z0-9-]{0,15}$/;

/**
 * Open a project. Everything controlled lives in one, so this is the act that
 * creates a register — with its own numbering counters, its own scope
 * statement (§1.6) and its own people.
 *
 * Configuration is not copied: value sets, schemes and the permission matrix
 * are published once per organization and shared by every project it runs.
 */
export async function createProjectAction(
  _prev: ProjectState | undefined,
  formData: FormData,
): Promise<ProjectState> {
  const ctx = await requireAdminScope();
  const { db, orgId, user: admin } = ctx;

  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const kind = String(formData.get("kind") ?? "GENERIC");
  const role = String(formData.get("role") ?? "GENERIC");
  const startDate = String(formData.get("startDate") ?? "").trim();
  const endDate = String(formData.get("endDate") ?? "").trim();
  const scopeStatement = String(formData.get("scopeStatement") ?? "").trim();
  const copyPeople = formData.get("copyPeople") === "on";

  if (!name) return { error: "Give the project a name people will recognise." };
  if (!CODE.test(code)) {
    return { error: "The code is short and uppercase — letters, digits and hyphens, e.g. P2 or NORTH-2." };
  }
  if (!PROJECT_KINDS.some((k) => k.code === kind)) {
    return { error: "Choose a project type." };
  }
  const roleOptions = await contractRoleOptions(bare, orgId);
  const chosenRole = roleOptions.find((r) => r.code === role);
  if (!chosenRole) {
    return { error: "Choose what this organization does on the project." };
  }
  if (startDate && endDate && endDate < startDate) {
    return { error: "The end date cannot fall before the start date." };
  }

  // What this organization asks of a project, and the fields it added itself.
  const policy = await formPolicy(ctx, "PROJECT");
  const asked = checkForm("PROJECT", policy, { code, name, kind, role, startDate, endDate, scopeStatement }, (n) => String(formData.get(n) ?? ""));
  if (asked.error) return { error: asked.error };

  const clash = await db.project.findFirst({ where: { orgId, code } });
  if (clash) return { error: `${code} is already used by “${clash.name}”. Codes are unique within your organization.` };

  const organization = await bare.organization.findUniqueOrThrow({ where: { id: orgId } });

  const project = await db.project.create({
    data: {
      orgId,
      code,
      name,
      kind,
      role,
      startDate: startDate ? new Date(`${startDate}T00:00:00.000Z`) : new Date(),
      endDate: endDate ? new Date(`${endDate}T00:00:00.000Z`) : null,
      extras: Object.keys(asked.extras).length ? JSON.stringify(asked.extras) : null,
    },
  });

  // §1.6 — a project is measured against the scope it states for itself.
  await db.scopeConfig.create({
    data: {
      projectId: project.id,
      organizationName: organization.name,
      scopeStatement:
 scopeStatement || `All controlled information produced or received for ${name}, in any medium.`,
      assessmentLevel: "Core: identity and control",
      standardVersion: STANDARD_VERSION,
      effectiveDate: new Date(),
    },
  });

  // The person opening it is on it, or nobody could reach it.
  const adminFunction = await functionForRole(bare, orgId, "ADMIN");
  if (!adminFunction) return { error: "No Administrator function is published in your organization." };
  await db.projectMembership.create({
    data: { projectId: project.id, userId: admin.id, functionId: adminFunction.id },
  });

  let carried = 0;
  if (copyPeople) {
    // Same people, same functions, on the new project. Far quicker than adding
    // a project team one row at a time, and easy to prune afterwards.
    const existing = await db.projectMembership.findMany({
      where: { projectId: ctx.projectId, active: true, userId: { not: admin.id } },
      select: { userId: true, functionId: true },
    });
    if (existing.length) {
      await db.projectMembership.createMany({
        data: existing.map((m) => ({ projectId: project.id, userId: m.userId, functionId: m.functionId })),
      });
      carried = existing.length;
    }
  }

  await audit({
    actor: admin,
    action: "PROJECT_OPENED",
    entityType: "Project",
    entityId: project.id,
    entityLabel: `${code} — ${name}`,
    detail: `Project opened${carried ? `; ${carried} person(s) carried over from ${ctx.project.code}` : ""}. Configuration is shared organization-wide.`,
  });

  // A project type the organization has not run before brings its starter
  // values — as drafts to approve, never published by opening a project (§4.7).
  const profile = profileForKind(kind);
  const drafts = profile ? await draftProfile(tenantFor(orgId, project.id), profile) : { drafted: [], skipped: [] };

  // The contract role brings its starting matrix: the outside functions it
  // names, and rows that apply on projects of this role only. Seeded, never
  // rewritten, so a matrix already corrected for this role is left alone.
  const seeded = await publishRoleMatrix(bare, orgId, role);
  if (seeded.rules) {
    await audit({
      actor: admin,
      action: "MATRIX_ROLE_PUBLISHED",
      entityType: "Project",
      entityId: project.id,
      entityLabel: `${code} — ${name}`,
      detail: `${chosenRole.label} starting matrix published: ${seeded.rules} rule(s)${seeded.functions ? `, ${seeded.functions} function(s)` : ""}. Correct it through the matrix review route.`,
    });
  }

  revalidatePath("/settings/projects", "layout");
  return {
    ok: `${code} opened${carried ? ` with ${carried} person(s) carried over` : ""}. Switch to it from the picker at the top left.${seeded.rules ? ` The ${chosenRole.label} starting matrix is published — ${seeded.rules} row(s) to check in the distribution matrix.` : ""}${drafts.drafted.length ? ` The ${profile!.name} starter values are drafted for approval in Settings → Controlled changes (${drafts.drafted.join(", ")}).` : ""}`,
  };
}

/** Archive a project, or bring it back. Nothing is deleted. */
export async function setProjectStatusAction(
  _prev: ProjectState | undefined,
  formData: FormData,
): Promise<ProjectState> {
  const ctx = await requireAdminScope();
  const { db, orgId, user: admin } = ctx;

  const projectId = String(formData.get("projectId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (status !== "ACTIVE" && status !== "ARCHIVED") return { error: "Choose active or archived." };

  const project = await db.project.findFirst({ where: { id: projectId, orgId } });
  if (!project) return { error: "That project is not in your organization." };

  if (status === "ARCHIVED") {
    const others = await db.project.count({ where: { orgId, status: "ACTIVE", id: { not: projectId } } });
    if (!others) return { error: "This is your only active project — archiving it would leave nobody anywhere to work." };
  }

  await db.project.update({ where: { id: project.id }, data: { status } });
  await audit({
    actor: admin,
    action: status === "ARCHIVED" ? "PROJECT_ARCHIVED" : "PROJECT_REOPENED",
    entityType: "Project",
    entityId: project.id,
    entityLabel: `${project.code} — ${project.name}`,
    oldValue: project.status,
    newValue: status,
 detail: "Archiving hides a project from the picker; its register is kept in full.",
  });
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
 * Rename a project, or change its code. The code appears inside every document
 * number already allocated, so those numbers do not change: the code only
 * decides what new numbers look like. Saying so out loud is the point of the
 * warning on the form.
 */
export async function renameProjectAction(_prev: ProjectState | undefined, formData: FormData): Promise<ProjectState> {
  const ctx = await requireAdminScope();
  const { db, user } = ctx;
  const projectId = String(formData.get("projectId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  if (!name) return { error: "A project needs a name." };
  if (!CODE.test(code)) return { error: "A code is letters, digits and hyphens — up to 16 characters, e.g. NP1." };
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) return { error: "Project not found." };
  if (code !== project.code) {
    const clash = await db.project.findFirst({ where: { orgId: ctx.orgId, code, NOT: { id: projectId } } });
    if (clash) return { error: `${code} is already used by another project.` };
  }
  await db.project.update({ where: { id: projectId }, data: { name, code } });
  await audit({
    actor: user, action: "PROJECT_RENAMED", entityType: "Project", entityId: projectId, entityLabel: code,
    oldValue: `${project.code} — ${project.name}`, newValue: `${code} — ${name}`,
    detail: code !== project.code ? "Numbers already allocated keep the old code; new numbers use the new one." : "Name changed.",
  });
  revalidatePath("/settings/projects");
  revalidatePath("/");
  return { ok: code !== project.code ? `Renamed. New numbers will use ${code}; documents already numbered keep ${project.code}.` : "Renamed." };
}
