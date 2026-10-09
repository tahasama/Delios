"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireScope } from "@/lib/scope";
import { isAdmin } from "@/lib/auth";
import { formPolicy, checkForm } from "@/lib/field-policy";
import { buildProps } from "@/lib/config-props";
import { getSet, getSets, SET_KEY } from "@/lib/config";
import { api, forgetShortLived, projectPath, refusal } from "@/lib/api/client";
import { setOrgSetting } from "@/lib/api/settings";
import { adminNumbering, adminUsers, backendField, RECORD_KIND } from "@/lib/api/admin";

/**
 * The organization's directory and lists. The backend keeps them, checks who
 * may change what (an administrator, or Document Control for the day-to-day
 * lists) and audits every change; these send what the form says.
 */

type Result = { error?: string; ok?: string };
const failed = (e: unknown): Result => ({ error: refusal(e).message });
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

/** A value as the settings screens name it: its list and its code. */
function valueRef(valueId: string): { setKey: string; code: string } {
  const at = valueId.indexOf("::");
  return { setKey: valueId.slice(0, at), code: valueId.slice(at + 2) };
}

async function putValue(body: { setKey: string; code: string; label?: string; status?: string; sort?: number; props?: unknown }) {
  await api("/api/admin/values", { method: "PUT", body });
  // The lists are read through a few-second cache: the person who changed one sees it at once.
  await forgetShortLived();
}

export async function createUserAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const email = text(formData, "email").toLowerCase();
  const name = text(formData, "name");
  const functionId = text(formData, "functionId");
  const partyId = text(formData, "partyId") || null;
  const password = String(formData.get("password") ?? "");
  if (!email || !name) return { error: "Name and email are required." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (!functionId) return { error: "Choose the function this person will hold." };
  const projectIds = formData.getAll("projectIds").map(String).filter(Boolean);
  if (!projectIds.length) return { error: "Choose at least one project — access is granted per project." };
  // What this organization asks when it gives somebody access.
  const policy = await formPolicy(ctx, "PERSON");
  const asked = checkForm("PERSON", policy, { name, email, functionId, partyId, department: text(formData, "department") }, (n) => String(formData.get(n) ?? ""));
  if (asked.error) return { error: asked.error };
  try {
    const created = await api<{ id: string }>("/api/admin/users", { body: { name, email, password, partyId } });
    for (const projectId of projectIds) {
      await api(`/api/admin/projects/${projectId}/members`, {
        method: "PUT", body: { userId: created.id, functionId, department: text(formData, "department") || null, active: true },
      });
    }
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/users");
  return {};
}

export async function updateUserAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const userId = text(formData, "userId");
  const functionId = text(formData, "functionId");
  try {
    await api(`/api/admin/users/${userId}`, { method: "PUT", body: { active: formData.get("active") === "on" } });
    if (functionId || formData.has("department")) {
      await api(`/api/admin/projects/${ctx.projectId}/members`, {
        method: "PUT", body: { userId, functionId: functionId || null, department: text(formData, "department") || null, active: true },
      });
    }
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/users");
  return {};
}

export async function addConfigValueAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  await requireScope();
  const setKey = text(formData, "setKey");
  const code = text(formData, "code");
  const label = text(formData, "label");
  if (!setKey || !code || !label) return { error: "Set, code and label are required." };
  const existing = (await getSet(setKey)).find((one) => one.code === code);
  if (existing) {
    if (existing.status === "RETIRED") return { error: "That code exists but is retired — reactivate it instead (values in use are never deleted,)." };
    return { error: "Code already exists in this set." };
  }
  const props = buildProps(setKey, formData);
  try {
    await putValue({ setKey, code, label, props: props ? JSON.parse(props) : undefined });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/config");
  return {};
}

/** Create a brand-new published set (the organization defines its own lists). */
export async function createConfigSetAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  if (!isAdmin(ctx.user)) return { error: "Administrators only." };
  const key = text(formData, "key").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const title = text(formData, "title");
  if (!key || !title) return { error: "Key and title are required." };
  if (key.length > 40) return { error: "Keep the key under 40 characters." };
  if ((await getSets()).some((one) => one.key === key)) return { error: "A set with that key already exists." };
  try {
    await setOrgSetting(SET_KEY + key, JSON.stringify({ title, description: text(formData, "description") || null, group: text(formData, "group") || null, version: 1 }));
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/config");
  return {};
}

/** Edit a value's label and properties. Its code is durable: a value in use is retired and replaced, never recoded. */
export async function updateValuePropsAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  await requireScope();
  const { setKey, code: current } = valueRef(text(formData, "valueId"));
  const code = text(formData, "code");
  const label = text(formData, "label");
  const value = (await getSet(setKey)).find((one) => one.code === current);
  if (!value) return { error: "That value no longer exists." };
  if (code && code !== current) return { error: "A value's code does not change. Retire it and publish a replacement so historical metadata stays interpretable." };
  const props = buildProps(setKey, formData, JSON.stringify(value.props));
  try {
    await putValue({ setKey, code: current, label: label || value.label, props: props ? JSON.parse(props) : null });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/config");
  return {};
}

export async function retireConfigValueAction(formData: FormData) {
  await requireScope();
  const { setKey, code } = valueRef(text(formData, "valueId"));
  const value = (await getSet(setKey)).find((one) => one.code === code);
  if (!value) return;
  // Retired codes stay on existing documents but cannot be used on new ones (§4.7).
  await putValue({ setKey, code, status: value.status === "ACTIVE" ? "RETIRED" : "ACTIVE" }).catch(() => undefined);
  revalidatePath("/settings/config");
}

/** The scope statement and the conformance figures it is measured by: the organization's answer, kept in its settings. */
export async function setScopeAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  await requireScope();
  const organizationName = text(formData, "organizationName");
  const scopeStatement = text(formData, "scopeStatement");
  if (!organizationName || !scopeStatement) return { error: "Organization and scope statement are required." };
  try {
    await setOrgSetting("SCOPE", JSON.stringify({
      organizationName, scopeStatement, assessmentLevel: text(formData, "assessmentLevel") || "Full",
      integrityThreshold: Number(formData.get("integrityThreshold") ?? 95), measurementIntervalDays: Number(formData.get("measurementIntervalDays") ?? 30),
      effectiveDate: new Date().toISOString(),
    }));
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings");
  return {};
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

/** Document Control adds a tag to the asset breakdown. */
export async function addAssetAction(_prev: (Result & { ok?: string }) | undefined, formData: FormData): Promise<Result & { ok?: string }> {
  const ctx = await requireScope();
  const code = text(formData, "code").toUpperCase();
  const fields = assetFields(formData);
  if (!code || !fields.name) return { error: "A tag and a name are required." };
  try {
    await api(projectPath(ctx, "/assets"), { body: { code, ...fields } });
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

/** A published exception to the standard: what, which clauses, why, on whose authority, and dates. */
export async function addExceptionAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const body = {
    item: text(formData, "item"), clauses: text(formData, "clauses"), reason: text(formData, "reason"), authority: text(formData, "authority"),
    startDate: text(formData, "startDate") || null, reviewPoint: text(formData, "reviewPoint") || null,
  };
  if (!body.item || !body.clauses || !body.reason || !body.authority || !body.startDate) {
    return { error: "An exception records what is exempt, clauses, reason, granting authority and dates." };
  }
  try {
    await api(projectPath(ctx, "/exceptions"), { body });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/dmp");
  return {};
}

/** A range of numbers given to a named party. */
export async function issueNumberRangeAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const prefix = text(formData, "prefix");
  const from = Number(formData.get("from") ?? "");
  const to = Number(formData.get("to") ?? "");
  const issuedTo = text(formData, "issuedTo");
  if (!prefix || !issuedTo) return { error: "Prefix and the named party are required." };
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < from) return { error: "The range must be from ≤ to, starting at 1." };
  try {
    await api(projectPath(ctx, "/number-ranges"), { body: { prefix, from, to, issuedTo } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/numbering");
  return {};
}

/** Rename and describe a set. Its key is the values' list: it stays, as codes do. */
export async function updateConfigSetAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  if (!isAdmin(ctx.user)) return { error: "Administrators only." };
  const oldKey = text(formData, "oldKey");
  const key = text(formData, "key").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const title = text(formData, "title");
  if (!oldKey || !key || !title) return { error: "Key and title are required." };
  if (key !== oldKey) return { error: "A set's key does not change: the values in it, and the records using them, are filed under it." };
  const current = (await getSets()).find((one) => one.key === oldKey);
  try {
    await setOrgSetting(SET_KEY + key, JSON.stringify({
      title, description: text(formData, "description") || null,
      group: formData.has("group") ? text(formData, "group") || null : current?.group ?? null, version: (current?.version ?? 1) + 1,
    }));
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/config");
  revalidatePath("/settings/numbering");
  revalidatePath("/settings/workflow-templates");
  return { ok: `Published ${title} as ${key}.` };
}

/** Move a published value without changing its durable code. */
export async function moveConfigValueAction(formData: FormData) {
  await requireScope();
  const { setKey, code } = valueRef(text(formData, "valueId"));
  const direction = text(formData, "direction") || "up";
  const values = await getSet(setKey);
  const index = values.findIndex((item) => item.code === code);
  const target = direction === "down" ? index + 1 : index - 1;
  if (index < 0 || target < 0 || target >= values.length) return;
  [values[index], values[target]] = [values[target], values[index]];
  try {
    for (const [sort, item] of values.entries()) await putValue({ setKey, code: item.code, sort: sort * 10 });
  } catch {
    // The configuration screen remains usable; ActionForm surfaces edits that need validation.
  }
  revalidatePath("/settings/config");
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
 * The same three things, to many rows at once. A value in use is retired,
 * never deleted, whichever button was pressed: the backend retires values and
 * never deletes them.
 */
export async function bulkValuesAction(formData: FormData) {
  const ctx = await requireScope();
  if (!isAdmin(ctx.user)) return;
  const op = text(formData, "op");
  if (!["RETIRE", "REACTIVATE", "DELETE"].includes(op)) return;
  for (const valueId of formData.getAll("valueIds").map(String).filter(Boolean)) {
    const { setKey, code } = valueRef(valueId);
    await putValue({ setKey, code, status: op === "REACTIVATE" ? "ACTIVE" : "RETIRED" }).catch(() => undefined);
  }
  revalidatePath("/settings/config");
}

/** Values are retired rather than deleted, so the register never loses what a code meant. */
export async function deleteValueAction(formData: FormData) {
  const ctx = await requireScope();
  if (!isAdmin(ctx.user)) return;
  const { setKey, code } = valueRef(text(formData, "valueId"));
  await putValue({ setKey, code, status: "RETIRED" }).catch(() => undefined);
  revalidatePath("/settings/config");
}

/** A set is never deleted with its values: its values are retired, and its name is forgotten once it has none in use. */
export async function deleteSetAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  if (!isAdmin(ctx.user)) return { error: "Administrators only." };
  const key = text(formData, "key");
  if (["STATUSES", "REVIEW_OUTCOMES", "REASONS_FOR_ISSUE", "COMMENT_CLASSES", "CRITICALITY", "CONFIDENTIALITY", "RETENTION_CLASSES"].includes(key)) {
    return { error: `${key} is one of the sets the system runs on — its values can be edited, but the set itself stays.` };
  }
  try {
    for (const value of await getSet(key)) {
      if (value.status === "ACTIVE") await putValue({ setKey: key, code: value.code, status: "RETIRED" });
    }
    if ((await getSet(key)).length === 0) await setOrgSetting(SET_KEY + key, null);
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/config");
  redirect("/settings/config");
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
  const active = formData.get("active") === "on";
  const here = target.memberships.find((seat) => seat.projectId === ctx.projectId && seat.active);
  if (!here && !functionId) return { error: `Choose the function ${target.name} holds on ${ctx.project.code}.` };
  if (!name) return { error: "A person needs a name." };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Give a valid email address." };
  const changes: string[] = [];
  try {
    const person: Record<string, unknown> = {};
    if (name !== target.name) { person.name = name; changes.push(`name → ${name}`); }
    if (email !== target.email.toLowerCase()) { person.email = email; changes.push(`email → ${email}`); }
    if (partyId !== target.partyId) { if (partyId) person.partyId = partyId; else person.clearParty = true; changes.push("company changed"); }
    if (active !== target.active) { person.active = active; changes.push(active ? "may sign in" : "switched off"); }
    if (Object.keys(person).length) await api(`/api/admin/users/${userId}`, { method: "PUT", body: person });
    if ((functionId && functionId !== here?.functionId) || department !== (here?.department ?? null)) {
      await api(`/api/admin/projects/${ctx.projectId}/members`, { method: "PUT", body: { userId, functionId: functionId || null, department, active: true } });
      changes.push(here ? "job or department changed" : `added to ${ctx.project.code}`);
    }
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/users");
  return { ok: changes.length ? `${name || target.name}: ${changes.join("; ")}.` : "Nothing changed." };
}
