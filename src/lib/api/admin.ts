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
  id: string; code: string; name: string; contractRole: string; status: string; timeZone: string; weekendDays: number[];
  contentExtraction: string; createdAt: string; members: number; documents: number;
};

export type AdminRule = {
  id: string; verbs: string[]; deliverableType: string | null; docType: string | null; discipline: string | null; criticality: string | null;
  confidentiality: string | null; projectRole: string | null;
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
};

export type AdminRoute = {
  id: string; name: string; description: string | null; isDefault: boolean; active: boolean;
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
    confidentiality: r.confidentiality, projectRole: r.projectRole,
  }));
}
