"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { formPolicy, checkForm } from "@/lib/settings/field-policy";
import { api, forgetShortLived, projectPath, refusal } from "@/lib/client";
import { adminNumbering, adminUsers, backendField, RECORD_KIND } from "@/lib/settings/api-admin";

/**
 * The organization's directory and lists. The backend keeps them, checks who
 * may change what (an administrator, or the control function for the day-to-day
 * lists) and audits every change; these send what the form says.
 */

type Result = { error?: string; ok?: string };
const failed = (e: unknown): Result => ({ error: refusal(e).message });
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

/** Said after adding someone: when the project asks for people to be confirmed, they wait off the project until then. */
export async function waitingSaid(userId: string, projectId: string, projectCode: string): Promise<string> {
  const added = (await adminUsers().catch(() => [])).find((u) => u.id === userId);
  const seat = added?.memberships.find((m) => m.projectId === projectId);
  return seat?.pendingSince ? ` They join ${projectCode} once ${seat.confirmerName ?? "whoever holds Manage"} confirms them (People to confirm).` : "";
}

/**
 * Takes someone off this project only: their account and their places on other projects stay, and everything they
 * did here keeps their name. Taking off is a change to the project, so it is said in its audit.
 */
export async function takeOffProjectAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const userId = text(formData, "userId");
  const target = (await adminUsers()).find((one) => one.id === userId);
  if (!target) return { error: "That person no longer exists." };
  try {
    await api(`/api/admin/projects/${ctx.projectId}/members`, { method: "PUT", body: { userId, functionId: null, active: false } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/users");
  return { ok: `${target.name} is off ${ctx.project.code}. Their account and their other projects stay.` };
}


/** The organization's own fields on an asset, as the form names them. */
function assetFields(formData: FormData) {
  const extras: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (name.startsWith("own:") && typeof value === "string" && value.trim()) extras[name.slice(4)] = value.trim();
  }
  return {
    name: text(formData, "name"), area: text(formData, "area") || null, system: text(formData, "system") || null,
    unit: text(formData, "unit") || null, description: text(formData, "description") || null, extras: Object.keys(extras).length ? extras : null,
  };
}

/** the control function adds a tag to the asset breakdown. */
export async function addAssetAction(_prev: (Result & { ok?: string }) | undefined, formData: FormData): Promise<Result & { ok?: string }> {
  const ctx = await requireScope();
  const fields = assetFields(formData);
  if (!fields.name) return { error: "A tag needs a name." };
  let code = "";
  try {
    // The tag is given by its numbering scheme, as a package number is; nobody types it.
    code = (await api<{ code: string }>(projectPath(ctx, "/assets"), { body: fields })).code;
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/assets");
  return { ok: `${code} added.` };
}

export async function updateAssetAction(_prev: (Result & { ok?: string }) | undefined, formData: FormData): Promise<Result & { ok?: string }> {
  const ctx = await requireScope();
  const id = text(formData, "id");
  const fields = assetFields(formData);
  if (!fields.name) return { error: "An asset needs a name." };
  let code: string;
  try {
    code = (await api<{ code: string }>(projectPath(ctx, `/assets/${id}`), { method: "PUT", body: fields })).code;
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/assets");
  revalidatePath(`/assets/${id}`);
  return { ok: `${code} saved.` };
}

/** An unused tag is retired: kept on record, offered no more. */
export async function removeAssetAction(_prev: (Result & { ok?: string }) | undefined, formData: FormData): Promise<Result & { ok?: string }> {
  const ctx = await requireScope();
  const id = text(formData, "id");
  try {
    await api(projectPath(ctx, `/assets/${id}/retire`), { method: "POST" });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/assets");
  return { ok: "Removed from the list." };
}

/** Create or revise an organization numbering scheme and its ordered fields. */
export async function saveNumberingSchemeAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  await requireScope();
  const id = text(formData, "id");
  const name = text(formData, "name");
  const delimiter = text(formData, "delimiter") || "-";
  const labels = formData.getAll("fieldLabel").map((value) => String(value).trim());
  const setKeys = formData.getAll("fieldSetKey").map((value) => String(value).trim());
  const rules = formData.getAll("fieldRule").map((value) => String(value).trim());
  if (!name) return { error: "Give the scheme a name." };
  if (delimiter.length !== 1 || /[A-Za-z0-9]/.test(delimiter)) return { error: "The delimiter must be one non-alphanumeric character." };
  if (!labels.length || labels.some((label) => !label)) return { error: "Every numbering field needs a label." };
  if (!rules.some((rule) => rule.startsWith("COUNTER:"))) return { error: "Add one sequence counter field so numbers remain unique." };
  if (rules.filter((rule) => rule.startsWith("COUNTER:")).length > 1) return { error: "Use one sequence counter per scheme." };
  const existing = (await adminNumbering()).schemes;
  if (existing.some((one) => one.name === name && one.id !== id)) return { error: "A scheme with this name already exists." };
  const fields = labels.map((label, index) => backendField(label, setKeys[index] ?? "", rules[index] ?? ""));
  try {
    if (id) await api(`/api/admin/numbering/schemes/${id}`, { method: "PUT", body: { name, delimiter, fields } });
    else await api("/api/admin/numbering/schemes", { body: { name, delimiter, fields } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/numbering");
  return { ok: `Published ${name}.` };
}

export async function saveSchemeRoutingAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  await requireScope();
  const deliverableType = text(formData, "deliverableType");
  const schemeName = text(formData, "schemeName");
  // Rows edited in place send "status"; a new routing is always active.
  const active = formData.has("status") ? formData.get("active") === "on" : true;
  if (!deliverableType || !schemeName) return { error: "Choose a deliverable type and a scheme." };
  const scheme = (await adminNumbering()).schemes.find((one) => one.name === schemeName);
  if (!scheme || !scheme.active) return { error: "That numbering scheme is not active." };
  try {
    await api("/api/admin/numbering/routing", {
      method: "PUT", body: { deliverableType: RECORD_KIND[deliverableType] ?? deliverableType, schemeId: active ? scheme.id : null },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/numbering");
  return { ok: active ? `${deliverableType} now uses ${schemeName}.` : `Numbering for ${deliverableType} switched off — no new numbers of this type.` };
}

/** A scheme nothing routes to is taken out of use; numbers it gave keep it. */
export async function removeNumberingSchemeAction(formData: FormData) {
  await requireScope();
  const id = text(formData, "id");
  const numbering = await adminNumbering();
  if (numbering.routing.some((r) => r.schemeId === id && r.active)) return;
  await api(`/api/admin/numbering/schemes/${id}`, { method: "PUT", body: { active: false } }).catch(() => undefined);
  revalidatePath("/settings/numbering");
}

/**
 * One form for a person: who they are, who they work for, the job they hold on
 * this project and the department they answer for — and whether they may sign
 * in. What the job lets them do is the matrix's business, not the person's:
 * one function may create, review and approve.
 */
export async function savePersonAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const userId = text(formData, "userId");
  const target = (await adminUsers()).find((one) => one.id === userId);
  if (!target) return { error: "That person no longer exists." };
  const name = text(formData, "name");
  const email = text(formData, "email").toLowerCase();
  const partyId = text(formData, "partyId") || null;
  const functionId = text(formData, "functionId");
  const department = text(formData, "department") || null;
  // A linked account's name, email and sign-in are its own organization's: only its place here changes.
  const linked = !!target.linked;
  const active = linked ? target.active : formData.get("active") === "on";
  const here = target.memberships.find((seat) => seat.projectId === ctx.projectId && seat.active);
  if (!here && !functionId) return { error: `Choose the function ${target.name} holds on ${ctx.project.code}.` };
  if (!linked && !name) return { error: "A person needs a name." };
  if (!linked && !/^\S+@\S+\.\S+$/.test(email)) return { error: "Give a valid email address." };
  const changes: string[] = [];
  try {
    const person: Record<string, unknown> = {};
    if (!linked) {
    if (name !== target.name) { person.name = name; changes.push(`name → ${name}`); }
    if (email !== target.email.toLowerCase()) { person.email = email; changes.push(`email → ${email}`); }
    if (partyId !== target.partyId) { if (partyId) person.partyId = partyId; else person.clearParty = true; changes.push("company changed"); }
    if (active !== target.active) { person.active = active; changes.push(active ? "may sign in" : "can no longer sign in"); }
    }
    if (Object.keys(person).length) await api(`/api/admin/users/${userId}`, { method: "PUT", body: person });
    if ((functionId && functionId !== here?.functionId) || department !== (here?.department ?? null)) {
      await api(`/api/admin/projects/${ctx.projectId}/members`, { method: "PUT", body: { userId, functionId: functionId || null, department, active: true, confirmerId: text(formData, "confirmerId") || null } });
      changes.push(here ? "function or department changed" : `added to ${ctx.project.code}`);
    }
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/users");
  return { ok: changes.length ? `${name || target.name}: ${changes.join("; ")}.${here ? "" : await waitingSaid(userId, ctx.projectId, ctx.project.code)}` : "Nothing changed." };
}
