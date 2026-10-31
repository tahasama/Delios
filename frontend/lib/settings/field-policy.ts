import type { Tenant } from "@/lib/core/tenant";
import { cache } from "react";
import { api } from "@/lib/client";

/**
 * Which fields a form asks for, and which it insists on.
 *
 * Every form in the application used to be a fixed list written into the page:
 * an organization that never uses sub-projects still saw the box, and one that
 * wants a planned date on everything had no way to insist. This is the one
 * place that answers both questions, for every kind of thing that is filled in.
 *
 * What may not be answered here is as important as what may. A document with no
 * title, type or discipline is not a document, and a transmittal with no
 * recipient is not a transmittal; those stay as they are, and say why. The line
 * is the same one the rest of the application holds: you may configure what you
 * capture and what you call it, never away what makes a record controlled.
 */

export type FieldKind = "DOCUMENT" | "REVISION" | "TRANSMITTAL" | "REVIEW" | "PACKAGE" | "ASSET" | "PROJECT" | "PARTY";
export type FieldRule = "REQUIRED" | "OPTIONAL" | "OFF";

export const KIND_LABEL: Record<FieldKind, string> = {
  DOCUMENT: "Registering a document",
  REVISION: "Starting a revision",
  TRANSMITTAL: "Raising a transmittal",
  REVIEW: "Sending something for review",
  PACKAGE: "Putting a package together",
  PROJECT: "Opening a project",
  PARTY: "Adding an organization",
  ASSET: "Adding a tag",
};

/** The short word for a tab, where the long one is the heading. */
export const KIND_TAB: Record<FieldKind, string> = {
  DOCUMENT: "Document",
  REVISION: "Revision",
  TRANSMITTAL: "Transmittal",
  REVIEW: "Review",
  PACKAGE: "Package",
  PROJECT: "Project",
  PARTY: "Organization",
  ASSET: "Tag",
};

/** What each form is for, under its heading. */
export const KIND_TEXT: Record<FieldKind, string> = {
  DOCUMENT: "What is asked when something enters the register.",
  REVISION: "What is asked when a new revision of a document is started.",
  TRANSMITTAL: "What is asked when documents are sent out or booked in.",
  REVIEW: "What is asked when a revision goes to its reviewers. The route decides the steps; a field of your own can ask the sender anything else.",
  PACKAGE: "What is asked when documents are gathered to be handed over together.",
  PROJECT: "What is asked when a project is opened.",
  PARTY: "What is asked of an organization you exchange information with.",
  ASSET: "What is asked of a tag (equipment documents describe); its number is given by itself.",
};

export const KINDS: FieldKind[] = ["DOCUMENT", "REVISION", "TRANSMITTAL", "REVIEW", "PACKAGE", "ASSET", "PROJECT", "PARTY"];

/** The forms that are the organization's acts (opening a project, adding an organization): an administrator decides them. */
export const ORGANIZATION_KINDS: FieldKind[] = ["PROJECT", "PARTY"];

/** What the person filling it in is shown. */
export type Control = "TEXT" | "LONG_TEXT" | "NUMBER" | "DATE" | "YES_NO" | "CHOICE" | "FILE" | "PEOPLE";

export const CONTROL_LABEL: Record<Control, string> = {
  TEXT: "One line of text",
  LONG_TEXT: "A paragraph",
  NUMBER: "A number",
  DATE: "A date",
  YES_NO: "Yes or no",
  CHOICE: "Chosen from a published list",
  FILE: "A file",
  PEOPLE: "People on the project",
};

type FieldDef = {
  kind: FieldKind;
  /** The name the form and the server action know it by. */
  key: string;
  label: string;
  /** What it is for, in the words of the work. */
  text: string;
  /** How it stands until somebody says otherwise. */
  fallback: FieldRule;
  /** What it looks like on the form. */
  control: Control;
  /** For a choice: the published list it draws from, which is editable. */
  setKey?: string;
  /**
   * Why the control cannot be something else. A field the application computes
   * with — a number is built from it, an authority is read by it, a retention
   * period follows it — cannot become free text without breaking that.
   */
  computedBy?: string;
  /**
   * Set where the answer is not an organization's to give, with the reason.
   * These are shown, greyed, so nobody wonders whether they missed a switch.
   */
  fixed?: string;
};

const FIELDS: FieldDef[] = [
  // ── Registering a document ──
  { control: "CHOICE", setKey: "DELIVERABLE_TYPES", computedBy: "It picks the numbering, and what else the document needs.", kind: "DOCUMENT", key: "deliverableType", label: "Deliverable type", text: "Who produces it.", fallback: "REQUIRED", fixed: "It picks the numbering scheme." },
  { control: "TEXT", kind: "DOCUMENT", key: "title", label: "Title", text: "What it is about, in the words somebody searching would use.", fallback: "REQUIRED", fixed: "A document nobody can find by name is not in a register." },
  { control: "CHOICE", setKey: "DOCUMENT_TYPES", computedBy: "The number is built from it, and it decides the review route.", kind: "DOCUMENT", key: "docType", label: "Document type", text: "Drawing, calculation, datasheet: those of its deliverable type.", fallback: "REQUIRED", fixed: "The type decides the number, the route and how long it is kept." },
  { control: "CHOICE", setKey: "DISCIPLINES", computedBy: "The number is built from it, and the distribution matrix answers by it.", kind: "DOCUMENT", key: "discipline", label: "Discipline", text: "Whose work it is.", fallback: "REQUIRED", fixed: "The distribution matrix answers by discipline; without it nobody can be found to review it." },
  { control: "CHOICE", setKey: "SUPPLIER_CODES", kind: "DOCUMENT", key: "originator", label: "Supplier", text: "The outside organization it comes from.", fallback: "OPTIONAL", fixed: "Asked when its deliverable type comes from another organization (Types & sets, on the type)." },
  { control: "CHOICE", setKey: "SUBPROJECTS", kind: "DOCUMENT", key: "subProject", label: "Sub-project", text: "Area, unit or phase this belongs to.", fallback: "OPTIONAL" },
  { control: "CHOICE", setKey: "PHASES", kind: "DOCUMENT", key: "phase", label: "Phase", text: "The stage of the project it is in now. Its revisions are named by that phase (Settings, Revisions).", fallback: "OPTIONAL" },
  { control: "CHOICE", setKey: "PURCHASE_ORDERS", kind: "DOCUMENT", key: "contractRef", label: "Contract or purchase order", text: "What it was produced under.", fallback: "OPTIONAL" },
  { control: "CHOICE", setKey: "CRITICALITY", computedBy: "Who may approve it is read from it, and the retention period follows it.", kind: "DOCUMENT", key: "criticality", label: "Criticality", text: "How serious an error in it would be. Its type recommends one.", fallback: "REQUIRED" },
  { control: "CHOICE", setKey: "CONFIDENTIALITY", computedBy: "Who may read the document is decided by it.", kind: "DOCUMENT", key: "confidentiality", label: "Who may see it", text: "Open to the project, or closed. Starts at the usual level unless chosen.", fallback: "OPTIONAL" },
  { control: "CHOICE", setKey: "RETENTION_CLASSES", computedBy: "How long it is kept, and whether it may be disposed of, are read from it.", kind: "DOCUMENT", key: "retentionClass", label: "Retention period", text: "How long it is kept once the project closes. Follows criticality unless set.", fallback: "OPTIONAL" },
  { control: "DATE", kind: "DOCUMENT", key: "plannedDate", label: "Planned date", text: "When it is promised, for a document no action of the schedule needs (the schedule plans the others).", fallback: "OPTIONAL" },

  // ── Starting a revision ──
  { control: "LONG_TEXT", kind: "REVISION", key: "changeDescription", label: "What changed, and why", text: "The one text a new revision asks: what is different from the last one, and why.", fallback: "REQUIRED" },

  // ── Raising a transmittal ──
  { control: "PEOPLE", kind: "TRANSMITTAL", key: "recipients", label: "Recipients", text: "Who it goes to: people or organizations.", fallback: "REQUIRED", fixed: "A transmittal nobody received was never sent." },
  { control: "CHOICE", setKey: "REASONS_FOR_ISSUE", computedBy: "Data or information, and what it is issued for, follow from it.", kind: "TRANSMITTAL", key: "reason", label: "Kind and type", text: "Data or information, then what it is issued for.", fallback: "REQUIRED", fixed: "It says what the recipient does with it." },
  { control: "TEXT", kind: "TRANSMITTAL", key: "subject", label: "Subject", text: "What the recipient reads first. A letter always has one.", fallback: "REQUIRED" },
  { control: "LONG_TEXT", kind: "TRANSMITTAL", key: "message", label: "Message", text: "Anything they should know about what is enclosed. A letter always has one.", fallback: "OPTIONAL" },
  { control: "PEOPLE", kind: "TRANSMITTAL", key: "cc", label: "Copy to", text: "People who receive it for information.", fallback: "OPTIONAL" },

  // ── Sending something for review ──
  { control: "CHOICE", computedBy: "The route is the steps themselves.", kind: "REVIEW", key: "route", label: "Route", text: "Which sequence of reviewers it goes through.", fallback: "REQUIRED", fixed: "A review with no route has no steps to answer." },
  { control: "PEOPLE", kind: "REVIEW", key: "steps", label: "Who answers each step", text: "The people the route puts on it, from those the matrix allows.", fallback: "REQUIRED", fixed: "A step with nobody on it is never answered." },
  { control: "PEOPLE", kind: "REVIEW", key: "copies", label: "Copied in", text: "Told it went out and of what comes of it, never asked to answer.", fallback: "OPTIONAL" },

  // ── Putting a package together ──
  { control: "TEXT", kind: "PACKAGE", key: "title", label: "Title", text: "What the package is called.", fallback: "REQUIRED", fixed: "A package nobody can name cannot be handed to anybody." },
  { control: "LONG_TEXT", kind: "PACKAGE", key: "description", label: "Description", text: "What it is for, and anything the recipient should know.", fallback: "OPTIONAL" },
  { control: "DATE", kind: "PACKAGE", key: "completionDate", label: "Due", text: "When a delivery package is wanted whole. A supplier's package has none: each document is due on its planned date.", fallback: "OPTIONAL" },
  { control: "TEXT", kind: "PACKAGE", key: "po", label: "Contract or purchase order", text: "Where one package is kept per order.", fallback: "OPTIONAL" },

  // ── Adding a tag ──
  { control: "TEXT", kind: "ASSET", key: "name", label: "Name", text: "What it is, in words.", fallback: "REQUIRED", fixed: "A tag nobody can name describes nothing." },
  { control: "TEXT", kind: "ASSET", key: "system", label: "System", text: "The system it belongs to.", fallback: "OPTIONAL" },
  { control: "TEXT", kind: "ASSET", key: "area", label: "Area", text: "Where it sits.", fallback: "OPTIONAL" },
  { control: "TEXT", kind: "ASSET", key: "unit", label: "Unit", text: "The unit or train.", fallback: "OPTIONAL" },

  // ── Opening a project (the organization's) ──
  { control: "TEXT", kind: "PROJECT", key: "code", label: "Code", text: "The short code every number on the project begins with.", fallback: "REQUIRED", fixed: "Numbers are built from it." },
  { control: "TEXT", kind: "PROJECT", key: "name", label: "Name", text: "What people call it.", fallback: "REQUIRED", fixed: "A project nobody can name cannot be chosen from the switcher." },
  { control: "CHOICE", setKey: "PROJECT_KINDS", kind: "PROJECT", key: "kind", label: "Type", text: "What kind of project it is, from Project types.", fallback: "REQUIRED", fixed: "It describes the project." },
  { control: "CHOICE", setKey: "CONTRACT_ROLES", computedBy: "Our role decides where approval sits.", kind: "PROJECT", key: "role", label: "Our role on it", text: "What this organization is on this project.", fallback: "REQUIRED", fixed: "Where approval sits follows it." },
  { control: "DATE", kind: "PROJECT", key: "startDate", label: "Start date", text: "When work begins.", fallback: "OPTIONAL" },
  { control: "DATE", kind: "PROJECT", key: "endDate", label: "End date", text: "When it is due to close.", fallback: "OPTIONAL" },
  { control: "LONG_TEXT", kind: "PROJECT", key: "scopeStatement", label: "Scope", text: "What information this project controls. It is read back on the conformance statement.", fallback: "OPTIONAL" },

  // ── Adding an organization (the organization's) ──
  { control: "TEXT", kind: "PARTY", key: "code", label: "Code", text: "The short code that stands for them in a document number.", fallback: "REQUIRED", fixed: "Supplier numbers are built from it." },
  { control: "TEXT", kind: "PARTY", key: "name", label: "Name", text: "Their name as it appears on a transmittal.", fallback: "REQUIRED", fixed: "A transmittal has to say who it is addressed to." },
  { control: "CHOICE", kind: "PARTY", key: "kind", label: "How they work with us", text: "From its own DELIOS, with accounts we give, or one of ours works for it.", fallback: "REQUIRED", fixed: "It decides how they take part." },
  { control: "PEOPLE", kind: "PARTY", key: "contactId", label: "Who answers for it here", text: "One of their people we ask first on this project.", fallback: "OPTIONAL" },
  { control: "PEOPLE", kind: "PARTY", key: "backupId", label: "Backup", text: "Who answers when the first is away.", fallback: "OPTIONAL" },
  { control: "PEOPLE", kind: "PARTY", key: "liaisonFunction", label: "Who of ours works for it", text: "For an organization not on DELIOS: the person of ours who sends to them and records their answers.", fallback: "OPTIONAL" },
];

export const RULE_LABEL: Record<FieldRule, string> = {
  REQUIRED: "Must be filled",
  OPTIONAL: "Asked, may be left",
  OFF: "Not asked at all",
};

export function fieldsOf(kind: FieldKind): FieldDef[] {
  return FIELDS.filter((f) => f.kind === kind);
}

export type Rules = Record<string, FieldRule>;

/** One form as the backend works it out (`FormRules`): the project's own copy, else the organization's. */
type FormView = {
  form: FieldKind; rules: Record<string, FieldRule>; labels: Record<string, string>;
  own: Omit<OwnField, "options">[];
  /** The fields of one's own a record of this form carries an answer to: retired, never taken away. */
  used?: string[];
};
/**
 * Every form at one level: a project's (the forms it keeps its own copy of, whether the organization leaves forms free,
 * whether this person may change them) or the organization's (its Settings).
 */
export type FormsAnswer = { level: "project" | "organization"; forms: FormView[]; owned: string[]; free: boolean; mayChange: boolean;
  /** Free here only by an exception (who, when, why). */
  exception?: { reason: string; by: string; at: string } | null };

/** The project's forms, read once a request (`GET /api/projects/{id}/forms`). */
export const projectForms = cache(async (projectId: string): Promise<FormsAnswer | null> =>
  api<FormsAnswer>(`/api/projects/${projectId}/forms`, { keep: { areas: [] } }).catch(() => null));

/** The organization's forms, every one of them, as its Settings show them (`GET /api/admin/forms`, an administrator). */
export const organizationForms = cache(async (): Promise<FormsAnswer | null> =>
  api<FormsAnswer>("/api/admin/forms", { keep: { areas: [] } }).catch(() => null));

/** One form: the project's when a project is open, else (opening a project, adding an organization) the organization's. */
async function formView(t: Tenant, kind: FieldKind): Promise<FormView | null> {
  if (t.projectId && !ORGANIZATION_KINDS.includes(kind)) return (await projectForms(t.projectId))?.forms.find((f) => f.form === kind) ?? null;
  return api<FormView>(`/api/forms/${kind}`, { keep: { areas: [] } }).catch(() => null);
}

/** How the project (or the organization) answered, for one form. A field always asked stands as it is. */
export async function fieldRules(t: Tenant, kind: FieldKind): Promise<Rules> {
  const view = await formView(t, kind);
  const out: Rules = {};
  for (const field of fieldsOf(kind)) out[field.key] = field.fixed ? field.fallback : view?.rules[field.key] ?? field.fallback;
  return out;
}

/** The project's own words for the application's fields. */
export async function fieldLabels(t: Tenant, kind: FieldKind): Promise<Record<string, string>> {
  const view = await formView(t, kind);
  const out: Record<string, string> = {};
  for (const field of fieldsOf(kind)) out[field.key] = view?.labels[field.key] ?? field.label;
  return out;
}

/** A field added to a form, as a form needs it. Chosen from a list, it offers the values of the set serving the document. */
export type OwnField = {
  id: string;
  key: string;
  label: string;
  control: Control;
  setKey: string | null;
  rule: FieldRule;
  help: string | null;
  inRegister: boolean;
  /** Answered at least once, then taken off the form: no longer asked, its answers read back where they are. */
  retired?: boolean;
  /** For a choice: the live values of the list it draws from (with their set, so a form offers the serving one's). */
  options?: { code: string; label: string; setId?: string | null }[];
};

/**
 * The fields added to a form, in the order they were put, and, on the document form, every list of one's own (Types &
 * sets, Numbering & identity or Classification & keeping) by itself; those left out are not asked.
 */
export async function ownFields(t: Tenant, kind: FieldKind): Promise<OwnField[]> {
  const view = await formView(t, kind);
  const { getActiveSet } = await import("@/lib/settings/config");
  const own = (view?.own ?? []).filter((r) => r.rule !== "OFF" && !r.retired);
  return Promise.all(own.map(async (r) => ({
    ...r,
    options: r.setKey ? (await getActiveSet(r.setKey)).map((v) => ({ code: v.code, label: `${v.code} — ${v.label}`, setId: v.setId ?? null })) : undefined,
  })));
}

/** The fields added to a form, as kept, every rule included; and the lists of one's own with their rules. */
export async function storedOwnFields(t: Tenant, kind: FieldKind): Promise<{ own: Omit<OwnField, "options">[]; used: string[] }> {
  const view = await formView(t, kind);
  return { own: view?.own ?? [], used: view?.used ?? [] };
}

/** The answers a record carries to its organization's own fields. */
export function readExtras(stored: string | null | undefined): Record<string, string> {
  if (!stored) return {};
  try {
    const held = JSON.parse(stored) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(held).map(([k, v]) => [k, String(v ?? "")]));
  } catch {
    return {};
  }
}

/**
 * What the form sent for the organization's own fields, and what is missing.
 * A field switched off is not read at all, so turning one off never refuses a
 * form that no longer shows it.
 */
export function takeExtras(fields: OwnField[], get: (name: string) => string): { extras: Record<string, string>; missing: string[] } {
  const extras: Record<string, string> = {};
  const missing: string[] = [];
  for (const field of fields) {
    const value = (get(`own:${field.key}`) ?? "").trim();
    if (value) extras[field.key] = value;
    else if (field.rule === "REQUIRED") missing.push(field.label.toLowerCase());
  }
  return { extras, missing };
}

/** A key made from a label: stable, lower case, and never clashing with another. */
export function keyFromLabel(label: string, taken: string[]): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "field";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Every kind at once, for a screen that shows them together. */
export async function allFieldRules(t: Tenant): Promise<Record<FieldKind, Rules>> {
  const entries = await Promise.all(KINDS.map(async (kind) => [kind, await fieldRules(t, kind)] as const));
  return Object.fromEntries(entries) as Record<FieldKind, Rules>;
}

/**
 * What is missing, given what was filled in.
 *
 * The caller passes what it has; anything the organization insists on and the
 * form did not carry comes back by its own label, ready to be said out loud.
 */
export function missingRequired(rules: Rules, kind: FieldKind, values: Record<string, unknown>, only?: string[]): string[] {
  return missingRequiredFields(rules, kind, values, only).map((f) => f.label.toLowerCase());
}

/** The same, as the fields themselves (their keys name the form's fields, to outline them). */
export function missingRequiredFields(rules: Rules, kind: FieldKind, values: Record<string, unknown>, only?: string[]) {
  return fieldsOf(kind)
    .filter((f) => !only || only.includes(f.key))
    .filter((f) => rules[f.key] === "REQUIRED")
    .filter((f) => {
      const v = values[f.key];
      return v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);
    });
}

/**
 * Everything a form needs to draw itself, in one call: what is asked, what it
 * is called here, and the fields this organization added.
 */
export async function formPolicy(t: Tenant, kind: FieldKind): Promise<{ rules: Rules; labels: Record<string, string>; own: OwnField[] }> {
  const [rules, labels, own] = await Promise.all([fieldRules(t, kind), fieldLabels(t, kind), ownFields(t, kind)]);
  return { rules, labels, own };
}

/**
 * What a server action has to refuse, for one form: the application's fields
 * this organization insists on, and its own fields it insists on. The answers
 * to keep come back with them, ready to be stored beside the record.
 */
export function checkForm(
  kind: FieldKind,
  policy: { rules: Rules; own: OwnField[] },
  values: Record<string, unknown>,
  get: (name: string) => string,
  /**
   * The fields this particular act asks for, where one kind is filled in by
   * more than one act — a revision is started with its reason, and released at
   * a status later. Left out, every field of the kind is checked.
   */
  only?: string[],
): { error?: string; extras: Record<string, string> } {
  const short = missingRequired(policy.rules, kind, values, only);
  const answered = takeExtras(policy.own, get);
  const missing = [...short, ...answered.missing];
  if (missing.length) {
    return {
      error: `Fill in ${missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`}.`,
      extras: answered.extras,
    };
  }
  return { extras: answered.extras };
}
