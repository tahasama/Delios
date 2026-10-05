import { REFERENCE, profileForKind, publishProfile } from "./profiles";
import type { PrismaClient } from "@prisma/client";

/**
 * Annex C — "the configuration gateway between the universal Rules and an
 * organization-specific implementation". §1.3: the Standard is not implemented
 * until these are published, so a new organization gets them at the moment it
 * is created. Everything here is a neutral starting point the organization is
 * expected to replace or extend in Admin; nothing in it is domain-specific.
 *
 * Used by the seed and by signup, so both produce an identical organization.
 */
export async function publishReferenceConfiguration(db: PrismaClient, orgId: string, projectKind?: string) {
  await publishFunctionCatalogue(db, orgId);

  // ── Annex D reference sets, then the project type's additions ──────────────
  // The lists live in src/lib/profiles/*.json: configuration as data.
  await publishProfile(db, orgId, REFERENCE, "define");
  const profile = profileForKind(projectKind);
  if (profile) await publishProfile(db, orgId, profile, "add");

  // ── Numbering schemes: neutral defaults, fully editable in Admin ────────────
  const schemeDefs = [
    { name: "Internal", notes: "Project · Document type · Discipline · Sequence(4). Edit freely.", fields: [["Project code", "PROJECT_CODES"], ["Document type", "DOCUMENT_TYPES"], ["Discipline", "DISCIPLINES"], ["Sequence", null, "COUNTER:DIGITS(4)"]] },
 { name: "Supplier", notes: "Project · Party · PO · Document type · Discipline · Sequence(4). For external producers.", fields: [["Project code", "PROJECT_CODES"], ["Supplier code", "SUPPLIER_CODES"], ["Purchase order", "PURCHASE_ORDERS"], ["Document type", "DOCUMENT_TYPES"], ["Discipline", "DISCIPLINES"], ["Sequence", null, "COUNTER:DIGITS(4)"]] },
    // Transmittals and actions are numbered by a scheme too, so the rule lives
    // where an organization can read and change it rather than in the code that
    // raises them. Their fields read the record: who sent it, who it went to,
    // and why. A field the record cannot answer is left out of the number.
    { name: "Transmittals", notes: "Project, TR, sender, receiver, reason, sequence(4). The fields read the record itself.", fields: [["Project code", null, "PROJECT"], ["Record", null, "FIXED(TR)"], ["Sender", null, "SENDER"], ["Receiver", null, "RECEIVER"], ["Reason for issue", null, "REASON"], ["Sequence", null, "COUNTER:DIGITS(4)"]] },
    { name: "Actions", notes: "Project, AC, owner party, kind, sequence(4). The fields read the record itself.", fields: [["Project code", null, "PROJECT"], ["Record", null, "FIXED(AC)"], ["Owner", null, "RECEIVER"], ["Kind", null, "REASON"], ["Sequence", null, "COUNTER:DIGITS(4)"]] },
    { name: "Reviews", notes: "Project, RV, sequence(4). A review is a step of a route on one revision; the document and the revision are on the record, so the number stays short.", fields: [["Project code", null, "PROJECT"], ["Record", null, "FIXED(RV)"], ["Sequence", null, "COUNTER:DIGITS(4)"]] },
  ];
  // Schemes are seeded once, never rewritten. A scheme defines how existing
  // document numbers decompose, so re-publishing the reference configuration
  // over an organization's edited scheme would invalidate every number issued
  // under it (§3.8). An organization that wants the defaults back deletes the
  // scheme in Admin and re-publishes.
  for (const def of schemeDefs) {
    const existing = await db.scheme.findUnique({ where: { orgId_name: { orgId, name: def.name } } });
    if (existing) continue;
    const scheme = await db.scheme.create({
      data: { orgId, name: def.name, notes: def.notes, delimiter: "-" },
    });
    for (let i = 0; i < def.fields.length; i++) {
      const [label, setKey, rule] = def.fields[i] as [string, string | null, string | null];
      await db.schemeField.create({ data: { schemeId: scheme.id, position: i + 1, label, valueSetKey: setKey, rule } });
    }
  }
  // Routing is seeded, never reset. Once an organization has pointed a
  // deliverable type at a scheme of its own, re-publishing the reference
  // configuration must not silently take it away — existing numbers were
  // issued under it and would stop validating (§3.8, §4.7).
  const defaultRouting = [
    { deliverableType: "CTR", schemeName: "Supplier" },
    { deliverableType: "VND", schemeName: "Supplier" },
    { deliverableType: "ENG", schemeName: "Internal" },
    { deliverableType: "TPY", schemeName: "Internal" },
    { deliverableType: "CLT", schemeName: "Internal" },
    { deliverableType: "TRANSMITTAL", schemeName: "Transmittals" },
    { deliverableType: "ACTION", schemeName: "Actions" },
    { deliverableType: "REVIEW", schemeName: "Reviews" },
  ];
  for (const route of defaultRouting) {
    const existing = await db.schemeRouting.findUnique({
      where: { orgId_deliverableType: { orgId, deliverableType: route.deliverableType } },
    });
    if (!existing) {
      await db.schemeRouting.create({ data: { orgId, ...route } });
    }
  }
}

/**
 * The starting function catalogue and its permission matrix (§1.4, §11.8).
 *
 * These six mirror the role vocabulary the system used before the matrix
 * existed, so an organization begins with something that behaves sensibly and
 * is immediately readable. They are ordinary rows: rename them, split
 * "Reviewer" into "Electrical Reviewer" and "Process Reviewer", narrow a rule
 * to one discipline — all of it is the organization's to do.
 */
export const DEFAULT_FUNCTIONS = [
  {
    code: "ADMIN", name: "Administrator", legacyRole: "ADMIN", clearance: 4, sort: 0,
    description: "Publishes configuration, people and the permission matrix.",
    verbs: ["READ", "CREATE", "REVISE", "REVIEW", "APPROVE", "TRANSMIT", "RECEIVE", "ACCEPT", "CONTROL", "CONFIGURE"],
  },
  {
    code: "CONTROLLER", name: "Document Control", legacyRole: "CONTROLLER", clearance: 4, sort: 1,
    description: "The designated control function: numbers, custody, releases, transmittals, obsolescence.",
    verbs: ["READ", "CREATE", "REVISE", "TRANSMIT", "RECEIVE", "ACCEPT", "CONTROL"],
  },
  {
    code: "APPROVER", name: "Approver", legacyRole: "APPROVER", clearance: 3, sort: 2,
    description: "Records approval decisions within their authority.",
    verbs: ["READ", "REVIEW", "APPROVE", "RECEIVE"],
  },
  {
    code: "REVIEWER", name: "Reviewer", legacyRole: "REVIEWER", clearance: 2, sort: 3,
    description: "Performs assigned reviews and records comments.",
    verbs: ["READ", "REVIEW", "RECEIVE"],
  },
  {
    code: "AUTHOR", name: "Author / Originator", legacyRole: "AUTHOR", clearance: 2, sort: 4,
    description: "Creates documents and revisions and submits them.",
    verbs: ["READ", "CREATE", "REVISE", "RECEIVE"],
  },
  {
    // Clearance 2, not 1: INTERNAL is the default classification for a
    // document, so a Viewer cleared only to PUBLIC would see an empty
    // register — technically correct and completely useless.
    code: "VIEWER", name: "Viewer", legacyRole: "VIEWER", clearance: 2, sort: 5,
    description: "Reads released, current information.",
    verbs: ["READ"],
  },
  {
    // Tags the departments each scheduled activity concerns (the departments
    // list), and reads what the project needs; approves no document.
    code: "PROJECT_MANAGER", name: "Project manager", legacyRole: "VIEWER", clearance: 3, sort: 5,
    description: "Owns the departments-per-activity list and follows readiness.",
    verbs: ["READ", "RECEIVE", "PLAN"],
  },
  {
    // For people from outside: a contractor's engineer, a client reviewer, a
    // certifying body. Starts at PUBLIC only, because the safe default for an
    // outsider is to see nothing until somebody decides what they should see —
    // raise the clearance, or narrow the rule by classification, deliberately.
    code: "GUEST", name: "External guest", legacyRole: "VIEWER", clearance: 1, sort: 6,
    description: "Someone from another organization, working on this project only.",
    verbs: ["READ", "RECEIVE"],
  },
  {
    // For an outside reviewer who has to comment but must never approve.
    code: "EXT_REVIEWER", name: "External reviewer", legacyRole: "REVIEWER", clearance: 2, sort: 7,
    description: "An outside party who reviews and comments, and approves nothing.",
    verbs: ["READ", "REVIEW", "RECEIVE"],
  },
] as const;

/**
 * Publish the catalogue for an organization. Like the schemes, functions are
 * seeded but never rewritten: an organization that has renamed a function or
 * narrowed its rules must not have that undone by a re-publish.
 */
export async function publishFunctionCatalogue(db: PrismaClient, orgId: string) {
  for (const def of DEFAULT_FUNCTIONS) {
    const existing = await db.function.findUnique({ where: { orgId_code: { orgId, code: def.code } } });
    if (existing) continue;
    const fn = await db.function.create({
      data: {
        orgId,
        code: def.code,
        name: def.name,
        description: def.description,
        clearance: def.clearance,
        legacyRole: def.legacyRole,
        sort: def.sort,
      },
    });
    await db.permissionRule.create({
      data: {
        orgId,
        functionId: fn.id,
        verbs: JSON.stringify(def.verbs),
        note: "Published on adoption of the permission matrix; refine per classification.",
      },
    });
  }
}

/** The function an organization uses for a given legacy role name. */
export async function functionForRole(db: PrismaClient, orgId: string, role: string) {
  const byCode = await db.function.findUnique({ where: { orgId_code: { orgId, code: role } } });
  if (byCode) return byCode;
  return db.function.findFirst({ where: { orgId, legacyRole: role, active: true }, orderBy: { sort: "asc" } });
}
