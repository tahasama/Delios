"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { api, refusal } from "@/lib/client";
import { adminFunctions, adminParties } from "@/lib/settings/api-admin";
import { waitingSaid } from "@/lib/settings/forms-admin";

type GuestState = { error?: string; ok?: string };

/**
 * Someone of another organization with no DELIOS of its own gets a visitor account in ours: a link lets them choose
 * their own password (nobody else ever knows it), and we can switch the account off the day they leave. Someone whose
 * company has its own DELIOS is never added here: once the organizations are linked, their administrator puts them on
 * the project (docs/ORGANIZATIONS.md). Either way they end up as an ordinary membership holding a function, so the
 * matrix, distribution and who may read what apply to them exactly as to staff.
 */

/** A visitor: an account in this organization for someone who works for another party. */
export async function createVisitorAction(_prev: GuestState | undefined, formData: FormData): Promise<GuestState> {
  const ctx = await requireScope();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const partyId = String(formData.get("partyId") ?? "").trim() || null;
  const functionId = String(formData.get("functionId") ?? "").trim();
  const projectIds = formData.getAll("projectIds").map(String).filter(Boolean);
  if (!name || !email) return { error: "Name and email are required." };
  if (!projectIds.length) return { error: "Choose at least one project." };
  const [functions, parties] = await Promise.all([adminFunctions(), adminParties()]);
  const fn = functions.find((one) => one.id === functionId && one.active);
  if (!fn) return { error: "Choose the function they will hold." };
  // §0.3 — a visitor belongs to an external party, which is what appears on
  // transmittals and in the register rather than "visitor".
  const party = parties.find((one) => one.id === partyId);
  if (!party) return { error: "Choose the organization they actually work for." };
  if (party.isInternal) {
    return { error: `${party.name} is your own organization: add them as someone in our organization instead.` };
  }
  let created: { id: string; invited?: boolean; link?: string | null };
  try {
    created = await api<{ id: string; invited?: boolean; link?: string | null }>("/api/admin/users", { body: { name, email, partyId: party.id, invite: true } });
    for (const projectId of projectIds) {
      await api(`/api/admin/projects/${projectId}/members`, {
        method: "PUT", body: { userId: created.id, functionId: fn.id, department: String(formData.get("department") ?? "").trim() || null, active: true, confirmerId: String(formData.get("confirmerId") ?? "").trim() || null },
      });
    }
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/users");
  const waiting = await waitingSaid(created.id, ctx.projectId, ctx.project.code);
  return {
    ok: (created.invited
      ? `${name} of ${party.name} is added as ${fn.name}. An email to ${email} asks them to choose their own password; the link works once, for 7 days.`
      : `${name} of ${party.name} is added as ${fn.name}. Email is off here, so give them this link to choose their own password (it works once, for 7 days): ${created.link ?? ""}`) + waiting,
  };
}
