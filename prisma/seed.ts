/**
 * DELIOS EDMS seed — configuration-first.
 *
 * Default run: publishes ONLY the standard-generic configuration (Annex C/D
 * reference sets), the example workflow templates, parties and users. The
 * organization defines everything else in the app (or imports it).
 *
 *   SEED_DEMO=1 npm run db:seed   → additionally imports the private workbook
 *                                   lists (Q6637021 numbering) and the demo project.
 *
 * Idempotent — safe to re-run.
 */
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import bcrypt from "bcryptjs";
import { STANDARD_VERSION } from "../src/lib/standard";

const db = new PrismaClient();

// The tenancy this seed publishes into. Assigned at the top of main(); every
// helper below closes over them.
let orgId = "";
let projectId = "";

async function set(key: string, title: string, description: string, values: { code: string; label: string; sort?: number; props?: Record<string, unknown> }[]) {
  await db.configSet.upsert({ where: { orgId_key: { orgId, key } }, update: { title, description }, create: { orgId, key, title, description, version: 1 } });
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    await db.configValue.upsert({
      where: { orgId_setKey_code: { orgId, setKey: key, code: v.code } },
      update: { label: v.label, sort: v.sort ?? i, props: v.props ? JSON.stringify(v.props) : null },
      create: { orgId, setKey: key, code: v.code, label: v.label, sort: v.sort ?? i, props: v.props ? JSON.stringify(v.props) : null },
    });
  }
}

async function main() {
  const demo = process.env.SEED_DEMO === "1";
  console.log(demo ? "· Seeding STANDARD-GENERIC + DEMO configuration…" : "· Seeding standard-generic configuration only…");

  // ── Tenancy: one organization, one starter project ────────────────────────
  const organization = await db.organization.upsert({
    where: { slug: "our-org" },
    update: {},
    create: { slug: "our-org", name: "Our organization" },
  });
  orgId = organization.id;

  const project = await db.project.upsert({
    where: { orgId_code: { orgId, code: "P1" } },
    update: {},
    create: { orgId, code: "P1", name: "First project", kind: "GENERIC", startDate: new Date() },
  });
  projectId = project.id;

  // The scope statement is per project (§1.2 — the scope is what the statement
  // says it covers), so a second project states its own.
  await db.scopeConfig.upsert({
    where: { id: `scope-${projectId}` },
    update: {},
    create: {
      id: `scope-${projectId}`,
      projectId,
      organizationName: "Our organization",
      scopeStatement: "Whole organization — all controlled information produced or received, any medium (§1.2).",
      assessmentLevel: "Full",
      standardVersion: STANDARD_VERSION,
      effectiveDate: new Date(),
      integrityThreshold: 95,
      measurementIntervalDays: 30,
      controlFunctionName: "Document Control",
    },
  });

  // Annex C/D reference configuration — shared with signup so a seeded
  // organization and a self-registered one are identical (src/lib/bootstrap.ts).
  const { publishReferenceConfiguration } = await import("../src/lib/bootstrap");
  await publishReferenceConfiguration(db, orgId);

  // ── Parties & users ─────────────────────────────────────────────────────────
  const org = await db.party.upsert({ where: { orgId_code: { orgId, code: "OUR-ORG" } }, update: {}, create: { orgId, code: "OUR-ORG", name: "Our organization", isInternal: true } });
  const demoSupplier = await db.party.upsert({ where: { orgId_code: { orgId, code: "MAD" } }, update: { name: "MADASUD", isInternal: false }, create: { orgId, code: "MAD", name: "MADASUD", isInternal: false } });

  const hash = await bcrypt.hash("demo1234", 10);
  const users = [
    { email: "admin@delios.local", name: "Administrator", role: "ADMIN", partyId: org.id },
    { email: "controller@delios.local", name: "Document Control", role: "CONTROLLER", partyId: org.id },
    { email: "approver@delios.local", name: "Lead Engineer (approver)", role: "APPROVER", partyId: org.id },
    { email: "reviewer@delios.local", name: "Reviewer 1", role: "REVIEWER", partyId: org.id },
    { email: "reviewer2@delios.local", name: "Reviewer 2", role: "REVIEWER", partyId: org.id },
    { email: "author@delios.local", name: "Author — Electrical", role: "AUTHOR", partyId: org.id },
    { email: "author2@delios.local", name: "Author — Civil", role: "AUTHOR", partyId: org.id },
    { email: "viewer@delios.local", name: "Viewer", role: "VIEWER", partyId: org.id },
    { email: "vendor@delios.local", name: "Supplier representative", role: "AUTHOR", partyId: demoSupplier.id },
  ];
  for (const u of users) {
    await db.user.upsert({
      where: { orgId_email: { orgId, email: u.email } },
      update: { name: u.name, role: u.role, partyId: u.partyId },
      create: { orgId, email: u.email, name: u.name, role: u.role, partyId: u.partyId, organization: null, passwordHash: hash, active: true },
    });
  }
  const { functionForRole } = await import("../src/lib/bootstrap");
  for (const u of users) {
    const row = await db.user.findUniqueOrThrow({ where: { orgId_email: { orgId, email: u.email } } });
    const fn = await functionForRole(db, orgId, u.role);
    if (!fn) throw new Error(`No function published for role ${u.role}.`);
    await db.projectMembership.upsert({
      where: { projectId_userId: { projectId, userId: row.id } },
      update: { functionId: fn.id, active: true },
      create: { projectId, userId: row.id, functionId: fn.id },
    });
  }
  const admin = await db.user.findUniqueOrThrow({ where: { orgId_email: { orgId, email: "admin@delios.local" } } });

  // Approval authority matrix v1 — most specific match governs (§8.2)
  await db.authorityRow.deleteMany({ where: { orgId, version: 1 } });
  await db.authorityRow.createMany({
    data: [
      { orgId, version: 1, minRole: "REVIEWER" },
      { orgId, version: 1, criticality: "QUALITY", minRole: "APPROVER" },
      { orgId, version: 1, criticality: "SAFETY", minRole: "ADMIN" },
      { orgId, version: 1, criticality: "REGULATORY", minRole: "ADMIN" },
    ],
  });

  // ── Example workflow templates (deletable examples) ─────────────────────────
  const reviewer = await db.user.findUniqueOrThrow({ where: { orgId_email: { orgId, email: "reviewer@delios.local" } } });
  const reviewer2 = await db.user.findUniqueOrThrow({ where: { orgId_email: { orgId, email: "reviewer2@delios.local" } } });
  const approver = await db.user.findUniqueOrThrow({ where: { orgId_email: { orgId, email: "approver@delios.local" } } });
  const templates = [
    { name: "Single approval", description: "One approver, straight to release.", steps: [{ act: "APPROVAL", mode: "ANY_OF", participantIds: [approver.id] }] },
    { name: "Review then approval", description: "One reviewer records the outcome, then the approver decides.", steps: [{ act: "REVIEW", mode: "ANY_OF", participantIds: [reviewer.id] }, { act: "APPROVAL", mode: "ANY_OF", participantIds: [approver.id] }] },
    { name: "3-step serial review + approval", description: "Reviewers decide in order (the last outcome is binding, §9.7), then approval.", steps: [{ act: "REVIEW", mode: "SERIAL", participantIds: [reviewer.id, reviewer2.id, approver.id] }, { act: "APPROVAL", mode: "ANY_OF", participantIds: [approver.id] }] },
    { name: "Parallel review, any-of", description: "Several reviewers in parallel — the first decision closes it.", steps: [{ act: "REVIEW", mode: "ANY_OF", participantIds: [reviewer.id, reviewer2.id] }, { act: "APPROVAL", mode: "ANY_OF", participantIds: [approver.id] }] },
    { name: "Parallel review + consolidator", description: "Everyone reviews; the consolidator records the binding outcome (§9.7).", steps: [{ act: "REVIEW", mode: "ALL_CONSOLIDATOR", participantIds: [reviewer.id, reviewer2.id, approver.id] }] },
  ];
  for (const t of templates) {
    await db.workflowTemplate.upsert({
      where: { id: t.name },
      update: { steps: JSON.stringify(t.steps), description: t.description },
      create: { id: t.name, orgId, name: t.name, description: t.description, classes: "*", steps: JSON.stringify(t.steps), outcomeSetKey: "REVIEW_OUTCOMES", isDefault: t.name === "Review then approval", createdByName: "seed" },
    });
  }

  const assets = [
    { code: "P-101", name: "Feed pump P-101", area: "70", system: "Feed water", unit: "Unit 70" },
    { code: "P-102", name: "Backup feed pump P-102", area: "70", system: "Feed water", unit: "Unit 70" },
    { code: "TK-201", name: "Clarifier tank TK-201", area: "71", system: "Clarification", unit: "Unit 71" },
    { code: "BL-301", name: "Blower BL-301", area: "73", system: "Aeration", unit: "Unit 73" },
    { code: "WT-401", name: "Water tower WT-401", area: "75", system: "Distribution", unit: "Unit 75" },
  ];
  for (const asset of assets) {
    await db.assetItem.upsert({ where: { projectId_code: { projectId, code: asset.code } }, update: asset, create: { projectId, ...asset } });
  }

  const { seedGovernance } = await import("./seed-governance");
  await seedGovernance(db, orgId, projectId);

  console.log("· Neutral configuration published (Annex D reference sets, schemes, parties, example templates).");
  if (demo) {
    console.log("· SEED_DEMO=1 — importing the private workbook lists and demo project…");
    const { importWorkbook } = await import("./import-workbook");
    await importWorkbook(db, orgId, projectId);
    const { seedDemoProject } = await import("./seed-demo");
    await seedDemoProject(db, orgId, projectId);
    const { seedFunctionsDemo } = await import("./seed-functions-demo");
    await seedFunctionsDemo(db, orgId, projectId);
  }
  // A second organization, always seeded, so tenant isolation is testable.
  const { seedSecondOrganization } = await import("./seed-second-org");
  await seedSecondOrganization(db);

  console.log(`Seed complete. ${organization.name}: ${admin.email} · demo1234`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
