"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { api, refusal } from "@/lib/api/client";
import { adminFunctions, adminParties } from "@/lib/api/admin";

export type GuestState = { error?: string; ok?: string };

/**
 * There are two honest ways to give an outsider access, and they differ in who
 * owns the account.
 *
 *   Invite  — their company already runs its own organization here. A
 *             person belongs to one organization, so this is not offered: they
 *             are given a visitor account instead.
 *
 *   Visitor — they have no organization here. You create the account inside
 *             yours, set the password, and hand it over. You own it, so you can
 *             deactivate it the day they leave.
 *
 * Both end up as an ordinary ProjectMembership holding a function, so
 * everything downstream — the matrix, distribution, who may read a closed document — applies to them
 * exactly as it does to staff. Nothing about being external is special-cased.
 */

/** Put someone whose account lives in another organization on this project: a person belongs to one organization. */
export async function inviteGuestAction(_prev: GuestState | undefined, _formData: FormData): Promise<GuestState> {
  return { error: "A person belongs to one organization: create a visitor account for them instead." };
}

/** A visitor: an account in this organization for someone who works for another party. */
export async function createVisitorAction(_prev: GuestState | undefined, formData: FormData): Promise<GuestState> {
  await requireScope();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const partyId = String(formData.get("partyId") ?? "").trim() || null;
  const functionId = String(formData.get("functionId") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const projectIds = formData.getAll("projectIds").map(String).filter(Boolean);
  if (!name || !email) return { error: "Name and email are required." };
  if (password.length < 8) return { error: "The password must be at least 8 characters." };
  if (!projectIds.length) return { error: "Choose at least one project." };
  const [functions, parties] = await Promise.all([adminFunctions(), adminParties()]);
  const fn = functions.find((one) => one.id === functionId && one.active);
  if (!fn) return { error: "Choose the function they will hold." };
  // §0.3 — a visitor belongs to an external party, which is what appears on
  // transmittals and in the register rather than "visitor".
  const party = parties.find((one) => one.id === partyId);
  if (!party) return { error: "Choose the organization they actually work for." };
  if (party.isInternal) {
    return { error: `${party.name} is marked internal. A visitor belongs to an external party — add one in Parties if it is missing.` };
  }
  try {
    const created = await api<{ id: string }>("/api/admin/users", { body: { name, email, password, partyId: party.id } });
    for (const projectId of projectIds) {
      await api(`/api/admin/projects/${projectId}/members`, { method: "PUT", body: { userId: created.id, functionId: fn.id, active: true } });
    }
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/users");
  return { ok: `${name} of ${party.name} can sign in now as ${fn.name}. Give them the password yourself — nothing is emailed.` };
}

/** Take a guest or visitor off a project without touching their account. */
export async function removeFromProjectAction(_prev: GuestState | undefined, formData: FormData): Promise<GuestState> {
  const ctx = await requireScope();
  const userId = String(formData.get("userId") ?? "");
  if (userId === ctx.user.id) return { error: "You cannot remove yourself from the project you are working in." };
  try {
    await api(`/api/admin/projects/${ctx.projectId}/members`, { method: "PUT", body: { userId, active: false } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/users");
  return { ok: `Removed from ${ctx.project.code}.` };
}
