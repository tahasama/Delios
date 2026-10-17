import "server-only";
import { cache } from "react";
import { api } from "@/lib/client";

/**
 * The organization's directory and published rules, as administrators keep
 * them (`/api/admin/...`). Read here; changed by the settings actions.
 */

type AdminMembership = {
  id: string; projectId: string; projectCode: string; projectName: string; functionId: string; functionCode: string; functionName: string;
  department: string | null; active: boolean;
  /** Added while whoever holds Manage confirms who joins: waiting, or refused with why, or confirmed. */
  pendingSince?: string | null; proposedByName?: string | null; confirmerName?: string | null;
  refusedAt?: string | null; refusedByName?: string | null; refusedReason?: string | null;
  confirmedAt?: string | null; confirmedByName?: string | null;
};

type AdminUser = {
  id: string; name: string; email: string; active: boolean; isAdmin: boolean; partyId: string | null; partyCode: string | null;
  partyName: string | null; internal: boolean;
  /** Works here from its own organization's DELIOS: signs in at home; name and email are theirs. */
  linked?: boolean;
  mfa: boolean; lockedUntil: string | null; createdAt: string; memberships: AdminMembership[];
};

type AdminProject = {
  id: string; code: string; name: string; contractRole: string; kind?: string; status: string; timeZone: string; weekendDays: number[];
  contentExtraction: string; createdAt: string; members: number; documents: number;
  /** Why it was last archived or reopened, by whom, when. */
  statusReason?: string | null; statusChangedByName?: string | null; statusChangedAt?: string | null;
  /** Its code before its one change, by whom, when: once changed, the code is fixed. */
  previousCode?: string | null; codeChangedByName?: string | null; codeChangedAt?: string | null;
};

export type AdminRule = {
  id: string; verbs: string[]; deliverableType: string | null; docType: string | null; discipline: string | null; criticality: string | null;
  confidentiality: string | null; projectRole: string | null;
  /** The family the row was written about: a family row is kept as one rule per type in it, each carrying the family. */
  family?: string | null; note?: string | null;
};

export type AdminFunction = { id: string; code: string; name: string; active: boolean; holders: number; rules: AdminRule[]; clearance?: string | null };

type AdminParty = {
  id: string; code: string; name: string; isInternal: boolean; active: boolean; participation: string; custodianFunction: string | null;
  /** The person of ours who works for it (one nobody of which signs in); null: the control function. */
  carriedByUserId?: string | null;
  externalSystem: string | null; evidenceRequired: boolean; people: number;
  /** Not on DELIOS: where our transmittals go by email, and whose replies are taken in. */
  contactEmail?: string | null;
  /** Collaborator (linked to its own DELIOS organization), guest, or not on DELIOS (docs/ORGANIZATIONS.md); null for ours. */
  kind?: "COLLABORATOR" | "GUEST" | "NOT_ON_DELIOS" | null;
  /** Its open link with its own DELIOS organization: invited, or linked. */
  link?: { id: string; state: "INVITED" | "LINKED"; organization: string } | null;
  /**
   * What was changed once and is fixed now: its code and name (one of each across DELIOS), how it works with us; and
   * whether it is another organization on DELIOS, which alone changes its own code and name.
   */
  changed?: {
    code: { was: string; by: string; at: string } | null; name: { was: string; by: string; at: string } | null;
    participation: { was: string; by: string; at: string } | null; theirs: boolean;
    /** The organization as DELIOS knows it (one row for every list holding it), its identifier and email domain. */
    id: string; identifier: { country: string; kind: string; number: string } | null;
    identifierWas: { was: string; by: string; at: string } | null; noIdentifierReason: string | null;
    domain: string | null; domainConfirmed: boolean; onDelios: boolean;
  } | null;
};

type SchemeField = { label: string; source: string; value: string | null; digits: number | null };

type AdminNumbering = {
  schemes: { id: string; name: string; delimiter: string; active: boolean; fields: SchemeField[] }[];
  routing: { id: string; deliverableType: string; schemeId: string; active: boolean }[];
  revisionSchemes: { id: string; name: string; isDefault: boolean; forwardOnly: boolean; series: RevisionSeries[] }[];
  revisionRouting: { deliverableType: string; schemeId: string }[];
};

type RouteStepView = {
  title: string; functionCode: string | null; partyCode: string | null; reason: string | null; mode: string; days: number | null; grantsStatuses: string[];
  userIds?: string[];
};

type AdminRoute = {
  id: string; name: string; description: string | null; isDefault: boolean; active: boolean; verdictSet?: string | null;
  patterns: { deliverableType: string | null; docType: string | null; discipline: string | null; criticality: string | null; originator: string | null }[];
  steps: RouteStepView[];
};

export type AuditPage = {
  total: number; page: number; per: number; pages: number; actions: { action: string; count: number; kind: string }[];
  /** The kinds of act (worked out by the backend, `AuditKinds`), each counted. */
  kinds: { key: string; label: string; count: number }[];
  rows: { id: number; at: string; actorId: string | null; actorName: string; action: string; kind: string; entityType: string | null; entityId: string | null;
    entityLabel: string | null; detail: string | null; projectId: string | null; project: string | null }[];
};

export const adminUsers = cache(async () => api<AdminUser[]>("/api/admin/users"));
export const adminProjects = cache(async () => api<AdminProject[]>("/api/admin/projects"));
export const adminFunctions = cache(async () => api<AdminFunction[]>("/api/admin/functions"));
export const adminParties = cache(async () => api<AdminParty[]>("/api/admin/parties"));
/** One series of a revision scheme (backend RevisionSeriesRule). */
export type RevisionSeries = {
  code: string; label: string; kind: string; prefix: string; start: string; width: number; lowercase: boolean; excludedLetters: string[];
  /** The phase it names revisions in; none: the default line. */
  phase?: string | null;
};

export const adminNumbering = cache(async () => api<AdminNumbering>("/api/admin/numbering"));
export const adminRoutes = cache(async () => api<AdminRoute[]>("/api/admin/routes"));
export const adminValueSets = cache(async () => api<{ key: string; active: number; retired: number }[]>("/api/admin/value-sets"));

export async function adminAudit(query: { q?: string; kind?: string; action?: string; entityType?: string; projectId?: string; actorId?: string; from?: string; to?: string; page?: number; per?: number }) {
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
export const RECORD_KIND: Record<string, string> = { TRANSMITTAL: "@TRANSMITTAL", REVIEW: "@REVIEW", PACKAGE: "@PACKAGE", ASSET: "@ASSET", ACTION: "@ACTION" };

type EditorScheme = {
  id: string; name: string; delimiter: string; active: boolean; notes: string | null;
  fields: { id: string; position: number; label: string; valueSetKey: string | null; rule: string | null }[];
};

/** A backend part as the screen writes it: a list it reads, or a rule. */
function editorField(field: SchemeField, index: number, schemeId: string): EditorScheme["fields"][number] {
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
export async function numberingForEditor() {
  const numbering = await adminNumbering();
  const schemes: EditorScheme[] = numbering.schemes.map((s) => ({
    id: s.id, name: s.name, delimiter: s.delimiter, active: s.active, notes: null, fields: s.fields.map((f, i) => editorField(f, i, s.id)),
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
export async function functionsForMatrix() {
  const functions = await adminFunctions();
  return [...functions]
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
    .map((f) => ({
      id: f.id, code: f.code, name: f.name, active: f.active, description: null as string | null, department: null as string | null, sort: 0,
      clearance: f.clearance ?? null,
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
// Who answers for an organization (its contact and backup) are the organization's
// own answers: kept in its settings under PARTY:<id>. Its kind (collaborator,
// guest, not on DELIOS) is the backend's.

export const PARTY_KEY = "PARTY:";
type PartyAnswers = { contactId?: string | null; backupId?: string | null };

/** The organizations, with who answers for each on this project (said per project; an older organization-wide answer still counts). */
export async function partiesWithAnswers(projectId?: string) {
  const { orgSettings, projectSettings } = await import("@/lib/settings/api");
  const [parties, users, org, here] = await Promise.all([
    adminParties(), adminUsers(), orgSettings(), projectId ? projectSettings(projectId).catch(() => new Map<string, string>()) : Promise.resolve(new Map<string, string>()),
  ]);
  const answers = { get: (key: string) => here.get(key) ?? org.get(key) };
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
        ...p, kind: p.kind === "COLLABORATOR" ? "COLLABORATOR" : p.kind === "NOT_ON_DELIOS" || p.participation === "BY_PROXY" ? "OFFLINE" : "GUEST",
        liaisonFunction: p.custodianFunction,
        contactId: contact?.id ?? null, backupId: backup?.id ?? null, contact, backup: backup ? { id: backup.id, name: backup.name } : null,
        _count: { users: p.people },
      };
    });
}

// ── Review routes, as the routes screen reads them ───────────────────────────
// The screen's step names who answers by functions (by id), people or one
// outside party; the backend's step is answered by the holders of one
// function (by code) or by one party (by code), the first answer or all.

export type EditorRouteStep = {
  act: "REVIEW" | "APPROVAL"; partyId?: string; mode: "ANY_OF" | "ALL_CONSOLIDATOR" | "SERIAL" | "ALL"; participantIds: string[];
  functionIds?: string[]; title?: string; days?: number; grantsStatuses?: string[];
};

export async function routesForEditor() {
  const [routes, parties] = await Promise.all([adminRoutes(), adminParties()]);
  return routes.filter((r) => r.active).map((r) => ({
    id: r.id, name: r.name, description: r.description, isDefault: r.isDefault, outcomeSetKey: (r.verdictSet ?? "REVIEW_OUTCOMES") as string | null, createdAt: new Date(0),
    classes: r.patterns.length
      ? JSON.stringify(r.patterns.map((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v))))
      : "*",
    steps: JSON.stringify(r.steps.map((s, i): EditorRouteStep => ({
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
export async function backendRoute(classes: string, steps: EditorRouteStep[]): Promise<{ patterns: unknown[]; steps: unknown[] } | { error: string }> {
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

type ControlledVersionRow = {
  id: string; key: string; title: string; state: string; versionLabel: string; rowCount: number; decidedAt: Date | null; decidedByName: string | null;
  decisionReason: string | null; createdAt: Date; submittedAt: Date | null; submittedById: string | null; submittedByName: string | null;
  sourceName: string | null; notes: string | null; diff: string | null;
};
type ControlledSetRow = { id: string; key: string; title: string; kind: string; projectId: string | null; versions: ControlledVersionRow[] };

export async function controlledSets(scope?: { projectId: string }): Promise<ControlledSetRow[]> {
  const { controlledVersions } = await import("@/lib/records/api");
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
// What a project controls is said on This project (PROJECT_INFO); how it is
// measured is the project's answer on Assurance (MEASURE). The organization's
// older SCOPE answer is read only where neither says. The organization's name is
// its own, never typed again.

export type ScopeConfig = {
  organizationName: string; scopeStatement: string; standardVersion: string; effectiveDate: Date;
  integrityThreshold: number; measurementIntervalDays: number; controlFunctionName: string | null; dmpDocumentId: string | null;
  /** Who last changed how it is measured, and when; null while the defaults stand. */
  measuredBy: { name: string; at: string } | null;
};

/** How a project is measured: the share of clear documents it aims at, and how often it is checked. */
export const MEASURE_KEY = "MEASURE";

export async function scopeConfig(projectId?: string): Promise<ScopeConfig> {
  const { orgSettings, projectSettings } = await import("@/lib/settings/api");
  const { STANDARD_VERSION } = await import("@/lib/core/standard");
  const { getMe } = await import("@/lib/account/api");
  const [org, project, me] = await Promise.all([orgSettings(), projectId ? projectSettings(projectId) : Promise.resolve(new Map<string, string>()), getMe()]);
  let said: Partial<Omit<ScopeConfig, "effectiveDate"> & { effectiveDate: string }> = {};
  let own: { scopeStatement?: string; name?: string } = {};
  let measure: { integrityThreshold?: number; measurementIntervalDays?: number; by?: string; at?: string } = {};
  try { said = JSON.parse(org.get("SCOPE") ?? "{}"); } catch { said = {}; }
  try { own = JSON.parse(project.get("PROJECT_INFO") ?? "{}"); } catch { own = {}; }
  try { measure = JSON.parse(project.get(MEASURE_KEY) ?? "{}"); } catch { measure = {}; }
  const projectName = me?.projects.find((p) => p.id === projectId)?.name;
  return {
    organizationName: me?.tenant.name ?? said.organizationName ?? "",
    scopeStatement: own.scopeStatement || said.scopeStatement || `All controlled information produced or received for ${projectName ?? "the project"}, in any medium.`,
    standardVersion: said.standardVersion ?? STANDARD_VERSION,
    effectiveDate: new Date(said.effectiveDate ?? Date.now()),
    integrityThreshold: measure.integrityThreshold ?? said.integrityThreshold ?? 95,
    measurementIntervalDays: measure.measurementIntervalDays ?? said.measurementIntervalDays ?? 30,
    controlFunctionName: said.controlFunctionName ?? null,
    dmpDocumentId: said.dmpDocumentId ?? null,
    measuredBy: measure.by && measure.at ? { name: measure.by, at: measure.at } : null,
  };
}
