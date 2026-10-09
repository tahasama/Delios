import "server-only";
import { cache } from "react";
import { api } from "./client";

/**
 * The organization's directory and published rules, as administrators keep
 * them (`/api/admin/...`). Read here; changed by the settings actions.
 */

export type AdminMembership = {
  id: string; projectId: string; projectCode: string; projectName: string; functionId: string; functionCode: string; functionName: string;
  department: string | null; active: boolean;
};

export type AdminUser = {
  id: string; name: string; email: string; active: boolean; isAdmin: boolean; partyId: string | null; partyCode: string | null;
  partyName: string | null; internal: boolean; mfa: boolean; lockedUntil: string | null; createdAt: string; memberships: AdminMembership[];
};

export type AdminProject = {
  id: string; code: string; name: string; contractRole: string; kind?: string; status: string; timeZone: string; weekendDays: number[];
  contentExtraction: string; createdAt: string; members: number; documents: number;
};

export type AdminRule = {
  id: string; verbs: string[]; deliverableType: string | null; docType: string | null; discipline: string | null; criticality: string | null;
  confidentiality: string | null; projectRole: string | null;
  /** The family the row was written about: a family row is kept as one rule per type in it, each carrying the family. */
  family?: string | null; note?: string | null;
};

export type AdminFunction = { id: string; code: string; name: string; active: boolean; holders: number; rules: AdminRule[] };

export type AdminParty = {
  id: string; code: string; name: string; isInternal: boolean; active: boolean; participation: string; custodianFunction: string | null;
  externalSystem: string | null; evidenceRequired: boolean; people: number;
};

export type SchemeField = { label: string; source: string; value: string | null; digits: number | null };

export type AdminNumbering = {
  schemes: { id: string; name: string; delimiter: string; active: boolean; fields: SchemeField[] }[];
  routing: { id: string; deliverableType: string; schemeId: string; active: boolean }[];
  revisionSchemes: { id: string; name: string; isDefault: boolean; forwardOnly: boolean; series: { code: string; label: string; kind: string; prefix: string; start: string }[] }[];
  revisionRouting: { deliverableType: string; schemeId: string }[];
};

export type RouteStepView = {
  title: string; functionCode: string | null; partyCode: string | null; reason: string | null; mode: string; days: number | null; grantsStatuses: string[];
  userIds?: string[];
};

export type AdminRoute = {
  id: string; name: string; description: string | null; isDefault: boolean; active: boolean; verdictSet?: string | null;
  patterns: { deliverableType: string | null; docType: string | null; discipline: string | null; criticality: string | null; originator: string | null }[];
  steps: RouteStepView[];
};

export type AuditPage = {
  total: number; page: number; per: number; pages: number; actions: { action: string; count: number }[];
  rows: { id: number; at: string; actorId: string | null; actorName: string; action: string; entityType: string | null; entityId: string | null;
    entityLabel: string | null; detail: string | null; projectId: string | null }[];
};

export const adminUsers = cache(async () => api<AdminUser[]>("/api/admin/users"));
export const adminProjects = cache(async () => api<AdminProject[]>("/api/admin/projects"));
export const adminFunctions = cache(async () => api<AdminFunction[]>("/api/admin/functions"));
export const adminParties = cache(async () => api<AdminParty[]>("/api/admin/parties"));
export const adminNumbering = cache(async () => api<AdminNumbering>("/api/admin/numbering"));
export const adminRoutes = cache(async () => api<AdminRoute[]>("/api/admin/routes"));
export const adminValueSets = cache(async () => api<{ key: string; active: number; retired: number }[]>("/api/admin/value-sets"));

export async function adminAudit(query: { q?: string; action?: string; entityType?: string; projectId?: string; from?: string; to?: string; page?: number; per?: number }) {
  return api<AuditPage>("/api/admin/audit", { query });
}

/** The directory is an administrator's to read; anybody else gets empty lists, as the screens already show nothing to them. */
export async function orEmpty<T>(load: () => Promise<T[]>): Promise<T[]> {
  try {
    return await load();
  } catch {
    return [];
  }
}

// ── Numbering, as the numbering screen reads it ──────────────────────────────
// The screen builds a scheme from parts that each read a published list or a
// rule (a counter, a fixed text, the record's project or parties); the backend
// names what fills each part. The two say the same thing.

const SOURCE_BY_SET: Record<string, string> = {
  PROJECT_CODES: "PROJECT", SUBPROJECTS: "SUBPROJECT", SUPPLIER_CODES: "ORIGINATOR", PURCHASE_ORDERS: "CONTRACT_REF",
  DISCIPLINES: "DISCIPLINE", DOCUMENT_TYPES: "DOC_TYPE",
};
const SET_BY_SOURCE = Object.fromEntries(Object.entries(SOURCE_BY_SET).map(([set, source]) => [source, set]));
/** What the screen calls a record kind, and the backend's name for it. */
export const RECORD_KIND: Record<string, string> = { TRANSMITTAL: "@TRANSMITTAL", REVIEW: "@REVIEW", PACKAGE: "@PACKAGE", ACTION: "@ACTION" };

export type LegacyScheme = {
  id: string; name: string; delimiter: string; active: boolean; notes: string | null;
  fields: { id: string; position: number; label: string; valueSetKey: string | null; rule: string | null }[];
};

/** A backend part as the screen writes it: a list it reads, or a rule. */
export function legacyField(field: SchemeField, index: number, schemeId: string): LegacyScheme["fields"][number] {
  const base = { id: `${schemeId}-${index}`, position: index + 1, label: field.label };
  if (field.source === "SEQUENCE") return { ...base, valueSetKey: null, rule: `COUNTER:DIGITS(${field.digits ?? 4})` };
  if (field.source === "FIXED") return { ...base, valueSetKey: null, rule: `FIXED(${field.value ?? ""})` };
  if (field.source === "SENDER" || field.source === "RECEIVER") return { ...base, valueSetKey: null, rule: field.source };
  return { ...base, valueSetKey: SET_BY_SOURCE[field.source] ?? null, rule: SET_BY_SOURCE[field.source] ? null : field.source };
}

/** A screen part as the backend reads it. */
export function backendField(label: string, valueSetKey: string, rule: string): SchemeField {
  const said = rule.trim().toUpperCase();
  if (said.startsWith("COUNTER")) return { label, source: "SEQUENCE", value: null, digits: Number(said.match(/DIGITS\((\d+)\)/)?.[1] ?? 4) };
  const fixed = rule.trim().match(/^FIXED\(([^)]*)\)$/i);
  if (fixed) return { label, source: "FIXED", value: fixed[1], digits: null };
  if (said) return { label, source: said, value: null, digits: null };
  return { label, source: SOURCE_BY_SET[valueSetKey] ?? valueSetKey, value: null, digits: null };
}

/** The schemes and what each numbers, in the screen's shapes. */
export async function legacyNumbering() {
  const numbering = await adminNumbering();
  const schemes: LegacyScheme[] = numbering.schemes.map((s) => ({
    id: s.id, name: s.name, delimiter: s.delimiter, active: s.active, notes: null, fields: s.fields.map((f, i) => legacyField(f, i, s.id)),
  }));
  const kindOf = Object.fromEntries(Object.entries(RECORD_KIND).map(([screen, backend]) => [backend, screen]));
  const routing = numbering.routing.map((r) => ({
    deliverableType: kindOf[r.deliverableType] ?? r.deliverableType, schemeName: schemes.find((s) => s.id === r.schemeId)?.name ?? "",
    status: r.active ? "ACTIVE" : "INACTIVE",
  }));
  return { schemes, routing };
}

// ── Functions, as the matrix screen reads them ───────────────────────────────

/** Functions with their rows, in the screen's shapes: verbs as a JSON list, a holders count. */
export async function legacyFunctions() {
  const functions = await adminFunctions();
  return [...functions]
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
    .map((f) => ({
      id: f.id, code: f.code, name: f.name, active: f.active, description: null as string | null, department: null as string | null, sort: 0,
      _count: { memberships: f.holders },
      rules: f.rules.map((r, sort) => ({ ...r, functionId: f.id, verbs: JSON.stringify(r.verbs), note: null as string | null, sort })),
    }));
}

/** A function's rows as the backend takes them back. */
export function rulesBody(rules: AdminRule[]) {
  return rules.map((r) => ({
    verbs: r.verbs, deliverableType: r.deliverableType, docType: r.docType, discipline: r.discipline, criticality: r.criticality,
    confidentiality: r.confidentiality, projectRole: r.projectRole, family: r.family ?? null, note: r.note ?? null,
  }));
}

/**
 * The backend's rules as the matrix reads them: the rules a family row was kept as (one per document type in the
 * family, each carrying the family) read back as the one family rule they were written as.
 */
export function asMatrixRules(rules: AdminRule[]) {
  const out: { deliverableType: string | null; docType: string | null; discipline: string | null; criticality: string | null;
    confidentiality: string | null; projectRole: string | null; family: string | null; familyTypes: string[] | null; verbs: string[] }[] = [];
  const families = new Map<string, (typeof out)[number]>();
  for (const r of rules) {
    if (!r.family) {
      out.push({ deliverableType: r.deliverableType, docType: r.docType, discipline: r.discipline, criticality: r.criticality,
        confidentiality: r.confidentiality, projectRole: r.projectRole, family: null, familyTypes: null, verbs: r.verbs });
      continue;
    }
    const key = [r.family, r.deliverableType, r.discipline, r.criticality, r.confidentiality, r.projectRole, [...r.verbs].sort().join(",")].join("|");
    const one = families.get(key);
    if (one) { if (r.docType) one.familyTypes!.push(r.docType); continue; }
    const made = { deliverableType: r.deliverableType, docType: null, discipline: r.discipline, criticality: r.criticality,
      confidentiality: r.confidentiality, projectRole: r.projectRole, family: r.family, familyTypes: r.docType ? [r.docType] : [], verbs: r.verbs };
    families.set(key, made);
    out.push(made);
  }
  return out;
}

// ── Organizations, as the organizations screen reads them ─────────────────────
// Who answers for an organization (its contact and backup), and whether it is
// a collaborator or a guest, are the organization's own answers: kept in its
// settings under PARTY:<id>. How it takes part is the backend's.

export const PARTY_KEY = "PARTY:";
export type PartyAnswers = { kind?: string; contactId?: string | null; backupId?: string | null };

export async function legacyParties() {
  const { orgSettings } = await import("./settings");
  const [parties, users, answers] = await Promise.all([adminParties(), adminUsers(), orgSettings()]);
  const person = (id: string | null | undefined) => {
    const one = id ? users.find((u) => u.id === id) : null;
    return one ? { id: one.id, name: one.name, email: one.email } : null;
  };
  return [...parties]
    .sort((a, b) => Number(b.isInternal) - Number(a.isInternal) || a.name.localeCompare(b.name))
    .map((p) => {
      let said: PartyAnswers = {};
      try { said = JSON.parse(answers.get(PARTY_KEY + p.id) ?? "{}"); } catch { said = {}; }
      const contact = person(said.contactId);
      const backup = person(said.backupId);
      return {
        ...p, kind: p.participation === "BY_PROXY" ? "OFFLINE" : said.kind ?? "COLLABORATOR", liaisonFunction: p.custodianFunction,
        contactId: contact?.id ?? null, backupId: backup?.id ?? null, contact, backup: backup ? { id: backup.id, name: backup.name } : null,
        _count: { users: p.people },
      };
    });
}

// ── Review routes, as the routes screen reads them ───────────────────────────
// The screen's step names who answers by functions (by id), people or one
// outside party; the backend's step is answered by the holders of one
// function (by code) or by one party (by code), the first answer or all.

export type LegacyRouteStep = {
  act: "REVIEW" | "APPROVAL"; partyId?: string; mode: "ANY_OF" | "ALL_CONSOLIDATOR" | "SERIAL" | "ALL"; participantIds: string[];
  functionIds?: string[]; title?: string; days?: number; grantsStatuses?: string[];
};

export async function legacyRoutes() {
  const [routes, parties] = await Promise.all([adminRoutes(), adminParties()]);
  return routes.filter((r) => r.active).map((r) => ({
    id: r.id, name: r.name, description: r.description, isDefault: r.isDefault, outcomeSetKey: (r.verdictSet ?? "REVIEW_OUTCOMES") as string | null, createdAt: new Date(0),
    classes: r.patterns.length
      ? JSON.stringify(r.patterns.map((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v))))
      : "*",
    steps: JSON.stringify(r.steps.map((s, i): LegacyRouteStep => ({
      act: i === r.steps.length - 1 ? "APPROVAL" : "REVIEW",
      partyId: s.partyCode ? parties.find((p) => p.code === s.partyCode)?.id : undefined,
      mode: s.mode === "ALL" ? "ALL" : "ANY_OF",
      participantIds: s.userIds ?? [],
      functionIds: s.functionCode ? [s.functionCode] : [],
      title: s.title,
      days: s.days ?? undefined,
      grantsStatuses: s.grantsStatuses,
    }))),
  }));
}

/** A screen route as the backend takes it; what the backend cannot say is reported, not dropped in silence. */
export async function backendRoute(classes: string, steps: LegacyRouteStep[]): Promise<{ patterns: unknown[]; steps: unknown[] } | { error: string }> {
  const parties = await adminParties();
  if (steps.some((s) => (s.functionIds ?? []).length > 1)) return { error: "A step is answered by the holders of one function: choose one per step." };
  if (steps.some((s) => !s.partyId && !(s.functionIds ?? []).length && !s.participantIds.length)) return { error: "Say who answers each step: a function, people of ours, or an outside organization." };
  const patterns = classes === "*" ? [] : (JSON.parse(classes) as Record<string, string | undefined>[]).map((p) => ({
    deliverableType: p.deliverableType || null, docType: p.docType || null, discipline: p.discipline || null, criticality: p.criticality || null,
    originator: p.originator || null,
  }));
  return {
    patterns,
    steps: steps.map((s, i) => ({
      title: s.title || (i === steps.length - 1 ? "Decision" : `Review ${i + 1}`),
      functionCode: s.partyId ? null : (s.functionIds ?? [])[0] ?? null,
      userIds: s.partyId ? [] : s.participantIds,
      partyCode: s.partyId ? parties.find((p) => p.id === s.partyId)?.code ?? null : null,
      mode: s.mode === "ANY_OF" ? "ANY" : "ALL",
      days: s.days ?? null,
      grantsStatuses: s.grantsStatuses ?? [],
    })),
  };
}

// ── Controlled changes ────────────────────────────────────────────────────────
// Uploaded lists waiting for a decision: each kind and key is a set, its
// uploads the versions, newest first. The organization's lists and the
// project's are read together.

export type ControlledVersionRow = {
  id: string; key: string; title: string; state: string; versionLabel: string; rowCount: number; decidedAt: Date | null; decidedByName: string | null;
  decisionReason: string | null; createdAt: Date; submittedAt: Date | null; submittedById: string | null; submittedByName: string | null;
  sourceName: string | null; notes: string | null; diff: string | null;
};
export type ControlledSetRow = { id: string; key: string; title: string; kind: string; projectId: string | null; versions: ControlledVersionRow[] };

export async function controlledSets(scope?: { projectId: string }): Promise<ControlledSetRow[]> {
  const { controlledVersions } = await import("./records");
  const rows = [...(await controlledVersions(null)), ...(scope ? await controlledVersions(scope) : [])];
  const sets = new Map<string, ControlledSetRow>();
  for (const v of rows) {
    const id = `${v.projectId ?? "org"}|${v.kind}|${v.key}`;
    if (!sets.has(id)) sets.set(id, { id, key: v.key, title: v.title, kind: v.kind, projectId: v.projectId, versions: [] });
    sets.get(id)!.versions.push({
      id: v.id, key: v.key, title: v.title, state: v.state, versionLabel: v.versionLabel, rowCount: v.rowCount,
      decidedAt: v.decidedAt ? new Date(v.decidedAt) : null, decidedByName: v.decidedBy, decisionReason: v.decisionReason,
      createdAt: new Date(v.createdAt), submittedAt: v.submittedAt ? new Date(v.submittedAt) : null, submittedById: v.submittedById,
      submittedByName: v.submittedBy, sourceName: v.sourceName, notes: v.notes, diff: v.diff ? JSON.stringify(v.diff) : null,
    });
  }
  return [...sets.values()];
}

// ── The scope statement ───────────────────────────────────────────────────────
// The organization's statement of what it controls and how it is measured is
// its own answer, kept in its settings (SCOPE); a project may state its own
// scope (PROJECT_INFO), which then wins.

export type ScopeConfig = {
  organizationName: string; scopeStatement: string; assessmentLevel: string; standardVersion: string; effectiveDate: Date;
  integrityThreshold: number; measurementIntervalDays: number; controlFunctionName: string | null; dmpDocumentId: string | null;
};

export async function scopeConfig(projectId?: string): Promise<ScopeConfig | null> {
  const { orgSettings, projectSettings } = await import("./settings");
  const { STANDARD_VERSION } = await import("../standard");
  const { getMe } = await import("./me");
  const [org, project, me] = await Promise.all([orgSettings(), projectId ? projectSettings(projectId) : Promise.resolve(new Map<string, string>()), getMe()]);
  let said: Partial<Omit<ScopeConfig, "effectiveDate"> & { effectiveDate: string }> = {};
  let own: { scopeStatement?: string } = {};
  try { said = JSON.parse(org.get("SCOPE") ?? "{}"); } catch { said = {}; }
  try { own = JSON.parse(project.get("PROJECT_INFO") ?? "{}"); } catch { own = {}; }
  if (!org.get("SCOPE") && !own.scopeStatement) return null;
  return {
    organizationName: said.organizationName ?? me?.tenant.name ?? "",
    scopeStatement: own.scopeStatement ?? said.scopeStatement ?? "",
    assessmentLevel: said.assessmentLevel ?? "Full",
    standardVersion: said.standardVersion ?? STANDARD_VERSION,
    effectiveDate: new Date(said.effectiveDate ?? Date.now()),
    integrityThreshold: said.integrityThreshold ?? 95,
    measurementIntervalDays: said.measurementIntervalDays ?? 30,
    controlFunctionName: said.controlFunctionName ?? null,
    dmpDocumentId: said.dmpDocumentId ?? null,
  };
}
