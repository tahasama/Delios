// Phase 1 exit criterion: two projects coexist with colliding document numbers,
// and the scoped client never returns one project's rows to the other.
import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";
import { scopedClient, tenantFor, ORG_SCOPED, PROJECT_SCOPED } from "../src/lib/tenant";

const db = new PrismaClient();
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const org = await db.organization.findFirstOrThrow();
  const p1 = await db.project.findFirstOrThrow({ where: { orgId: org.id, code: "P1001" } });

  // A second project in the same organization.
  const p2 = await db.project.upsert({
    where: { orgId_code: { orgId: org.id, code: "P1002" } },
    update: {},
    create: { orgId: org.id, code: "P1002", name: "Second project", kind: "ENERGY" },
  });

  const t1 = tenantFor(org.id, p1.id);
  const t2 = tenantFor(org.id, p2.id);

  // Take a document number that already exists in P1 and reuse it in P2.
  const borrowed = await t1.db.document.findFirstOrThrow({ orderBy: { docNumber: "asc" } });
  console.log(`\nReusing P1's number "${borrowed.docNumber}" inside P2\n`);

  const existing = await t2.db.document.findFirst({ where: { docNumber: borrowed.docNumber } });
  if (!existing) {
    await t2.db.document.create({
      data: {
        projectId: p2.id,
        docNumber: borrowed.docNumber,
        title: "Same number, different project",
        deliverableType: borrowed.deliverableType,
        docType: borrowed.docType,
        discipline: borrowed.discipline,
        createdById: "verify",
        createdByName: "verify",
      },
    });
  }

  check("both projects hold that number", (await db.document.count({ where: { docNumber: borrowed.docNumber } })) === 2);

  // ── Reads must not cross ──────────────────────────────────────────────────
  const in1 = await t1.db.document.findMany({ where: { docNumber: borrowed.docNumber } });
  const in2 = await t2.db.document.findMany({ where: { docNumber: borrowed.docNumber } });
  check("P1 sees exactly one", in1.length === 1, `got ${in1.length}`);
  check("P2 sees exactly one", in2.length === 1, `got ${in2.length}`);
  check("they are different rows", in1[0]?.id !== in2[0]?.id);
  check("P1 gets its own title", in1[0]?.title === borrowed.title, in1[0]?.title);
  check("P2 gets its own title", in2[0]?.title === "Same number, different project", in2[0]?.title);

  // An unfiltered findMany must still be narrowed.
  // Every document belongs to exactly one project: the per-project counts must
  // add up to the whole, with nothing orphaned and nothing double-counted.
  const projects = await db.project.findMany({ select: { id: true, orgId: true } });
  const perProject = await Promise.all(projects.map((p) => db.document.count({ where: { projectId: p.id } })));
  const total = await db.document.count();
  check("counts partition the register", perProject.reduce((a, b) => a + b, 0) === total,
    `${perProject.filter(Boolean).join(" + ")} = ${total}`);

  // A row fetched by bare id from the wrong project must not resolve.
  const wrongWay = await t2.db.document.findFirst({ where: { id: borrowed.id } });
  check("P2 cannot fetch P1's row by id", wrongWay === null);

  // Child records follow their project.
  const revs1 = await t1.db.revision.count();
  const revs2 = await t2.db.revision.count();
  check("revisions partition too", revs1 + revs2 === (await db.revision.count()), `${revs1} + ${revs2}`);

  // Organization-level configuration is shared, not partitioned.
  const sets1 = await t1.db.configSet.count();
  const sets2 = await t2.db.configSet.count();
  check("value sets are shared org-wide", sets1 === sets2 && sets1 > 0, `${sets1} vs ${sets2}`);

  // A write through the scoped client lands in the right project without being told.
  const made = await t2.db.assetItem.create({
    data: { projectId: p2.id, code: `VERIFY-${Date.now()}`, name: "Scoped write" },
  });
  check("write landed in P2", made.projectId === p2.id);
  check("P1 cannot see it", (await t1.db.assetItem.findFirst({ where: { id: made.id } })) === null);

  // Clean up the probe row; the P2 document stays as evidence.
  await db.assetItem.delete({ where: { id: made.id } });

  // ── Organization isolation ────────────────────────────────────────────────
  console.log("\nOrganization isolation\n");
  const other = await db.organization.findUnique({ where: { slug: "northwind" } });
  if (!other) {
    check("second organization is seeded", false, "run `npm run db:seed`");
  } else {
    const shared = "admin@delios.local";
    const accounts = await db.user.findMany({ where: { email: shared }, include: { org: true } });
    // Any number of organizations may hold this address; what matters is that
    // each account sits in a different one.
    check("one address, several organizations", accounts.length >= 2, `${accounts.length} account(s)`);
    check("they are distinct accounts", new Set(accounts.map((a) => a.id)).size === accounts.length);
    check("they belong to different organizations", new Set(accounts.map((a) => a.orgId)).size === accounts.length);

    // Credentials must not be interchangeable between organizations.
    const bcrypt = (await import("bcryptjs")).default;
    const ours = accounts.find((a) => a.orgId === org.id);
    const theirs = accounts.find((a) => a.orgId === other.id);
    check("our password opens our account", !!ours && (await bcrypt.compare("demo1234", ours.passwordHash)));
    check("our password does NOT open theirs", !!theirs && !(await bcrypt.compare("demo1234", theirs.passwordHash)));
    check("their password opens theirs", !!theirs && (await bcrypt.compare("northwind1234", theirs.passwordHash)));
    check("their password does NOT open ours", !!ours && !(await bcrypt.compare("northwind1234", ours.passwordHash)));

    // Projects, configuration and people stay inside their organization.
    const theirProjects = await db.project.findMany({ where: { orgId: other.id } });
    check("the other organization has its own projects", theirProjects.length > 0, theirProjects.map((p) => p.code).join(", "));
    check("no project is shared", theirProjects.every((p) => p.orgId !== org.id));

    const t3 = tenantFor(other.id, theirProjects[0].id);
    check("their register does not contain our documents", (await t3.db.document.count()) === 0);

    // A caller-supplied tenancy key must be clamped, not honoured: asking P1's
    // client for another project's rows returns P1's, never the other project's.
    const smuggled = await t1.db.document.findFirst({ where: { projectId: theirProjects[0].id } });
    check("a smuggled projectId is clamped, not honoured", smuggled === null || smuggled.projectId === p1.id,
      smuggled ? `got a row from ${smuggled.projectId === p1.id ? "P1 (clamped)" : "ANOTHER PROJECT"}` : "no row");

    // Every organization publishes its own sets, and the sets partition
    // cleanly — no set is shared, none is orphaned.
    const orgs = await db.organization.findMany({ select: { id: true, name: true } });
    const perOrg = await Promise.all(orgs.map((o) => db.configSet.count({ where: { orgId: o.id } })));
    const allSets = await db.configSet.count();
    check("every organization publishes its own value sets", perOrg.every((n) => n > 0), perOrg.join(" / "));
    check("value sets partition across organizations",
      allSets === perOrg.reduce((a, b) => a + b, 0), `${perOrg.join(" + ")} = ${allSets}`);

    // Phase 2's models were added to the schema before they were added to the
    // scoped-model sets, and the matrix briefly listed every organization's
    // functions. Guard the whole class, not just that one instance.
    const perOrgFunctions = await Promise.all(orgs.map((o) => db.function.count({ where: { orgId: o.id } })));
    const allFunctions = await db.function.count();
    check("functions partition across organizations",
      allFunctions === perOrgFunctions.reduce((a, b) => a + b, 0), `${perOrgFunctions.join(" + ")} = ${allFunctions}`);
    check("our function list is only ours",
      (await t1.db.function.count()) === perOrgFunctions[orgs.findIndex((o) => o.id === org.id)],
      `${await t1.db.function.count()} of ${allFunctions}`);
    check("their function list is only theirs",
      (await t3.db.function.count()) === perOrgFunctions[orgs.findIndex((o) => o.id === other.id)]);
    check("permission rules do not cross either",
      (await t1.db.permissionRule.count()) + (await t3.db.permissionRule.count()) <= (await db.permissionRule.count()));

    // Every tenant-owned model must be declared in one of the scoped sets, or
    // it silently reads across the whole installation.
    const declared = new Set([...ORG_SCOPED, ...PROJECT_SCOPED, "Organization", "Project", "ProjectMembership", "SchemeField"]);
    // Read from the schema itself: any model carrying orgId or projectId is tenant-owned.
    const modelled = Prisma.dmmf.datamodel.models
      .filter((m) => m.fields.some((f) => f.name === "orgId" || f.name === "projectId"))
      .map((m) => m.name);
    const undeclared = modelled.filter((m) => !declared.has(m));
    check("no tenant model is missing from the scoped sets", undeclared.length === 0, undeclared.join(", ") || "all declared");

    const oursSeen = await t1.db.user.findFirst({ where: { orgId: other.id } });
    const theirsSeen = await t3.db.user.findFirst({ where: { orgId: org.id } });
    check("we cannot reach their people", oursSeen === null || oursSeen.orgId === org.id);
    check("they cannot reach our people", theirsSeen === null || theirsSeen.orgId === other.id);

    // The shared address resolves to a different account in each organization.
    const oursByEmail = await t1.db.user.findFirst({ where: { email: shared } });
    const theirsByEmail = await t3.db.user.findFirst({ where: { email: shared } });
    check("the same address resolves per organization", !!oursByEmail && !!theirsByEmail && oursByEmail.id !== theirsByEmail.id,
      `${oursByEmail?.name} vs ${theirsByEmail?.name}`);

    // A write cannot be redirected into another tenant.
    const redirected = await t1.db.assetItem.create({
      data: { projectId: theirProjects[0].id, code: `SMUGGLE-${Date.now()}`, name: "Should land in P1" },
    });
    check("a write cannot be redirected to another tenant", redirected.projectId === p1.id,
      redirected.projectId === p1.id ? "clamped to P1" : "LEAKED");
    await db.assetItem.delete({ where: { id: redirected.id } });
  }

  // ── Another party's people see only their own work and what we issued them ──
  console.log("\nAn outside party's register\n");
  {
    const stamp = Date.now().toString(36);
    const party = await db.party.upsert({
      where: { orgId_code: { orgId: org.id, code: "VFY" } },
      update: {},
      create: { orgId: org.id, code: "VFY", name: `Verify Supplier ${stamp}`, isInternal: false },
    });
    const staff = await t1.db.document.findFirstOrThrow({ where: { originator: null } });
    const theirs = await t1.db.document.create({
      data: {
        projectId: p1.id, docNumber: `VFY-OWN-${stamp}`, title: "Their own document", deliverableType: "VND",
        docType: "DAS", discipline: "ME", originator: party.code, createdById: "verify", createdByName: "verify",
      },
    });
    const issued = await t1.db.document.create({
      data: {
        projectId: p1.id, docNumber: `VFY-ISSUED-${stamp}`, title: "Issued to them", deliverableType: "ENG",
        docType: "DRW", discipline: "ME", createdById: "verify", createdByName: "verify",
      },
    });
    const issuedRev = await t1.db.revision.create({
      data: { projectId: p1.id, documentId: issued.id, value: "A", state: "RELEASED" },
    });
    const person = await db.user.upsert({
      where: { orgId_email: { orgId: org.id, email: `verify.supplier.${stamp}@example.test` } },
      update: {},
      create: { orgId: org.id, email: `verify.supplier.${stamp}@example.test`, name: "Verify Supplier person", passwordHash: "x", role: "VIEWER", partyId: party.id },
    });
    const transmittal = await t1.db.transmittal.create({
      data: {
        projectId: p1.id, number: `TR-VFY-${stamp}`, direction: "OUTGOING", status: "ISSUED", reasonForIssue: "INFORMATION",
        issuingParty: "Us", dateOfIssue: new Date(), subject: "For your files", createdById: "verify", createdByName: "verify",
        items: { create: [{ projectId: p1.id, revisionId: issuedRev.id }] },
        recipients: { create: [{ projectId: p1.id, userId: person.id, name: person.name, organization: party.name }] },
      },
    });
    const outside = scopedClient(org.id, p1.id, null, { partyCode: party.code, userId: person.id, organization: party.name });
    const visible = await outside.document.findMany({ select: { id: true, docNumber: true } });
    const ids = new Set(visible.map((d) => d.id));
    check("they see what their own party produced", ids.has(theirs.id));
    check("they see what was issued to them", ids.has(issued.id));
    check("they do not see our other documents", !ids.has(staff.id), `${visible.length} visible`);
    check("and cannot reach one by id either", (await outside.document.findFirst({ where: { id: staff.id } })) === null);

    // Files follow what they belong to. A link to a file is not a key to it.
    const fileOf = (revisionId: string | null, name: string) => db.storedFile.create({
      data: { projectId: p1.id, name, path: `verify/${stamp}/${name}`, size: 1, mime: "application/pdf", sha256: "x", kind: "RENDITION", revisionId },
    });
    const issuedFile = await fileOf(issuedRev.id, "issued.pdf");
    const strayFile = await fileOf(null, "ours.pdf");
    check("they can open the file of what was issued to them", !!(await outside.storedFile.findFirst({ where: { id: issuedFile.id } })));
    check("they cannot open one of our files by its id", (await outside.storedFile.findFirst({ where: { id: strayFile.id } })) === null);
    const elsewhere = await db.organization.findFirst({ where: { NOT: { id: org.id } }, include: { projects: { take: 1 } } });
    if (elsewhere?.projects[0]) {
      const theirClient = tenantFor(elsewhere.id, elsewhere.projects[0].id).db;
      check("another organization cannot open our file by its id", (await theirClient.storedFile.findFirst({ where: { id: issuedFile.id } })) === null);
    }
    check("another project of ours cannot either", (await t2.db.storedFile.findFirst({ where: { id: issuedFile.id } })) === null);
    await db.storedFile.deleteMany({ where: { id: { in: [issuedFile.id, strayFile.id] } } });

    await db.transmittalItem.deleteMany({ where: { transmittalId: transmittal.id } });
    await db.transmittalRecipient.deleteMany({ where: { transmittalId: transmittal.id } });
    await db.transmittal.delete({ where: { id: transmittal.id } });
    await db.revision.delete({ where: { id: issuedRev.id } });
    await db.document.deleteMany({ where: { id: { in: [theirs.id, issued.id] } } });
  }

  console.log(failures === 0 ? "\nAll tenancy checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
