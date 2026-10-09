"use server";

import { revalidatePath } from "next/cache";
import { requireAccessScope } from "@/lib/scope";
import { api, refusal } from "@/lib/api/client";
import { adminFunctions, rulesBody, type AdminFunction, type AdminRule } from "@/lib/api/admin";
import { getActiveSet } from "@/lib/config";
import { VERBS, type Verb } from "@/lib/permissions";
import { CONTRACT_ROLES } from "@/lib/profiles/roles";

const CODE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

function readVerbs(formData: FormData): Verb[] {
  const picked = formData.getAll("verbs").map(String);
  return VERBS.filter((v) => picked.includes(v));
}

/**
 * An administrator's function is the one that can grant anything, including
 * Configure itself. The control function maintains the matrix, but cannot
 * change that function — or it could give itself the rest. The backend holds
 * the same line.
 */
function adminFunctionGuard(ctx: { can: (verb: "CONFIGURE") => boolean }, fn: AdminFunction): string | null {
  if (ctx.can("CONFIGURE")) return null;
  return fn.rules.some((r) => r.verbs.includes("CONFIGURE")) ? `${fn.name} can change the permissions themselves, so only an administrator changes it.` : null;
}

type Result = { error?: string; ok?: string };

async function findFunction(id: string) {
  return (await adminFunctions()).find((one) => one.id === id) ?? null;
}

async function saveRules(fn: AdminFunction, rules: AdminRule[]): Promise<Result | null> {
  try {
    await api(`/api/admin/functions/${fn.id}`, { method: "PUT", body: { rules: rulesBody(rules) } });
    return null;
  } catch (e) {
    return { error: refusal(e).message };
  }
}

/** Publish a function the organization actually uses (§1.4). */
export async function createFunctionAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  await requireAccessScope();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  const verbs = readVerbs(formData);
  if (!name) return { error: "Give the function the name people actually use for it." };
  if (!CODE.test(code)) return { error: "The code is short and uppercase, e.g. ELEC_TECH." };
  try {
    const created = await api<{ id: string }>("/api/admin/functions", { body: { code, name } });
    const clearance = String(formData.get("clearance") ?? "").trim();
    if (verbs.length || clearance) {
      await api(`/api/admin/functions/${created.id}`, { method: "PUT", body: { ...(verbs.length ? { rules: [{ verbs }] } : {}), ...(clearance ? { clearance } : {}) } });
    }
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/functions");
  return { ok: `${name} published.` };
}

export async function updateFunctionAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireAccessScope();
  const id = String(formData.get("functionId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const active = formData.get("active") === "on";
  const fn = await findFunction(id);
  if (!fn) return { error: "That function is not published in your organization." };
  const guard = adminFunctionGuard(ctx, fn);
  if (guard) return { error: guard };
  if (!active && fn.active && fn.holders > 0) {
    return { error: `${fn.holders} person(s) still hold ${fn.name}. Move them to another function first.` };
  }
  try {
    // The most confidential level its holders read without being named on the document; empty is no limit.
    const clearance = formData.has("clearance") ? String(formData.get("clearance") ?? "").trim() : undefined;
    await api(`/api/admin/functions/${id}`, { method: "PUT", body: { name: name || fn.name, active, ...(clearance === undefined ? {} : { clearance }) } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/functions");
  return { ok: "Saved." };
}

/**
 * Add or replace a rule. §11.8 wants distribution "defined by classification
 * and recipient role" — the selectors are that classification, and leaving one
 * blank means "any".
 */
export async function savePermissionRuleAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireAccessScope();
  const ruleId = String(formData.get("ruleId") ?? "").trim();
  const functionId = String(formData.get("functionId") ?? "").trim();
  const blank = (key: string) => String(formData.get(key) ?? "").trim() || null;
  const fn = await findFunction(functionId);
  if (!fn) return { error: "Choose a function." };
  const guard = adminFunctionGuard(ctx, fn);
  if (guard) return { error: guard };
  const verbs = readVerbs(formData);
  if (!ctx.can("CONFIGURE") && verbs.includes("CONFIGURE")) {
    return { error: "Only an administrator grants Configure — it is the permission that grants every other." };
  }
  if (!verbs.length) return { error: "A rule with no verbs grants nothing — delete it instead." };
  const rule: AdminRule = {
    id: ruleId, verbs, deliverableType: blank("deliverableType"), docType: blank("docType"), discipline: blank("discipline"),
    criticality: blank("criticality"), confidentiality: blank("confidentiality"), projectRole: blank("projectRole"),
  };
  if (rule.projectRole && !CONTRACT_ROLES.some((r) => r.code === rule.projectRole)) {
    return { error: `“${rule.projectRole}” is not a contract role — leave it blank for every project.` };
  }
  const published: [string | null, string, string][] = [
    [rule.deliverableType, "DELIVERABLE_TYPES", "deliverable type"], [rule.docType, "DOCUMENT_TYPES", "document type"],
    [rule.discipline, "DISCIPLINES", "discipline"], [rule.criticality, "CRITICALITY", "criticality"],
    [rule.confidentiality, "CONFIDENTIALITY", "confidentiality"],
  ];
  for (const [code, setKey, what] of published) {
    if (code && !(await getActiveSet(setKey)).some((one) => one.code === code)) {
      return { error: `“${code}” is not a ${what} in the published list — choose one from it.` };
    }
  }
  if (ruleId && !fn.rules.some((r) => r.id === ruleId)) return { error: "That rule no longer exists." };
  const rules = ruleId ? fn.rules.map((r) => (r.id === ruleId ? rule : r)) : [...fn.rules, rule];
  const failed = await saveRules(fn, rules);
  if (failed) return failed;
  revalidatePath("/settings/functions");
  return { ok: "Rule published." };
}

export async function deletePermissionRuleAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireAccessScope();
  const ruleId = String(formData.get("ruleId") ?? "");
  const fn = (await adminFunctions()).find((one) => one.rules.some((r) => r.id === ruleId));
  if (!fn) return { error: "That rule no longer exists." };
  const guard = adminFunctionGuard(ctx, fn);
  if (guard) return { error: guard };
  const failed = await saveRules(fn, fn.rules.filter((r) => r.id !== ruleId));
  if (failed) return failed;
  revalidatePath("/settings/functions");
  return { ok: "Rule withdrawn." };
}

/**
 * Tick or untick one verb for one function, straight in the matrix.
 * It edits the function's unscoped rule — the one that applies to every
 * document. A verb granted only for certain documents is left alone: that is
 * a narrowing, and it is removed where it was made.
 */
export async function toggleFunctionVerbAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireAccessScope();
  const functionId = String(formData.get("functionId") ?? "");
  const verb = String(formData.get("verb") ?? "");
  const fn = await findFunction(functionId);
  if (!fn) return { error: "That function no longer exists." };
  if (!VERBS.includes(verb as Verb)) return { error: "Unknown permission." };
  const guard = adminFunctionGuard(ctx, fn);
  if (guard) return { error: guard };
  if (!ctx.can("CONFIGURE") && verb === "CONFIGURE") {
    return { error: "Only an administrator grants Configure — it is the permission that grants every other." };
  }
  const isOpen = (r: AdminRule) => !r.deliverableType && !r.docType && !r.discipline && !r.criticality && !r.confidentiality && !r.projectRole;
  const open = fn.rules.find(isOpen);
  const held = open?.verbs ?? [];
  const has = held.includes(verb);
  const next = has ? held.filter((v) => v !== verb) : [...held, verb];
  const others = fn.rules.filter((r) => r !== open);
  const rules = next.length
    ? [...others, { id: open?.id ?? "", verbs: next, deliverableType: null, docType: null, discipline: null, criticality: null, confidentiality: null, projectRole: null }]
    : others;
  const failed = await saveRules(fn, rules);
  if (failed) return failed;
  revalidatePath("/settings/functions");
  revalidatePath("/distribution");
  return { ok: `${fn.name}: ${has ? "removed" : "granted"} ${verb.toLowerCase()}.` };
}

/** The same toggle as a plain form action, for the tick boxes in the matrix. */
export async function toggleFunctionVerb(formData: FormData): Promise<void> {
  await toggleFunctionVerbAction(undefined, formData);
}
