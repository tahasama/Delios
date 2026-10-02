"use server";

import { revalidatePath } from "next/cache";
import { requireAdminScope } from "@/lib/scope";
import { audit, notifyMany } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";
import { db as bare } from "@/lib/db";

export type GuestState = { error?: string; ok?: string };

/**
 * There are two honest ways to give an outsider access, and they differ in who
 * owns the account.
 *
 *   Invite  — their company already runs its own organization here, with its
 *             own administrator. You put one of their people on one of your
 *             projects. Their account, password and leaving date stay theirs;
 *             you control only what they can do on your project.
 *
 *   Visitor — they have no organization here. You create the account inside
 *             yours, set the password, and hand it over. You own it, so you can
 *             deactivate it the day they leave.
 *
 * Both end up as an ordinary ProjectMembership holding a function, so
 * everything downstream — the matrix, distribution, who may read a closed document — applies to them
 * exactly as it does to staff. Nothing about being external is special-cased.
 */

/** Put someone whose account lives in another organization on this project. */
export async function inviteGuestAction(
  _prev: GuestState | undefined,
  formData: FormData,
): Promise<GuestState> {
  const ctx = await requireAdminScope();
  const { db, user: admin, orgId } = ctx;

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const functionId = String(formData.get("functionId") ?? "").trim();
  const projectIds = formData.getAll("projectIds").map(String).filter(Boolean);
  const partyId = String(formData.get("partyId") ?? "").trim();

  if (!email) return { error: "Enter the email of the person you are inviting." };
  // On this project they are one of our outside organizations — the one whose
  // documents they deliver, and whose register they see — never staff.
  const represents = partyId ? await db.party.findFirst({ where: { id: partyId, isInternal: false, active: true } }) : null;
  if (!represents) return { error: "Choose the organization they represent here — add it in Organizations if it is missing." };
  if (!projectIds.length) return { error: "Choose at least one project — a guest is invited to a project, not to your organization." };

  const fn = await db.function.findFirst({ where: { id: functionId, active: true } });
  if (!fn) return { error: "Choose the function they will hold." };

  // Deliberately across organizations: the whole point is that their account
  // is somewhere else.
  const candidates = await bare.user.findMany({
    where: { email, active: true, org: { active: true } },
    include: { org: true },
  });

  if (!candidates.length) {
    return {
      error: `No active account anywhere uses ${email}. Either ask their organization to register, or create them as a visitor below — that account will belong to you.`,
    };
  }
  const external = candidates.filter((c) => c.orgId !== orgId);
  if (!external.length) {
    return { error: `${email} is already in your organization. Add them through “Add someone”, not as a guest.` };
  }
  if (external.length > 1) {
    return {
      error: `${email} has accounts in ${external.length} organizations (${external.map((e) => e.org.name).join(", ")}). Ask which one to invite — this needs to be unambiguous.`,
    };
  }

  const guest = external[0];
  const permitted = await db.project.findMany({
    where: { orgId, id: { in: projectIds }, status: "ACTIVE" },
    select: { id: true, code: true },
  });
  if (permitted.length !== projectIds.length) return { error: "One of those projects is not an active project of yours." };

  let added = 0;
  for (const project of permitted) {
    const existing = await db.projectMembership.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: guest.id } },
    });
    if (existing) {
      await db.projectMembership.update({ where: { id: existing.id }, data: { functionId: fn.id, active: true, partyId: represents.id } });
    } else {
      await db.projectMembership.create({ data: { projectId: project.id, userId: guest.id, functionId: fn.id, partyId: represents.id } });
      added++;
    }
  }

  await notifyMany(
    [guest.id],
    "PROJECT_INVITATION",
    `You have been added to ${permitted.map((p) => p.code).join(", ")}`,
    `${admin.name} gave you the ${fn.name} function. Switch to it from the project picker.`,
    "/",
  );
  await audit({
    actor: admin,
    action: "GUEST_INVITED",
    entityType: "User",
    entityId: guest.id,
    entityLabel: `${guest.name} (${guest.org.name})`,
    newValue: fn.name,
    detail: `Invited to ${permitted.map((p) => p.code).join(", ")} as ${fn.name}, representing ${represents.name}. Their account remains with ${guest.org.name}.`,
  });

  revalidatePath("/admin/users");
  return {
    ok: `${guest.name} of ${guest.org.name} can now reach ${permitted.map((p) => p.code).join(", ")} as ${fn.name}${added === 0 ? " (membership updated)" : ""}.`,
  };
}

/** Create an account inside your organization for someone from outside it. */
export async function createVisitorAction(
  _prev: GuestState | undefined,
  formData: FormData,
): Promise<GuestState> {
  const ctx = await requireAdminScope();
  const { db, user: admin, orgId } = ctx;

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const partyId = String(formData.get("partyId") ?? "").trim() || null;
  const functionId = String(formData.get("functionId") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const projectIds = formData.getAll("projectIds").map(String).filter(Boolean);

  if (!name || !email) return { error: "Name and email are required." };
  if (password.length < 8) return { error: "The password must be at least 8 characters." };
  if (!projectIds.length) return { error: "Choose at least one project." };

  const fn = await db.function.findFirst({ where: { id: functionId, active: true } });
  if (!fn) return { error: "Choose the function they will hold." };

  const dup = await db.user.findFirst({ where: { email } });
  if (dup) return { error: "Someone in your organization already uses that email." };

  // §0.3 — a visitor belongs to an external party, which is what appears on
  // transmittals and in the register rather than "visitor".
  const party = partyId ? await db.party.findFirst({ where: { id: partyId } }) : null;
  if (!party) return { error: "Choose the organization they actually work for." };
  if (party.isInternal) {
    return { error: `${party.name} is marked internal. A visitor belongs to an external party — add one in Parties if it is missing.` };
  }

  const permitted = await db.project.findMany({
    where: { orgId, id: { in: projectIds }, status: "ACTIVE" },
    select: { id: true, code: true },
  });
  if (permitted.length !== projectIds.length) return { error: "One of those projects is not an active project of yours." };

  const created = await db.user.create({
    data: {
      orgId,
      email,
      name,
      role: fn.legacyRole,
      partyId: party.id,
      organization: party.name,
      passwordHash: await hashPassword(password),
      active: true,
    },
  });
  await db.projectMembership.createMany({
    data: permitted.map((p) => ({ projectId: p.id, userId: created.id, functionId: fn.id })),
  });

  await audit({
    actor: admin,
    action: "VISITOR_CREATED",
    entityType: "User",
    entityId: created.id,
    entityLabel: `${name} (${party.name})`,
    newValue: fn.name,
    detail: `Visitor account created in your organization for ${party.name}; ${permitted.map((p) => p.code).join(", ")} as ${fn.name}. Deactivate it when they leave.`,
  });

  revalidatePath("/admin/users");
  return { ok: `${name} of ${party.name} can sign in now as ${fn.name}. Give them the password yourself — nothing is emailed.` };
}

/** Take a guest or visitor off a project without touching their account. */
export async function removeFromProjectAction(
  _prev: GuestState | undefined,
  formData: FormData,
): Promise<GuestState> {
  const ctx = await requireAdminScope();
  const { db, user: admin, orgId, projectId } = ctx;

  const userId = String(formData.get("userId") ?? "");
  if (userId === admin.id) return { error: "You cannot remove yourself from the project you are working in." };

  const membership = await db.projectMembership.findUnique({
    where: { projectId_userId: { projectId, userId } },
    include: { user: { include: { org: true } }, project: true, function: true },
  });
  if (!membership) return { error: "They are not on this project." };
  if (membership.project.orgId !== orgId) return { error: "That project is not yours." };

  await db.projectMembership.delete({ where: { id: membership.id } });
  await audit({
    actor: admin,
    action: "REMOVED_FROM_PROJECT",
    entityType: "User",
    entityId: userId,
    entityLabel: membership.user.name,
    oldValue: membership.function.name,
    detail: `Removed from ${membership.project.code}. Their account with ${membership.user.org.name} is untouched.`,
  });
  revalidatePath("/admin/users");
  return { ok: `${membership.user.name} removed from ${membership.project.code}.` };
}
