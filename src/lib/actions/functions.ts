"use server";

import { revalidatePath } from "next/cache";
import { requireAdminScope } from "@/lib/scope";
import { audit } from "@/lib/audit";
import { VERBS, type Verb } from "@/lib/permissions";

const CODE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

function readVerbs(formData: FormData): Verb[] {
  const picked = formData.getAll("verbs").map(String);
  return VERBS.filter((v) => picked.includes(v));
}

/**
 * The account-level role that stands in before a project is chosen — derived
 * from what the function may do, never chosen separately. Inside a project the
 * matrix decides everything.
 */
function roleFromVerbs(verbs: string[]): string {
  if (verbs.includes("CONFIGURE")) return "ADMIN";
  if (verbs.includes("CONTROL")) return "CONTROLLER";
  if (verbs.includes("APPROVE")) return "APPROVER";
  if (verbs.includes("REVIEW")) return "REVIEWER";
  if (verbs.includes("CREATE") || verbs.includes("REVISE")) return "AUTHOR";
  return "VIEWER";
}

/** Publish a function the organization actually uses (§1.4). */
export async function createFunctionAction(
  _prev: { error?: string; ok?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireAdminScope();
  const { db, orgId, user: admin } = ctx;

  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const clearance = Number(formData.get("clearance") ?? 1);
  const verbs = readVerbs(formData);
  const legacyRole = roleFromVerbs(verbs);

  if (!name) return { error: "Give the function the name people actually use for it." };
  if (!CODE.test(code)) return { error: "The code is short and uppercase, e.g. ELEC_TECH." };
  if (!Number.isInteger(clearance) || clearance < 1 || clearance > 9) {
 return { error: "Clearance is a level from 1 upwards." };
  }

  const dup = await db.function.findFirst({ where: { code } });
  if (dup) return { error: `A function with code ${code} is already published.` };

  const fn = await db.function.create({
    data: { orgId, code, name, description, clearance, legacyRole, sort: 100 },
  });
  // A function with no rule can do nothing, which is a confusing place to
  // leave an administrator — start it with whatever verbs they ticked.
  if (verbs.length) {
    await db.permissionRule.create({
      data: { orgId, functionId: fn.id, verbs: JSON.stringify(verbs), note: "Created with the function." },
    });
  }

  await audit({
    actor: admin, action: "FUNCTION_PUBLISHED", entityType: "Function", entityId: fn.id, entityLabel: name,
 detail: `Clearance ${clearance}; ${verbs.length ? verbs.join(", "): "no verbs yet"}.`,
  });
  revalidatePath("/admin/functions");
  return { ok: `${name} published.` };
}

export async function updateFunctionAction(
  _prev: { error?: string; ok?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireAdminScope();
  const { db, user: admin } = ctx;

  const id = String(formData.get("functionId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const clearance = Number(formData.get("clearance") ?? 1);
  const active = formData.get("active") === "on";

  const fn = await db.function.findFirst({ where: { id } });
  if (!fn) return { error: "That function is not published in your organization." };
  if (!Number.isInteger(clearance) || clearance < 1 || clearance > 9) {
 return { error: "Clearance is a level from 1 upwards." };
  }

  // Deactivating a function that people still hold would silently strip their
  // authority mid-project; §4.7's "retire, never delete while in use" applies
  // to the matrix as much as to a value set.
  if (!active && fn.active) {
    const holders = await db.projectMembership.count({ where: { functionId: id, active: true } });
    if (holders > 0) {
      return { error: `${holders} person(s) still hold ${fn.name}. Move them to another function first.` };
    }
  }

  await db.function.update({
    where: { id },
    data: { name: name || fn.name, clearance, active },
  });
  await audit({
    actor: admin, action: "FUNCTION_UPDATED", entityType: "Function", entityId: id, entityLabel: fn.name,
    oldValue: `clearance ${fn.clearance}/${fn.active ? "active" : "retired"}`,
    newValue: `clearance ${clearance}/${active ? "active" : "retired"}`,
  });
  revalidatePath("/admin/functions");
  return { ok: "Saved." };
}

/**
 * Add or replace a rule. §11.8 wants distribution "defined by classification
 * and recipient role" — the selectors are that classification, and leaving one
 * blank means "any".
 */
export async function savePermissionRuleAction(
  _prev: { error?: string; ok?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireAdminScope();
  const { db, orgId, user: admin } = ctx;

  const ruleId = String(formData.get("ruleId") ?? "").trim();
  const functionId = String(formData.get("functionId") ?? "").trim();
  const blank = (key: string) => String(formData.get(key) ?? "").trim() || null;

  const fn = await db.function.findFirst({ where: { id: functionId } });
  if (!fn) return { error: "Choose a function." };

  const verbs = readVerbs(formData);
  if (!verbs.length) return { error: "A rule with no verbs grants nothing — delete it instead." };

  const data = {
    deliverableType: blank("deliverableType"),
    docType: blank("docType"),
    discipline: blank("discipline"),
    criticality: blank("criticality"),
    confidentiality: blank("confidentiality"),
    verbs: JSON.stringify(verbs),
    note: blank("note"),
  };

  if (ruleId) {
    const existing = await db.permissionRule.findFirst({ where: { id: ruleId } });
    if (!existing) return { error: "That rule no longer exists." };
    await db.permissionRule.update({ where: { id: ruleId }, data });
  } else {
    await db.permissionRule.create({ data: { orgId, functionId, sort: 100, ...data } });
  }

  const selector = [data.deliverableType, data.docType, data.discipline, data.criticality, data.confidentiality]
    .filter(Boolean).join(" · ") || "any classification";
  await audit({
    actor: admin, action: "PERMISSION_RULE_PUBLISHED", entityType: "Function", entityId: functionId, entityLabel: fn.name,
    newValue: verbs.join(", "),
 detail: `${fn.name} — ${selector}.`,
  });
  revalidatePath("/admin/functions");
  return { ok: "Rule published." };
}

export async function deletePermissionRuleAction(
  _prev: { error?: string; ok?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireAdminScope();
  const { db, user: admin } = ctx;
  const ruleId = String(formData.get("ruleId") ?? "");

  const rule = await db.permissionRule.findFirst({ where: { id: ruleId }, include: { function: true } });
  if (!rule) return { error: "That rule no longer exists." };

  await db.permissionRule.delete({ where: { id: ruleId } });
  await audit({
    actor: admin, action: "PERMISSION_RULE_WITHDRAWN", entityType: "Function", entityId: rule.functionId,
    entityLabel: rule.function.name, oldValue: rule.verbs,
  });
  revalidatePath("/admin/functions");
  return { ok: "Rule withdrawn." };
}
