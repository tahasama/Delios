"use server";

import { STANDARD_VERSION } from "@/lib/standard";

import { profileForKind, publishProfile, PROJECT_KINDS } from "@/lib/profiles";
import { isContractRole } from "@/lib/contract-roles";
import { publishRoleMatrix } from "@/lib/profiles/publish-roles";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrgAdmin } from "@/lib/org-scope";
import { setActiveProject } from "@/lib/scope";
import { audit, type AuditTenantOptional } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";
import { functionForRole } from "@/lib/bootstrap";
import { db as bare } from "@/lib/db";
import { tenantFor } from "@/lib/tenant";

export type SetupState = { error?: string; ok?: string };

const CODE = /^[A-Z0-9][A-Z0-9-]{0,15}$/;

/**
 * Open the organization's first project, from the setup surface where no
 * project exists yet. Once this succeeds the ordinary app becomes reachable.
 */
export async function openFirstProjectAction(
  _prev: SetupState | undefined,
  formData: FormData,
): Promise<SetupState> {
  const scope = await requireOrgAdmin();
  const { orgId, user: admin, organization } = scope;

  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const kind = String(formData.get("kind") ?? "GENERIC");
  const role = String(formData.get("role") ?? "GENERIC");

  if (!name) return { error: "Give the project a name people will recognise." };
  if (!CODE.test(code)) return { error: "The code is short and uppercase — letters, digits and hyphens, e.g. P1." };
  if (!PROJECT_KINDS.some((k) => k.code === kind)) return { error: "Choose a project type." };
  if (!(await isContractRole(bare, orgId, role))) return { error: "Choose what this organization does on the project." };

  const clash = await bare.project.findFirst({ where: { orgId, code } });
  if (clash) return { error: `${code} is already used by “${clash.name}”.` };

  const project = await bare.project.create({
    data: { orgId, code, name, kind, role, startDate: new Date() },
  });

  await bare.scopeConfig.create({
    data: {
      projectId: project.id,
      organizationName: organization.name,
 scopeStatement: `All controlled information produced or received for ${name}, in any medium.`,
      assessmentLevel: "Core: identity and control",
      standardVersion: STANDARD_VERSION,
      effectiveDate: new Date(),
    },
  });

  // The first project still belongs to setting the organization up: its type's
  // starter values are published with it, as they would have been at signup.
  const profile = profileForKind(kind);
  if (profile) await publishProfile(bare, orgId, profile, "add");

  // What the organization does on the project brings its starting matrix.
  await publishRoleMatrix(bare, orgId, role);

  // Everyone already in the organization joins, holding the function they were
  // given. Otherwise the people you just added would sit outside the first
  // project and see nothing.
  const staff = await bare.user.findMany({
    where: { orgId, active: true },
    select: { id: true, role: true },
  });
  for (const person of staff) {
    const fn = await functionForRole(bare, orgId, person.role);
    if (!fn) continue;
    await bare.projectMembership.create({
      data: { projectId: project.id, userId: person.id, functionId: fn.id },
    });
  }

  await audit({
    tenant: tenantFor(orgId, project.id),
    actor: admin,
    action: "PROJECT_OPENED",
    entityType: "Project",
    entityId: project.id,
    entityLabel: `${code} — ${name}`,
    detail: `First project opened; ${staff.length} member(s) of ${organization.name} joined it.`,
  });

  await setActiveProject(project.id, admin.id);
  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Add an account before any project exists. The function is recorded on the
 * account now; the membership that carries it is created when the first
 * project opens.
 */
export async function addPersonAction(
  _prev: SetupState | undefined,
  formData: FormData,
): Promise<SetupState> {
  const scope = await requireOrgAdmin();
  const { db, orgId, user: admin } = scope;

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const functionId = String(formData.get("functionId") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!name || !email) return { error: "Name and email are required." };
  if (password.length < 8) return { error: "The password must be at least 8 characters." };

  const fn = await db.function.findFirst({ where: { id: functionId, active: true } });
  if (!fn) return { error: "Choose the function this person will hold." };

  const dup = await db.user.findFirst({ where: { email } });
  if (dup) return { error: "Someone in this organization already uses that email." };

  const party = await db.party.findFirst({ where: { isInternal: true } });

  const created = await db.user.create({
    data: {
      orgId,
      email,
      name,
      role: fn.legacyRole,
      partyId: party?.id ?? null,
      organization: party?.name ?? null,
      passwordHash: await hashPassword(password),
      active: true,
    },
  });

  // No project exists, so there is no membership and therefore no audit
  // project to write against; this one is recorded once a project opens.
  const optional: AuditTenantOptional = { skipWhenNoProject: true };
  await audit({
    actor: admin,
    action: "USER_CREATED",
    entityType: "User",
    entityId: created.id,
    entityLabel: name,
    newValue: fn.name,
    detail: `Added to ${scope.organization.name} as ${fn.name}, before any project existed.`,
    ...optional,
  });

  revalidatePath("/setup");
  return { ok: `${name} can sign in now. They join your first project when you open it.` };
}
