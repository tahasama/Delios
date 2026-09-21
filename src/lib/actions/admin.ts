"use server";

import { revalidatePath } from "next/cache";
import { requireAdminScope, requireScope, type Tenant } from "@/lib/scope";
import { redirect } from "next/navigation";
import { isAdmin, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ROLES } from "@/lib/standard";
import { buildProps } from "@/lib/config-props";
import { parseCsv, toObjects } from "@/lib/csv";
import { STANDARD_VERSION } from "@/lib/standard";

async function requireAdmin() {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  if (!isAdmin(user)) throw new Error("Administrators only.");
  return user;
}

export async function createUserAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  try {
    const ctx = await requireAdminScope();
  const { user: admin, db, projectId, orgId } = ctx;
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const name = String(formData.get("name") ?? "").trim();
    const functionId = String(formData.get("functionId") ?? "").trim();
    const organization = String(formData.get("organization") ?? "").trim() || null;
    const partyId = String(formData.get("partyId") ?? "").trim() || null;
    const password = String(formData.get("password") ?? "");
    if (!email || !name) return { error: "Name and email are required." };
    if (password.length < 8) return { error: "Password must be at least 8 characters." };

    // The function is what they will be able to do; it must be one this
    // organization has published (§1.4 — a requirement with no owner is not
    // implemented).
    const fn = functionId ? await db.function.findFirst({ where: { id: functionId, active: true } }) : null;
    if (!fn) return { error: "Choose the function this person will hold." };
    const role = fn.legacyRole;

    // Scoped: the same address may hold an account in another organization,
    // which is not this administrator's business and not a clash.
    const dup = await db.user.findFirst({ where: { email } });
    if (dup) return { error: "Someone in this organization already uses that email." };

    const party = partyId ? await db.party.findFirst({ where: { id: partyId } }) : null;
    if (partyId && !party) return { error: "Choose a valid party." };

    // Access is granted per project, so an account with no membership sees
    // nothing — say so rather than letting it look like a working account.
    // Zero projects is still allowed when the organization has none yet.
    const projectIds = formData.getAll("projectIds").map(String).filter(Boolean);
    const available = await db.project.count({ where: { orgId, status: "ACTIVE" } });
    if (!projectIds.length && available > 0) {
      return { error: "Choose at least one project — access is granted per project." };
    }
    const permitted = await db.project.findMany({ where: { orgId, id: { in: projectIds } }, select: { id: true } });
    if (permitted.length !== projectIds.length) return { error: "One of those projects is not in your organization." };

    const created = await db.user.create({
      data: { orgId, email, name, role, organization: party?.name ?? organization, partyId, passwordHash: await hashPassword(password), active: true },
    });
    if (permitted.length) {
      await db.projectMembership.createMany({
        data: permitted.map((p) => ({ projectId: p.id, userId: created.id, functionId: fn.id })),
      });
    }
    await audit({ actor: admin, action: "USER_CREATED", entityType: "User", entityId: email, entityLabel: name, newValue: fn.name, detail: `Added to ${permitted.length} project(s) as ${fn.name}.` });
    revalidatePath("/admin/users");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function updateUserAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  try {
    const ctx = await requireAdminScope();
  const { user: admin, db, projectId, orgId } = ctx;
    const userId = String(formData.get("userId") ?? "");
    const functionId = String(formData.get("functionId") ?? "").trim();
    const active = formData.get("active") === "on";
    const target = await db.user.findUniqueOrThrow({ where: { id: userId } });

    const fn = functionId ? await db.function.findFirst({ where: { id: functionId, active: true } }) : null;
    if (functionId && !fn) return { error: "That function is not published in your organization." };

    // Locking yourself out is never the intent, and an organization with no
    // administrator cannot publish anything again (§1.4 — accountability
    // passes upward, but not out of the building).
    if (target.id === admin.id && (!active || (fn && fn.legacyRole !== "ADMIN"))) {
      return { error: "You cannot remove your own access." };
    }

    const membership = await db.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId } },
      include: { function: true },
    });
    if (fn && !membership) return { error: `${target.name} is not on this project — add them from the project's people list.` };

    await db.user.update({ where: { id: userId }, data: { active, ...(fn ? { role: fn.legacyRole } : {}) } });
    if (fn && membership && membership.functionId !== fn.id) {
      await db.projectMembership.update({ where: { id: membership.id }, data: { functionId: fn.id } });
    }
    // The department someone answers for: receives its requirements call and confirms its readiness.
    const department = formData.has("department") ? String(formData.get("department") ?? "").trim() || null : undefined;
    if (department !== undefined && membership && membership.department !== department) {
      await db.projectMembership.update({ where: { id: membership.id }, data: { department } });
    }
    await audit({
      actor: admin,
      action: "USER_UPDATED",
      entityType: "User",
      entityId: target.email,
      entityLabel: target.name,
      field: "function/active",
      oldValue: `${membership?.function.name ?? "—"}/${target.active}`,
      newValue: `${fn?.name ?? membership?.function.name ?? "—"}/${active}`,
      detail: fn ? `Function on ${ctx.project.code} set to ${fn.name}.` : undefined,
    });
    revalidatePath("/admin/users");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function addConfigValueAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  try {
    const ctx = await requireAdminScope();
  const { user: admin, db, projectId, orgId } = ctx;
    const setKey = String(formData.get("setKey") ?? "");
    const code = String(formData.get("code") ?? "").trim();
    const label = String(formData.get("label") ?? "").trim();
    if (!setKey || !code || !label) return { error: "Set, code and label are required." };
    const set = await db.configSet.findFirst({ where: { key: setKey } });
    if (!set) return { error: "Unknown value set." };
    const dup = await db.configValue.findFirst({ where: { setKey, code } });
    if (dup) {
      if (dup.status === "RETIRED") return { error: "That code exists but is retired — reactivate it instead (values in use are never deleted, §4.7)." };
      return { error: "Code already exists in this set." };
    }
    const count = await db.configValue.count({ where: { setKey } });
    const props = buildProps(setKey, formData);
    await db.configValue.create({ data: { orgId, setKey, code, label, sort: count, props } });
    await db.configSet.update({ where: { orgId_key: { orgId, key: setKey } }, data: { version: { increment: 1 } } });
    await audit({ actor: admin, action: "CONFIG_VALUE_ADDED", entityType: "ConfigValue", entityId: `${setKey}.${code}`, entityLabel: label, detail: `Set "${setKey}" — version incremented (§4.7).` });
    revalidatePath("/admin/config");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}

/** Create a brand-new published set (the organization defines its own lists). */
export async function createConfigSetAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  try {
    const ctx = await requireAdminScope();
  const { user: admin, db, projectId, orgId } = ctx;
    const key = String(formData.get("key") ?? "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    if (!key || !title) return { error: "Key and title are required." };
    if (key.length > 40) return { error: "Keep the key under 40 characters." };
    const dup = await db.configSet.findFirst({ where: { key } });
    if (dup) return { error: "A set with that key already exists." };
    await db.configSet.create({ data: { orgId, key, title, description, version: 1 } });
    await audit({ actor: admin, action: "CONFIG_SET_CREATED", entityType: "ConfigSet", entityId: key, entityLabel: title, detail: "Organization-defined value set published (§4.7)." });
    revalidatePath("/admin/config");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}

/** Edit a value's properties through the set's structured prop fields. */
export async function updateValuePropsAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  try {
    const ctx = await requireAdminScope();
  const { user: admin, db, projectId, orgId } = ctx;
    const valueId = String(formData.get("valueId") ?? "");
    const setKey = String(formData.get("setKey") ?? "");
    const code = String(formData.get("code") ?? "").trim();
    const label = String(formData.get("label") ?? "").trim();
    const props = buildProps(setKey, formData);
    const value = await db.configValue.findUniqueOrThrow({ where: { id: valueId } });
    if (code && code !== value.code) {
      if (await configValueIsUsed(ctx, value.setKey, value.code)) return { error: "This code is already in use. Retire it and publish a replacement so historical metadata stays interpretable." };
      const duplicate = await db.configValue.findFirst({ where: { setKey, code } });
      if (duplicate) return { error: "That code already exists in this set." };
    }
    await db.configValue.update({ where: { id: valueId }, data: { code: code || value.code, label: label || value.label, props } });
    await db.configSet.update({ where: { orgId_key: { orgId, key: setKey } }, data: { version: { increment: 1 } } });
    await audit({ actor: admin, action: "CONFIG_VALUE_UPDATED", entityType: "ConfigValue", entityId: `${setKey}.${value.code}`, newValue: props, detail: `Properties of ${value.code} changed; set version incremented (§4.7).` });
    revalidatePath("/admin/config");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function retireConfigValueAction(formData: FormData) {
  try {
    const ctx = await requireAdminScope();
  const { user: admin, db, projectId, orgId } = ctx;
    const valueId = String(formData.get("valueId") ?? "");
    const value = await db.configValue.findFirstOrThrow({ where: { id: valueId } });
    const next = value.status === "ACTIVE" ? "RETIRED" : "ACTIVE";
    // Retired codes stay on existing documents but cannot be used on new ones (§4.7)
    await db.configValue.update({ where: { id: valueId }, data: { status: next } });
    await db.configSet.update({ where: { orgId_key: { orgId, key: value.setKey } }, data: { version: { increment: 1 } } });
    await audit({ actor: admin, action: "CONFIG_VALUE_RETIRED", entityType: "ConfigValue", entityId: `${value.setKey}.${value.code}`, oldValue: value.status, newValue: next });
    revalidatePath("/admin/config");
  } catch {
    // ignore
  }
}

export async function setScopeAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  try {
    const ctx = await requireAdminScope();
  const { user: admin, db, projectId, orgId } = ctx;
    const organizationName = String(formData.get("organizationName") ?? "").trim();
    const scopeStatement = String(formData.get("scopeStatement") ?? "").trim();
    const assessmentLevel = String(formData.get("assessmentLevel") ?? "Full");
    const integrityThreshold = Number(formData.get("integrityThreshold") ?? 95);
    const measurementIntervalDays = Number(formData.get("measurementIntervalDays") ?? 30);
    if (!organizationName || !scopeStatement) return { error: "Organization and scope statement are required (§1.2 / SC-01)." };
    const existing = await db.scopeConfig.findFirst();
    if (existing) {
      await db.scopeConfig.update({ where: { id: existing.id }, data: { organizationName, scopeStatement, assessmentLevel, integrityThreshold, measurementIntervalDays } });
    } else {
      await db.scopeConfig.create({ data: { projectId, organizationName, scopeStatement, assessmentLevel, standardVersion: STANDARD_VERSION, effectiveDate: new Date(), integrityThreshold, measurementIntervalDays } });
    }
    await audit({ actor: admin, action: "SCOPE_UPDATED", entityType: "ScopeConfig", entityId: "scope", detail: "Scope & conformance statement updated (§1.2, §1.6)." });
    revalidatePath("/admin");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}

/** Publish a new version of the approval authority matrix (§8.2 — versioned). */
export async function addAuthorityRowAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  try {
    const ctx = await requireAdminScope();
  const { user: admin, db, projectId, orgId } = ctx;
    const discipline = String(formData.get("discipline") ?? "") || null;
    const docType = String(formData.get("docType") ?? "") || null;
    const criticality = String(formData.get("criticality") ?? "") || null;
    const minRole = String(formData.get("minRole") ?? "APPROVER");
    const rows = await db.authorityRow.findMany({ where: { active: true } });
    const version = rows.length ? Math.max(...rows.map((r) => r.version)) : 1;
    // new row lands in a NEW version — the version in force at approval stays identifiable
    await db.authorityRow.updateMany({ where: { active: true, version }, data: { active: false } });
    await db.authorityRow.createMany({
      data: [
        ...rows.filter((r) => r.version === version).map((r) => ({ orgId, version: version + 1, discipline: r.discipline, docType: r.docType, criticality: r.criticality, minRole: r.minRole, active: true })),
        { orgId, version: version + 1, discipline, docType, criticality, minRole, active: true },
      ],
    });
    await audit({ actor: admin, action: "AUTHORITY_PUBLISHED", entityType: "AuthorityMatrix", entityId: `v${version + 1}`, detail: `Matrix v${version + 1} published — approvals record the version in force (§8.2).` });
    revalidatePath("/admin/authority");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function addAssetAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  try {
    const ctx = await requireAdminScope();
    const { user: admin, db, projectId, orgId } = ctx;
    const code = String(formData.get("code") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const area = String(formData.get("area") ?? "").trim() || null;
    const system = String(formData.get("system") ?? "").trim() || null;
    if (!code || !name) return { error: "Code and name are required." };
    const dup = await db.assetItem.findFirst({ where: { code } });
    if (dup) return { error: "Asset code already exists." };
    await db.assetItem.create({ data: { projectId, code, name, area, system } });
    revalidatePath("/assets");
    revalidatePath("/admin/assets");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function addExceptionAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  try {
    const ctx = await requireAdminScope();
  const { user: admin, db, projectId, orgId } = ctx;
    const item = String(formData.get("item") ?? "").trim();
    const clauses = String(formData.get("clauses") ?? "").trim();
    const reason = String(formData.get("reason") ?? "").trim();
    const authority = String(formData.get("authority") ?? "").trim();
    const startDate = String(formData.get("startDate") ?? "");
    const reviewPoint = String(formData.get("reviewPoint") ?? "") || null;
    if (!item || !clauses || !reason || !authority || !startDate) return { error: "An exception records what is exempt, clauses, reason, granting authority and dates (§1.10)." };
    await db.exceptionEntry.create({ data: { projectId, item, clauses, reason, authority, startDate: new Date(startDate), reviewPoint: reviewPoint ? new Date(reviewPoint) : null } });
    await audit({ actor: admin, action: "EXCEPTION_GRANTED", entityType: "ExceptionEntry", entityId: item, detail: `Clauses ${clauses} — ${authority} (§1.10). Unpublished exemptions are non-conformances.` });
    revalidatePath("/admin");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}

// §3.7 / B.1.7 — issue a block of numbers to a named party
export async function issueNumberRangeAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  try {
    const ctx = await requireAdminScope();
  const { user: admin, db, projectId, orgId } = ctx;
    const prefix = String(formData.get("prefix") ?? "").trim();
    const from = Number(formData.get("from") ?? "");
    const to = Number(formData.get("to") ?? "");
    const issuedTo = String(formData.get("issuedTo") ?? "").trim();
    if (!prefix || !issuedTo) return { error: "Prefix and the named party are required (§3.7)." };
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < from) return { error: "The range must be from ≤ to, starting at 1." };
    await db.numberRange.create({ data: { projectId, prefix, from, to, lastIssued: from - 1, issuedTo } });
    await audit({ actor: admin, action: "RANGE_ISSUED", entityType: "NumberRange", entityId: `${prefix} ${from}-${to}`, entityLabel: issuedTo, detail: "Range issued to a named party; numbers drawn down from it (§3.7)." });
    revalidatePath("/admin/numbering");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}


/** Rename and describe a set. Renaming migrates its references atomically. */
export async function updateConfigSetAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  try {
    const ctx = await requireAdminScope();
  const { user: admin, db, projectId, orgId } = ctx;
    const oldKey = String(formData.get("oldKey") ?? "");
    const key = String(formData.get("key") ?? "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    if (!oldKey || !key || !title) return { error: "Key and title are required." };
    const current = await db.configSet.findFirst({ where: { key: oldKey } });
    if (!current) return { error: "Set not found." };
    if (key !== oldKey && await db.configSet.findFirst({ where: { key } })) return { error: "Another set already uses that key." };
    if (key === oldKey) {
      await db.configSet.update({ where: { orgId_key: { orgId, key: oldKey } }, data: { title, description, version: { increment: 1 } } });
    } else {
      await db.$transaction([
        db.configSet.create({ data: { orgId, key, title, description, version: current.version + 1 } }),
        db.configValue.updateMany({ where: { setKey: oldKey }, data: { setKey: key } }),
        db.workflowTemplate.updateMany({ where: { outcomeSetKey: oldKey }, data: { outcomeSetKey: key } }),
        db.schemeField.updateMany({ where: { valueSetKey: oldKey }, data: { valueSetKey: key } }),
        db.configSet.delete({ where: { orgId_key: { orgId, key: oldKey } } }),
      ]);
    }
    await audit({ actor: admin, action: "CONFIG_SET_UPDATED", entityType: "ConfigSet", entityId: key, entityLabel: title, oldValue: oldKey, newValue: key, detail: "Set definition and references updated atomically." });
    revalidatePath("/admin/config");
    revalidatePath("/admin/numbering");
    revalidatePath("/admin/workflow-templates");
    if (key !== oldKey) redirect(`/admin/config?set=${encodeURIComponent(key)}`);
    return { ok: `Published ${title} as ${key}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not update the set." };
  }
}

async function configValueIsUsed(t: Tenant, setKey: string, code: string) {
  const { db } = t;
  const [documents, revisions, transmittals, workflows, valuesInSet] = await Promise.all([
    db.document.count({ where: { OR: [
      { docType: code }, { discipline: code }, { criticality: code }, { confidentiality: code },
      { retentionClass: code }, { deliverableType: code }, { originator: code },
      { subProject: code }, { contractRef: code },
    ] } }),
    db.revision.count({ where: { OR: [{ statusCode: code }, { phase: code }] } }),
    db.transmittal.count({ where: { reasonForIssue: code } }),
    db.workflowTemplate.count({ where: { outcomeSetKey: setKey } }),
    db.configValue.count({ where: { setKey } }),
  ]);
  return documents > 0 || revisions > 0 || transmittals > 0 || (workflows > 0 && valuesInSet <= 1);
}

/** Move a published value without changing its durable code. */
export async function moveConfigValueAction(formData: FormData) {
  try {
    const ctx = await requireAdminScope();
  const { user: admin, db, projectId, orgId } = ctx;
    const valueId = String(formData.get("valueId") ?? "");
    const direction = String(formData.get("direction") ?? "up");
    const value = await db.configValue.findUniqueOrThrow({ where: { id: valueId } });
    const values = await db.configValue.findMany({ where: { setKey: value.setKey }, orderBy: [{ sort: "asc" }, { code: "asc" }] });
    const index = values.findIndex((item) => item.id === valueId);
    const target = direction === "down" ? index + 1 : index - 1;
    if (index < 0 || target < 0 || target >= values.length) return;
    [values[index], values[target]] = [values[target], values[index]];
    await db.$transaction([
      ...values.map((item, sort) => db.configValue.update({ where: { id: item.id }, data: { sort } })),
      db.configSet.update({ where: { orgId_key: { orgId, key: value.setKey } }, data: { version: { increment: 1 } } }),
    ]);
    await audit({ actor: admin, action: "CONFIG_VALUE_REORDERED", entityType: "ConfigValue", entityId: `${value.setKey}.${value.code}`, entityLabel: value.label, detail: `Moved ${direction}; set version incremented (§4.7).` });
    revalidatePath("/admin/config");
  } catch {
    // The configuration screen remains usable; ActionForm surfaces edits that need validation.
  }
}

/** Create or revise an organization numbering scheme and its ordered fields. */
export async function saveNumberingSchemeAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  try {
    const ctx = await requireAdminScope();
  const { user: admin, db, projectId, orgId } = ctx;
    const id = String(formData.get("id") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const delimiter = String(formData.get("delimiter") ?? "-").trim();
    const notes = String(formData.get("notes") ?? "").trim() || null;
    const labels = formData.getAll("fieldLabel").map((value) => String(value).trim());
    const setKeys = formData.getAll("fieldSetKey").map((value) => String(value).trim());
    const rules = formData.getAll("fieldRule").map((value) => String(value).trim());
    if (!name) return { error: "Give the scheme a name." };
    if (delimiter.length !== 1 || /[A-Za-z0-9]/.test(delimiter)) return { error: "The delimiter must be one non-alphanumeric character." };
    if (!labels.length || labels.some((label) => !label)) return { error: "Every numbering field needs a label." };
    if (!rules.some((rule) => rule.startsWith("COUNTER:"))) return { error: "Add one sequence counter field so numbers remain unique." };
    if (rules.filter((rule) => rule.startsWith("COUNTER:")).length > 1) return { error: "Use one sequence counter per scheme." };

    const existing = id ? await db.scheme.findUniqueOrThrow({ where: { id } }) : null;
    const duplicate = await db.scheme.findFirst({ where: { name } });
    if (duplicate && duplicate.id !== id) return { error: "A scheme with this name already exists." };
    const scheme = id
      ? await db.scheme.update({ where: { id }, data: { name, delimiter, notes } })
      : await db.scheme.create({ data: { orgId, name, delimiter, notes } });
    if (existing && existing.name !== name) {
      await db.schemeRouting.updateMany({ where: { schemeName: existing.name }, data: { schemeName: name } });
    }
    await db.schemeField.deleteMany({ where: { schemeId: scheme.id } });
    await db.schemeField.createMany({ data: labels.map((label, index) => ({ schemeId: scheme.id, position: index + 1, label, valueSetKey: setKeys[index] || null, rule: rules[index] || null })) });
    await audit({ actor: admin, action: "NUMBERING_SCHEME_SAVED", entityType: "Scheme", entityId: scheme.id, entityLabel: name, detail: `${labels.length} fields; delimiter "${delimiter}".` });
    revalidatePath("/admin/numbering");
    return { ok: `Published ${name}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save the numbering scheme." };
  }
}

export async function saveSchemeRoutingAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  try {
    const ctx = await requireAdminScope();
  const { user: admin, db, projectId, orgId } = ctx;
    const deliverableType = String(formData.get("deliverableType") ?? "").trim();
    const schemeName = String(formData.get("schemeName") ?? "").trim();
    if (!deliverableType || !schemeName) return { error: "Choose a deliverable type and a scheme." };
    const scheme = await db.scheme.findFirst({ where: { name: schemeName } });
    if (!scheme || !scheme.active) return { error: "That numbering scheme is not active." };
    await db.schemeRouting.upsert({ where: { orgId_deliverableType: { orgId, deliverableType } }, update: { schemeName, status: "ACTIVE" }, create: { orgId, deliverableType, schemeName, status: "ACTIVE" } });
    await audit({ actor: admin, action: "SCHEME_ROUTED", entityType: "SchemeRouting", entityId: deliverableType, entityLabel: deliverableType, newValue: schemeName });
    revalidatePath("/admin/numbering");
    return { ok: `${deliverableType} now uses ${schemeName}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not publish the routing rule." };
  }
}

export async function removeNumberingSchemeAction(formData: FormData) {
  const ctx = await requireAdminScope();
  const { user: admin, db, projectId, orgId } = ctx;
  const id = String(formData.get("id") ?? "");
  const scheme = await db.scheme.findUnique({ where: { id } });
  if (!scheme) return;
  const routed = await db.schemeRouting.count({ where: { schemeName: scheme.name, status: "ACTIVE" } });
  if (routed) return;
  await db.schemeField.deleteMany({ where: { schemeId: id } });
  await db.scheme.delete({ where: { id } });
  await audit({ actor: admin, action: "NUMBERING_SCHEME_REMOVED", entityType: "Scheme", entityId: id, entityLabel: scheme.name, detail: "Unused scheme removed." });
  revalidatePath("/admin/numbering");
}

/** Delete a value that was never used (unused values only; in-use ones are retired, §4.7). */
export async function deleteValueAction(formData: FormData) {
  try {
    const ctx = await requireScope();
  const { user: admin, db, projectId, orgId } = ctx;
    if (admin.role !== "ADMIN") return;
    const valueId = String(formData.get("valueId") ?? "");
    const value = await db.configValue.findUniqueOrThrow({ where: { id: valueId } });
    if (await configValueIsUsed(ctx, value.setKey, value.code)) {
      // in use — retire instead (§4.7)
      await db.configValue.update({ where: { id: valueId }, data: { status: "RETIRED" } });
      await audit({ actor: admin, action: "CONFIG_VALUE_RETIRED", entityType: "ConfigValue", entityId: `${value.setKey}.${value.code}`, detail: "In use — retired rather than deleted (§4.7)." });
    } else {
      await db.configValue.delete({ where: { id: valueId } });
      await audit({ actor: admin, action: "CONFIG_VALUE_DELETED", entityType: "ConfigValue", entityId: `${value.setKey}.${value.code}`, detail: "Never used — deleted." });
    }
    await db.configSet.update({ where: { orgId_key: { orgId, key: value.setKey } }, data: { version: { increment: 1 } } });
    revalidatePath("/admin/config");
  } catch {
    // ignore
  }
}

/** Delete a whole set when it is unused by documents/workflows. */
export async function deleteSetAction(formData: FormData) {
  try {
    const ctx = await requireScope();
  const { user: admin, db, projectId, orgId } = ctx;
    if (admin.role !== "ADMIN") return;
    const key = String(formData.get("key") ?? "");
    if (["STATUSES", "REVIEW_OUTCOMES", "REASONS_FOR_ISSUE", "COMMENT_CLASSES", "CRITICALITY", "CONFIDENTIALITY", "RETENTION_CLASSES"].includes(key)) {
      return; // the Standard's operational sets cannot be deleted, only edited
    }
    const usedByScheme = (await db.schemeField.count({ where: { valueSetKey: key } })) > 0;
    const usedByWorkflow = (await db.workflowTemplate.count({ where: { outcomeSetKey: key } })) > 0;
    if (usedByScheme || usedByWorkflow) return;
    await db.configValue.deleteMany({ where: { setKey: key } });
    await db.configSet.delete({ where: { orgId_key: { orgId, key } } });
    await audit({ actor: admin, action: "CONFIG_SET_DELETED", entityType: "ConfigSet", entityId: key, detail: "Unused set deleted by the organization." });
    revalidatePath("/admin/config");
  } catch {
    // ignore
  }
}
