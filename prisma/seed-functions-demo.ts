import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * A worked example of the permission matrix, so the thing can be judged rather
 * than imagined.
 *
 * Three functions that a real project would actually have, each narrower than
 * the generic six:
 *   Lead Electrical Engineer — approves electrical work, cleared to RESTRICTED
 *   Electrical Technician    — reads and receives electrical drawings only
 *   Commissioning Engineer   — reads and receives across disciplines, no approval
 *
 * Plus one RESTRICTED document, which the technician cannot see at all and the
 * lead can — the difference being clearance, not role name.
 */
export async function seedFunctionsDemo(db: PrismaClient, orgId: string, projectId: string) {
  const marker = await db.function.findUnique({ where: { orgId_code: { orgId, code: "ELEC_TECH" } } });
  if (marker) {
    console.log("· Function demo already seeded — skipping.");
    return;
  }

  const defs = [
    {
      code: "LEAD_ELEC_ENG", name: "Lead Electrical Engineer", legacyRole: "APPROVER", clearance: 3, sort: 10,
      description: "Owns electrical content and approves it. Cleared to Restricted.",
      rules: [
        { discipline: "EL", verbs: ["READ", "CREATE", "REVISE", "REVIEW", "APPROVE", "RECEIVE"], note: "Electrical content, end to end." },
        { verbs: ["READ"], note: "Awareness of everything else." },
      ],
    },
    {
      code: "ELEC_TECH", name: "Electrical Technician", legacyRole: "VIEWER", clearance: 2, sort: 11,
      description: "Works from electrical drawings on site. Reads and receives them; approves nothing.",
      rules: [
        { discipline: "EL", docType: "DWG", verbs: ["READ", "RECEIVE"], note: "Electrical drawings only — what they build from." },
      ],
    },
    {
      code: "COMM_ENG", name: "Commissioning Engineer", legacyRole: "REVIEWER", clearance: 2, sort: 12,
      description: "Reviews across disciplines at commissioning; receives everything issued for execution.",
      rules: [
        { verbs: ["READ", "REVIEW", "RECEIVE"], note: "All disciplines, review only." },
      ],
    },
  ] as const;

  const created: Record<string, string> = {};
  for (const def of defs) {
    const fn = await db.function.create({
      data: {
        orgId, code: def.code, name: def.name, description: def.description,
        clearance: def.clearance, legacyRole: def.legacyRole, sort: def.sort,
      },
    });
    created[def.code] = fn.id;
    for (const [i, rule] of def.rules.entries()) {
      await db.permissionRule.create({
        data: {
          orgId,
          functionId: fn.id,
          discipline: "discipline" in rule ? rule.discipline : null,
          docType: "docType" in rule ? rule.docType : null,
          verbs: JSON.stringify(rule.verbs),
          note: rule.note,
          sort: i,
        },
      });
    }
  }

  // People to hold them, so the difference can be seen by signing in.
  const party = await db.party.findFirst({ where: { orgId, isInternal: true } });
  const hash = await bcrypt.hash("demo1234", 10);
  const people = [
    { email: "lead.elec@delios.local", name: "Lead Electrical Engineer", code: "LEAD_ELEC_ENG" },
    { email: "tech.elec@delios.local", name: "Electrical Technician", code: "ELEC_TECH" },
    { email: "commissioning@delios.local", name: "Commissioning Engineer", code: "COMM_ENG" },
  ];
  for (const person of people) {
    const fnId = created[person.code];
    const fn = await db.function.findUniqueOrThrow({ where: { id: fnId } });
    const user = await db.user.upsert({
      where: { orgId_email: { orgId, email: person.email } },
      update: { name: person.name },
      create: {
        orgId, email: person.email, name: person.name, role: fn.legacyRole,
        partyId: party?.id ?? null, passwordHash: hash, active: true,
      },
    });
    await db.projectMembership.upsert({
      where: { projectId_userId: { projectId, userId: user.id } },
      update: { functionId: fnId, active: true },
      create: { projectId, userId: user.id, functionId: fnId },
    });
  }

  // One classified item, so clearance is demonstrable and not just declared.
  const restricted = await db.document.findFirst({ where: { projectId, confidentiality: "RESTRICTED" } });
  if (!restricted) {
    const anyElectrical = await db.document.findFirst({
      where: { projectId, discipline: "EL" },
      select: { deliverableType: true, docType: true },
    });
    await db.document.create({
      data: {
        projectId,
        docNumber: "P1001-10-EL-RPT-09001",
        title: "Switchroom access control and key management — restricted",
        deliverableType: anyElectrical?.deliverableType ?? "ENG",
        docType: "RPT",
        discipline: "EL",
        criticality: "SAFETY",
        confidentiality: "RESTRICTED",
        state: "ACTIVE",
        createdById: "seed",
        createdByName: "seed",
      },
    });
  }

  console.log("· Function demo: Lead Electrical Engineer, Electrical Technician, Commissioning Engineer (all demo1234) + one RESTRICTED document.");
}
