"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { api, refusal } from "@/lib/client";
import { formPolicy, checkForm } from "@/lib/settings/field-policy";
import { setProjectSetting } from "@/lib/settings/api";
import { adminParties, PARTY_KEY } from "@/lib/settings/api-admin";

type Result = { error?: string; ok?: string };
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

/**
 * Registers or changes an organization we exchange documents with. The organization itself is the whole
 * organization's record, and DELIOS's: one code and one name everywhere, each changed once at most (a mistake put
 * right; numbers already given keep the old code), and how it works with us changed once too; who answers for
 * it is said per project, so the control function of the project keeps it (`PARTY:<id>`, a project setting). An
 * organization is never removed: its access is switched off instead, and every record keeps meaning what it meant.
 */
export async function savePartyAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const id = text(formData, "id");
  const code = text(formData, "code").toUpperCase();
  const name = text(formData, "name");
  const contactId = text(formData, "contactId") || null;
  const backupId = text(formData, "backupId") || null;
  // How this organization works with us: a collaborator is linked, never chosen here.
  const kind = ["COLLABORATOR", "GUEST", "OFFLINE"].includes(text(formData, "kind")) ? text(formData, "kind") : "GUEST";
  const participation = kind === "OFFLINE" ? "BY_PROXY" : "IN_APP";
  const custodianFunction = text(formData, "liaisonFunction");
  // Not on DELIOS: where our transmittals go by email (empty: one of ours sends them).
  const contactEmail = kind === "OFFLINE" ? text(formData, "contactEmail") : undefined;
  if (contactId && backupId && contactId === backupId) return { error: "The backup has to be someone other than the person who answers." };
  let saidName = name;
  try {
    let partyId = id;
    if (id) {
      const party = (await adminParties()).find((one) => one.id === id);
      if (!party) return { error: "That organization is no longer there." };
      const active = formData.get("active") === "on";
      if (!name) return { error: "Give the organization its name." };
      if (party.isInternal && !active) return { error: "Your own organization cannot be switched off." };
      // Only what changes is sent: a code, a name or how it works with us is changed once at most.
      const recode = code && code !== party.code ? code : undefined;
      const rename = name !== party.name ? name : undefined;
      await api(`/api/admin/parties/${id}`, {
        method: "PUT",
        body: party.isInternal
          ? { code: recode, name: rename, active }
          : {
            code: recode, name: rename, active, custodianFunction, evidenceRequired: kind === "OFFLINE", contactEmail,
            participation: participation !== party.participation ? participation : undefined,
          },
      });
    } else {
      // What this organization asks when it adds another one.
      const policy = await formPolicy(ctx, "PARTY");
      const asked = checkForm("PARTY", policy, { code, name, kind, contactId, backupId, liaisonFunction: custodianFunction || null }, (n) => String(formData.get(n) ?? ""));
      if (asked.error) return { error: asked.error };
      const created = await api<{ id: string }>("/api/admin/parties", {
        body: { code, name, isInternal: false, participation, custodianFunction, evidenceRequired: kind === "OFFLINE", contactEmail },
      });
      partyId = created.id;
    }
    // Who answers for it here: optional, never a reason a save fails.
    await setProjectSetting(ctx.projectId, PARTY_KEY + partyId, contactId || backupId ? JSON.stringify({ contactId, backupId }) : null);
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/parties");
  revalidatePath("/settings/users");
  saidName ||= code;
  return { ok: id ? `${saidName} is saved.` : `${saidName} is registered. Say whether it takes part in ${ctx.project.code} below.` };
}
