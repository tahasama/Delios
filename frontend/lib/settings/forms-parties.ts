"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath, refusal, refusalForForm } from "@/lib/client";
import { adminParties } from "@/lib/settings/api-admin";

/** One organization already on DELIOS that looks like the one being created, and why (the backend's LOOKS_LIKE). */
export type Lookalike = { id: string; code: string; name: string; country: string | null; onDelios: boolean; why: string };
type Result = { error?: string; ok?: string; lookalikes?: Lookalike[]; fields?: string[] };
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
  // Who of ours works for one nobody of which signs in: a person; nobody chosen, the control function ("").
  const carriedBy = kind === "OFFLINE" ? text(formData, "carriedBy") : undefined;
  // Not on DELIOS: where our transmittals go by email (empty: one of ours sends them).
  const contactEmail = kind === "OFFLINE" ? text(formData, "contactEmail") : undefined;
  if (kind === "OFFLINE" && !contactEmail) return { error: "Give their email for transmittals: our transmittals go there.", fields: ["contactEmail"] };
  if (contactId && backupId && contactId === backupId) return { error: "The backup has to be someone other than the person who answers." };
  // Who it is beside its name: its identifier with its country, or why it has none; and its email domain.
  const identity = {
    country: text(formData, "country") || null, identifierKind: text(formData, "identifierKind") || null,
    identifierNumber: text(formData, "identifierNumber") || null, noIdentifierReason: text(formData, "noIdentifierReason") || null,
    domain: formData.has("domain") ? text(formData, "domain") : undefined,
  };
  // Add: one DELIOS knows already, as it is.
  const identityId = text(formData, "identityId");
  // The projects it works on: this one (added from a project's page), or those chosen on the organization's list.
  const projectIds = formData.get("takePart") === "1" ? [ctx.projectId] : formData.getAll("projectIds").map(String).filter(Boolean);
  const putOn = async (partyId: string) => {
    for (const pid of projectIds) {
      // Its role with us and contract, asked with the add on a project's page.
      await api(`/api/projects/${pid}/organizations/${partyId}`, {
        method: "PUT",
        body: { role: text(formData, "role") || null, contractNumber: text(formData, "contractNumber") || null, startFunctionId: null, active: true },
      });
    }
  };
  // Already in our list: it only starts working on the projects chosen.
  const listedParty = text(formData, "partyId");
  if (listedParty) {
    try {
      await putOn(listedParty);
    } catch (e) {
      return refusalForForm(e);
    }
    revalidatePath("/settings/parties");
    revalidatePath("/organization/organizations");
    return { ok: projectIds.length ? `${text(formData, "identityName") || "It"} now works on the project: open its line to give its role and contract.` : "It is in our list already." };
  }
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
            code: recode, name: rename, active, carriedBy, evidenceRequired: kind === "OFFLINE", contactEmail,
            participation: participation !== party.participation ? participation : undefined, ...identity,
          },
      });
    } else if (identityId) {
      const added = await api<{ id: string; invited: boolean }>("/api/admin/parties", {
        body: { identityId, participation, carriedBy, evidenceRequired: kind === "OFFLINE", contactEmail },
      });
      partyId = added.id;
      saidName = text(formData, "identityName") || "The organization";
      if (added.invited) saidName += " (invited to work with us: their administrator accepts, then puts their people on)";
    } else {
      // What the organization's form insists on is checked by the backend (FIELDS_REQUIRED).
      const created = await api<{ id: string }>("/api/admin/parties", {
        body: {
          code, name, isInternal: false, participation, carriedBy, evidenceRequired: kind === "OFFLINE", contactEmail, ...identity,
          contactId: contactId || null, backupId: backupId || null,
          notTheSame: text(formData, "notTheSame").split(",").filter(Boolean),
        },
      });
      partyId = created.id;
    }
    // Added or created with projects: it works on them.
    if (!id) await putOn(partyId);
  } catch (e) {
    // Look-alikes are named first: the form asks whether it is one of them.
    const { code: refused, params, message } = refusal(e);
    if (refused === "LOOKS_LIKE") return { error: message, lookalikes: (params as { lookalikes?: Lookalike[] })?.lookalikes ?? [] };
    return refusalForForm(e);
  }
  revalidatePath("/settings/parties");
  revalidatePath("/organization/organizations");
  revalidatePath("/settings/users");
  saidName ||= code;
  return {
    ok: id ? `${saidName} is saved.`
      : projectIds.length ? `${saidName} is added and works on ${formData.get("takePart") === "1" ? ctx.project.code : `${projectIds.length} project(s)`}: open its line to give its role and contract.`
      : `${saidName} is in our list.`,
  };
}

/** Organizations DELIOS knows whose code or name holds the words: to add one as it is. */
export async function findOnDeliosAction(words: string): Promise<{ id: string; code: string; name: string; country: string | null; listed: boolean; partyId: string | null; onDelios: boolean }[]> {
  await requireScope();
  if (words.trim().length < 2) return [];
  return api<{ id: string; code: string; name: string; country: string | null; listed: boolean; partyId: string | null; onDelios: boolean }[]>(
    `/api/admin/organizations/on-delios?q=${encodeURIComponent(words.trim())}`).catch(() => []);
}

/** Two organizations are one: asked with why; each side agrees, then the app's owner merges them. */
export async function askMergeAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  await requireScope();
  const keepId = text(formData, "keepId");
  const mergeId = text(formData, "mergeId");
  const why = text(formData, "why");
  if (!keepId || !mergeId) return { error: "Choose the organization it is the same as.", fields: ["keepId"] };
  if (!why) return { error: "Say why they are one organization.", fields: ["why"] };
  let state: string;
  try {
    state = (await api<{ state: string }>("/api/admin/organizations/merges", { body: { keepId, mergeId, why } })).state;
  } catch (e) {
    return refusalForForm(e);
  }
  revalidatePath("/settings/parties");
  revalidatePath("/organization");
  return { ok: state === "AGREED" ? "Asked: every side agrees; the app's owner merges them." : "Asked: the other side is told, and answers on their organization's page." };
}
