import type { Tenant } from "./tenant";
import { orgSettings } from "./api/settings";

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

export type FieldKind = "DOCUMENT" | "REVISION" | "TRANSMITTAL" | "REVIEW" | "ACTION" | "PACKAGE" | "PROJECT" | "PARTY" | "PERSON" | "ASSET";
export type FieldRule = "REQUIRED" | "OPTIONAL" | "OFF";

export const KIND_LABEL: Record<FieldKind, string> = {
  DOCUMENT: "Registering a document",
  REVISION: "Starting a revision",
  TRANSMITTAL: "Raising a transmittal",
  REVIEW: "Sending something for review",
  ACTION: "Saying an activity is ready",
  PACKAGE: "Putting a package together",
  PROJECT: "Opening a project",
  PARTY: "Adding an organization",
  PERSON: "Adding a person",
  ASSET: "Adding equipment",
};

/** The short word for a tab, where the long one is the heading. */
export const KIND_TAB: Record<FieldKind, string> = {
  DOCUMENT: "Document",
  REVISION: "Revision",
  TRANSMITTAL: "Transmittal",
  REVIEW: "Review",
  ACTION: "Readiness",
  PACKAGE: "Package",
  PROJECT: "Project",
  PARTY: "Organization",
  PERSON: "Person",
  ASSET: "Equipment",
};

/** What each form is for, under its heading. */
export const KIND_TEXT: Record<FieldKind, string> = {
  DOCUMENT: "What is asked when something enters the register.",
  REVISION: "What is asked when a new revision of a document is started.",
  TRANSMITTAL: "What is asked when documents are sent out or booked in.",
  REVIEW: "What is asked when a revision goes to its reviewers. The route decides the steps; a field of your own can ask the sender anything else.",
  ACTION: "What is asked of whoever confirms an activity has what it needs. The activity itself comes from the uploaded schedule, not from a form.",
  PACKAGE: "What is asked when documents are gathered to be handed over together.",
  PROJECT: "What is asked when a project is opened.",
  PARTY: "What is asked of an organization you exchange information with.",
  PERSON: "What is asked when somebody is given access to a project.",
  ASSET: "What is asked of the equipment documents describe.",
};

export const KINDS: FieldKind[] = [
  "DOCUMENT", "REVISION", "TRANSMITTAL", "REVIEW", "ACTION", "PACKAGE", "PROJECT", "PARTY", "PERSON", "ASSET",
];

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

export type FieldDef = {
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

export const FIELDS: FieldDef[] = [
  // ── Registering a document ──
  { control: "TEXT", kind: "DOCUMENT", key: "title", label: "Title", text: "What it is about, in the words somebody searching would use.", fallback: "REQUIRED", fixed: "A document nobody can find by name is not in a register." },
  { control: "CHOICE", setKey: "DOCUMENT_TYPES", computedBy: "The number is built from it, and it decides the review route.", kind: "DOCUMENT", key: "docType", label: "Document type", text: "Drawing, calculation, datasheet — from the published list.", fallback: "REQUIRED", fixed: "The type decides the number, the route and how long it is kept." },
  { control: "CHOICE", setKey: "DISCIPLINES", computedBy: "The number is built from it, and the distribution matrix answers by it.", kind: "DOCUMENT", key: "discipline", label: "Discipline", text: "Whose work it is.", fallback: "REQUIRED", fixed: "The distribution matrix answers by discipline; without it nobody can be found to review it." },
  { control: "CHOICE", setKey: "SUBPROJECTS", kind: "DOCUMENT", key: "subProject", label: "Sub-project", text: "Area, unit or phase this belongs to.", fallback: "OPTIONAL" },
  { control: "CHOICE", setKey: "SUPPLIER_CODES", kind: "DOCUMENT", key: "originator", label: "Supplier", text: "The outside organization that produced it.", fallback: "OPTIONAL" },
  { control: "CHOICE", setKey: "PURCHASE_ORDERS", kind: "DOCUMENT", key: "contractRef", label: "Contract or purchase order", text: "What it was produced under.", fallback: "OPTIONAL" },
  { control: "DATE", kind: "DOCUMENT", key: "receivedDate", label: "Date received", text: "The day it arrived from outside.", fallback: "OPTIONAL" },
  { control: "CHOICE", setKey: "CRITICALITY", computedBy: "Who may approve it is read from it, and the retention period follows it.", kind: "DOCUMENT", key: "criticality", label: "Criticality", text: "How serious an error in it would be. Decides who approves it and how long it is kept.", fallback: "REQUIRED" },
  { control: "CHOICE", setKey: "CONFIDENTIALITY", computedBy: "Who may read the document is decided by it.", kind: "DOCUMENT", key: "confidentiality", label: "Who may see it", text: "Open to the project, or closed to named people.", fallback: "OPTIONAL" },
  { control: "CHOICE", setKey: "RETENTION_CLASSES", computedBy: "How long it is kept, and whether it may be disposed of, are read from it.", kind: "DOCUMENT", key: "retentionClass", label: "Keep it for", text: "How long it is kept once the project closes. Follows criticality unless set.", fallback: "OPTIONAL" },
  { control: "CHOICE", setKey: "ASSET_ITEMS", kind: "DOCUMENT", key: "assetCode", label: "Equipment or asset", text: "The item it describes, where the plant is broken down.", fallback: "OPTIONAL" },
  { control: "DATE", kind: "DOCUMENT", key: "plannedDate", label: "Planned submission", text: "When it is promised.", fallback: "OPTIONAL" },
  { control: "FILE", kind: "DOCUMENT", key: "file", label: "The file", text: "Attached as it is registered, rather than later.", fallback: "OPTIONAL" },

  // ── Starting a revision ──
  { control: "TEXT", kind: "REVISION", key: "value", label: "Revision", text: "Its place in the published series.", fallback: "REQUIRED", fixed: "The series decides it; it is never typed." },
  { control: "TEXT", kind: "REVISION", key: "reasonForRevision", label: "Reason", text: "Why there is a new revision at all.", fallback: "REQUIRED", fixed: "A revision nobody asked for, with no reason recorded, is how a register loses its thread." },
  { control: "LONG_TEXT", kind: "REVISION", key: "changeDescription", label: "What changed, and why", text: "What is different from the last revision, and why it is made.", fallback: "REQUIRED" },
  { control: "CHOICE", setKey: "STATUSES", computedBy: "What may be built from it, and whether work may proceed, follow from the status.", kind: "REVISION", key: "statusCode", label: "Released as", text: "The status it carries once released. Asked at release, not when it is started.", fallback: "REQUIRED" },
  { control: "DATE", kind: "REVISION", key: "plannedSubmissionDate", label: "Due for submission", text: "When it is promised.", fallback: "OPTIONAL" },
  { control: "CHOICE", setKey: "PHASES", kind: "REVISION", key: "phase", label: "Phase", text: "The stage of the project it belongs to.", fallback: "OPTIONAL" },

  // ── Raising a transmittal ──
  { control: "PEOPLE", kind: "TRANSMITTAL", key: "recipients", label: "Recipients", text: "Who it goes to, by name.", fallback: "REQUIRED", fixed: "An issue nobody received is not an issue." },
  { control: "CHOICE", setKey: "REASONS_FOR_ISSUE", computedBy: "Whether a response is owed, and what status the documents must carry, follow from it.", kind: "TRANSMITTAL", key: "reason", label: "Reason for issue", text: "What they should do with it.", fallback: "REQUIRED", fixed: "The reason decides whether a response is owed and what the status must carry." },
  { control: "TEXT", kind: "TRANSMITTAL", key: "subject", label: "Subject", text: "What the recipient reads first.", fallback: "REQUIRED" },
  { control: "LONG_TEXT", kind: "TRANSMITTAL", key: "message", label: "Message", text: "Anything they should know about what is enclosed.", fallback: "OPTIONAL" },
  { control: "PEOPLE", kind: "TRANSMITTAL", key: "cc", label: "Copy to", text: "People who receive it for information.", fallback: "OPTIONAL" },
  { control: "FILE", kind: "TRANSMITTAL", key: "files", label: "Covering files", text: "Their letter or email, kept with the transmittal rather than registered.", fallback: "OPTIONAL" },
  { control: "DATE", kind: "TRANSMITTAL", key: "responseBy", label: "Response due", text: "The day an answer is expected, where the reason asks for one.", fallback: "OPTIONAL" },

  // ── Sending something for review ──
  { control: "CHOICE", computedBy: "The route is the steps themselves.", kind: "REVIEW", key: "route", label: "Route", text: "Which sequence of reviewers it goes through.", fallback: "REQUIRED", fixed: "A review with no route has no steps to answer." },
  { control: "PEOPLE", kind: "REVIEW", key: "steps", label: "Who answers each step", text: "The people the route puts on it, from those the matrix allows.", fallback: "REQUIRED", fixed: "A step with nobody on it is never answered." },
  { control: "PEOPLE", kind: "REVIEW", key: "copies", label: "Copied in", text: "Told it went out, never asked to answer.", fallback: "OPTIONAL", fixed: "Nothing waits on them, so nothing can be insisted on." },

  // ── Saying an activity is ready ──
  { control: "YES_NO", kind: "ACTION", key: "available", label: "Is it ready", text: "Whether the documents the activity needs are in hand.", fallback: "REQUIRED", fixed: "It is the answer itself." },
  { control: "TEXT", kind: "ACTION", key: "note", label: "Note", text: "What is short, and why it went ahead anyway. Read back on the activity and in the log.", fallback: "OPTIONAL" },

  // ── Putting a package together ──
  { control: "TEXT", kind: "PACKAGE", key: "title", label: "Title", text: "What the package is called.", fallback: "REQUIRED", fixed: "A package nobody can name cannot be handed to anybody." },
  { control: "LONG_TEXT", kind: "PACKAGE", key: "description", label: "Description", text: "What it is for, and anything the recipient should know.", fallback: "OPTIONAL" },
  { control: "DATE", kind: "PACKAGE", key: "completionDate", label: "Due", text: "When the package is wanted whole.", fallback: "REQUIRED" },
  { control: "CHOICE", setKey: "STATUSES", computedBy: "Whether a document counts as delivered is read from the status it carries.", kind: "PACKAGE", key: "requiredStatus", label: "Needed at status", text: "What a document must carry to count as in the package.", fallback: "REQUIRED" },
  { control: "PEOPLE", kind: "PACKAGE", key: "acceptanceAuthorityId", label: "Accepted by", text: "Who accepts it, which may not be whoever fills it.", fallback: "REQUIRED", fixed: "Filling a package and accepting it are two acts, and never one person's." },
  { control: "TEXT", kind: "PACKAGE", key: "po", label: "Contract or purchase order", text: "Where one package is kept per order.", fallback: "OPTIONAL" },

  // ── Opening a project ──
  { control: "TEXT", kind: "PROJECT", key: "code", label: "Code", text: "The short code every number on the project begins with.", fallback: "REQUIRED", fixed: "Numbers are built from it, so it cannot be left out or changed later." },
  { control: "TEXT", kind: "PROJECT", key: "name", label: "Name", text: "What people call it.", fallback: "REQUIRED", fixed: "A project nobody can name cannot be chosen from the switcher." },
  { control: "CHOICE", setKey: "PROJECT_KINDS", computedBy: "The contract kind decides the starting distribution matrix and who approves what.", kind: "PROJECT", key: "kind", label: "Type", text: "EPC, EPCM, PMC and the rest.", fallback: "REQUIRED" },
  { control: "CHOICE", setKey: "CONTRACT_ROLES", computedBy: "Our role decides which column of the matrix is ours.", kind: "PROJECT", key: "role", label: "Our role on it", text: "What this organization is on this project.", fallback: "REQUIRED" },
  { control: "DATE", kind: "PROJECT", key: "startDate", label: "Start date", text: "When work begins.", fallback: "OPTIONAL" },
  { control: "DATE", kind: "PROJECT", key: "endDate", label: "End date", text: "When it is due to close.", fallback: "OPTIONAL" },
  { control: "LONG_TEXT", kind: "PROJECT", key: "scopeStatement", label: "Scope", text: "What information this project controls. It is read back on the conformance statement.", fallback: "OPTIONAL" },

  // ── Adding an organization ──
  { control: "TEXT", kind: "PARTY", key: "code", label: "Code", text: "The short code that stands for them in a document number.", fallback: "REQUIRED", fixed: "Supplier numbers are built from it." },
  { control: "TEXT", kind: "PARTY", key: "name", label: "Name", text: "Their name as it appears on a transmittal.", fallback: "REQUIRED", fixed: "A transmittal has to say who it is addressed to." },
  { control: "CHOICE", setKey: "PARTY_KINDS", kind: "PARTY", key: "kind", label: "How they work with us", text: "Client, contractor, vendor, authority.", fallback: "OPTIONAL" },
  { control: "PEOPLE", kind: "PARTY", key: "contactId", label: "Who answers for it", text: "The person transmittals are addressed to when nothing else says.", fallback: "OPTIONAL" },
  { control: "PEOPLE", kind: "PARTY", key: "backupId", label: "Backup", text: "Who answers when the first is away.", fallback: "OPTIONAL" },
  { control: "CHOICE", kind: "PARTY", key: "liaisonFunction", label: "Who carries it", text: "The function on our side that deals with them.", fallback: "OPTIONAL" },

  // ── Adding a person ──
  { control: "TEXT", kind: "PERSON", key: "name", label: "Full name", text: "As it should appear against their decisions.", fallback: "REQUIRED", fixed: "Every approval and verdict carries the name of whoever gave it." },
  { control: "TEXT", kind: "PERSON", key: "email", label: "Email", text: "The address they sign in with, and where notifications go.", fallback: "REQUIRED", fixed: "It is how they sign in." },
  { control: "CHOICE", computedBy: "What they may do is read from the function they hold.", kind: "PERSON", key: "functionId", label: "Function", text: "The job they do on the project.", fallback: "REQUIRED" },
  { control: "CHOICE", computedBy: "An outside reader sees only what was issued to their organization.", kind: "PERSON", key: "partyId", label: "Works for", text: "The organization they belong to.", fallback: "REQUIRED" },
  { control: "CHOICE", setKey: "DEPARTMENTS", kind: "PERSON", key: "department", label: "Department", text: "Which department they answer for. Departments receive requirements calls and confirm readiness.", fallback: "OPTIONAL" },

  // ── Adding equipment ──
  { control: "TEXT", kind: "ASSET", key: "code", label: "Tag", text: "The tag number the plant knows it by.", fallback: "REQUIRED", fixed: "Documents are associated with equipment by tag." },
  { control: "TEXT", kind: "ASSET", key: "name", label: "Name", text: "What it is, in words.", fallback: "REQUIRED" },
  { control: "TEXT", kind: "ASSET", key: "system", label: "System", text: "The system it belongs to.", fallback: "OPTIONAL" },
  { control: "TEXT", kind: "ASSET", key: "area", label: "Area", text: "Where it sits.", fallback: "OPTIONAL" },
  { control: "TEXT", kind: "ASSET", key: "unit", label: "Unit", text: "The unit or train.", fallback: "OPTIONAL" },
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

/**
 * How this organization has answered, for one kind of thing.
 *
 * A fixed field answers itself whatever is stored, so a policy row left behind
 * by an earlier version cannot weaken something that is not negotiable.
 */
export async function fieldRules(_t: Tenant, kind: FieldKind): Promise<Rules> {
  const settings = await orgSettings();
  const said = new Map(fieldsOf(kind).map((field) => [field.key, settings.get(`${FIELD_RULE_KEY}${kind}:${field.key}`) as FieldRule | undefined]));
  const out: Rules = {};
  for (const field of fieldsOf(kind)) {
    out[field.key] = field.fixed ? field.fallback : said.get(field.key) ?? field.fallback;
  }
  return out;
}

/** The organization's own words for the application's fields. */
export async function fieldLabels(_t: Tenant, kind: FieldKind): Promise<Record<string, string>> {
  const settings = await orgSettings();
  const out: Record<string, string> = {};
  for (const field of fieldsOf(kind)) out[field.key] = settings.get(`${FIELD_LABEL_KEY}${kind}:${field.key}`) ?? field.label;
  return out;
}

/** A field this organization added, as a form needs it. */
export type OwnField = {
  id: string;
  key: string;
  label: string;
  control: Control;
  setKey: string | null;
  rule: FieldRule;
  help: string | null;
  inRegister: boolean;
  /** For a choice: the live values of the list it draws from. */
  options?: { code: string; label: string }[];
};

/** The fields an organization added for itself, in the order it put them. */
export async function ownFields(_t: Tenant, kind: FieldKind): Promise<OwnField[]> {
  const rows = (await storedOwnFields(kind)).filter((r) => r.rule !== "OFF");
  const { getActiveSet } = await import("./config");
  return Promise.all(rows.map(async (r) => ({
    ...r,
    options: r.setKey ? (await getActiveSet(r.setKey)).map((v) => ({ code: v.code, label: `${v.code} — ${v.label}` })) : undefined,
  })));
}

/** The organization setting that holds a field's rule: FIELD_RULE:DOCUMENT:plannedDate. */
export const FIELD_RULE_KEY = "FIELD_RULE:";
/** The organization setting that holds a field's own name: FIELD_LABEL:DOCUMENT:plannedDate. */
export const FIELD_LABEL_KEY = "FIELD_LABEL:";
/** The organization setting that holds the fields it added for one kind of record, in order: OWN_FIELDS:DOCUMENT. */
export const OWN_FIELDS_KEY = "OWN_FIELDS:";

/** The fields an organization added for one kind of record, as stored, every rule included. */
export async function storedOwnFields(kind: FieldKind): Promise<Omit<OwnField, "options">[]> {
  const raw = (await orgSettings()).get(`${OWN_FIELDS_KEY}${kind}`);
  if (!raw) return [];
  try {
    const rows = JSON.parse(raw) as Omit<OwnField, "options">[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
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
  return fieldsOf(kind)
    .filter((f) => !only || only.includes(f.key))
    .filter((f) => rules[f.key] === "REQUIRED")
    .filter((f) => {
      const v = values[f.key];
      return v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);
    })
    .map((f) => f.label.toLowerCase());
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
      error: `This organization asks for ${missing.join(", ")}. Fill ${missing.length === 1 ? "it" : "them"} in, or change what the form asks in Settings → Forms & fields.`,
      extras: answered.extras,
    };
  }
  return { extras: answered.extras };
}
