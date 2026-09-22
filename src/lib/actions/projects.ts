"use server";

import { STANDARD_VERSION } from "@/lib/standard";

import { revalidatePath } from "next/cache";
import { requireAdminScope, setActiveProject } from "@/lib/scope";
import { audit } from "@/lib/audit";
import { functionForRole } from "@/lib/bootstrap";
import { db as bare } from "@/lib/db";
import { tenantFor } from "@/lib/tenant";
import { profileForKind, draftProfile, PROJECT_KINDS } from "@/lib/profiles";

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
  const startDate = String(formData.get("startDate") ?? "").trim();
  const scopeStatement = String(formData.get("scopeStatement") ?? "").trim();
  const copyPeople = formData.get("copyPeople") === "on";

  if (!name) return { error: "Give the project a name people will recognise." };
  if (!CODE.test(code)) {
    return { error: "The code is short and uppercase — letters, digits and hyphens, e.g. P2 or NORTH-2." };
  }
  if (!PROJECT_KINDS.some((k) => k.code === kind)) {
    return { error: "Choose a project type." };
  }

  const clash = await db.project.findFirst({ where: { orgId, code } });
  if (clash) return { error: `${code} is already used by “${clash.name}”. Codes are unique within your organization.` };

  const organization = await bare.organization.findUniqueOrThrow({ where: { id: orgId } });

  const project = await db.project.create({
    data: {
      orgId,
      code,
      name,
      kind,
      startDate: startDate ? new Date(`${startDate}T00:00:00.000Z`) : new Date(),
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

  revalidatePath("/admin/projects", "layout");
  return {
    ok: `${code} opened${carried ? ` with ${carried} person(s) carried over` : ""}. Switch to it from the picker at the top left.${drafts.drafted.length ? ` The ${profile!.name} starter values are drafted for approval in Settings → Controlled changes (${drafts.drafted.join(", ")}).` : ""}`,
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
  revalidatePath("/admin/projects", "layout");
  return { ok: `${project.code} is now ${status.toLowerCase()}.` };
}

/** Switch to a project straight from the list. */
export async function openProjectAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminScope();
  const projectId = String(formData.get("projectId") ?? "");
  await setActiveProject(projectId, ctx.user.id);
  revalidatePath("/", "layout");
}
