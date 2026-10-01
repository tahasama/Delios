// Phase 2 exit criterion: authority comes from the function someone holds, and
// a function with no matching rule can neither see nor act.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { tenantFor, scopedClient } from "../src/lib/tenant";
import { loadActor, can, verbsFor, openConfidentiality, holdersOf } from "../src/lib/permissions";
import { recipientsFor, offDistribution } from "../src/lib/distribution";

const db = new PrismaClient();
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const org = await db.organization.findFirstOrThrow({ where: { slug: "our-org" } });
  const p1 = await db.project.findFirstOrThrow({ where: { orgId: org.id, code: "P1001" } });
  const t = tenantFor(org.id, p1.id);

  const byCode = async (code: string) => {
    const fn = await db.function.findUnique({ where: { orgId_code: { orgId: org.id, code } } });
    return fn ? await loadActor(t, fn.id) : null;
  };

  const lead = await byCode("LEAD_ELEC_ENG");
  const tech = await byCode("ELEC_TECH");
  const comm = await byCode("COMM_ENG");
  const admin = await byCode("ADMIN");
  const viewer = await byCode("VIEWER");

  if (!lead || !tech || !comm || !admin || !viewer) {
    check("demo functions are seeded", false, "run `SEED_DEMO=1 npm run db:seed`");
    process.exit(1);
  }

  const elecDrawing = { discipline: "EL", docType: "DWG", confidentiality: "INTERNAL" };
  const civilDrawing = { discipline: "CI", docType: "DWG", confidentiality: "INTERNAL" };
  const elecReport = { discipline: "EL", docType: "RPT", confidentiality: "INTERNAL" };
  const restricted = { discipline: "EL", docType: "RPT", confidentiality: "RESTRICTED" };

  console.log("\nVerbs follow the function, not the person\n");
  check("lead may approve an electrical drawing", can(lead, "APPROVE", elecDrawing));
  check("lead may NOT approve a civil drawing", !can(lead, "APPROVE", civilDrawing));
  check("lead may still read a civil drawing", can(lead, "READ", civilDrawing));
  check("technician may read an electrical drawing", can(tech, "READ", elecDrawing));
  check("technician may NOT read a civil drawing", !can(tech, "READ", civilDrawing));
  check("technician may NOT read an electrical report", !can(tech, "READ", elecReport), "rule is drawings only");
  check("technician may NOT approve anything", !can(tech, "APPROVE", elecDrawing));
  check("commissioning may review any discipline", can(comm, "REVIEW", civilDrawing) && can(comm, "REVIEW", elecDrawing));
  check("commissioning may NOT approve", !can(comm, "APPROVE", elecDrawing));
  check("administrator may configure", can(admin, "CONFIGURE"));
  check("viewer may NOT configure", !can(viewer, "CONFIGURE"));

  // A default that leaves the most basic function unable to see an ordinary
  // document is useless, however correct it is on paper.
  check("the default Viewer can read an ordinary internal document",
    can(viewer, "READ", { discipline: "CI", docType: "DWG", confidentiality: "INTERNAL" }),
    "an ordinary document is the ordinary register");

  console.log("\nA closed document is read by the people named on it\n");
  // Confidentiality above the open levels is not a ladder: being senior does not
  // open a closed document, and being named does — whatever else you hold.
  const confidentialityValues = await db.configValue.findMany({ where: { orgId: org.id, setKey: "CONFIDENTIALITY" }, select: { code: true, props: true } });
  const openCodes = openConfidentiality(confidentialityValues.map((one) => {
    let props: Record<string, unknown> = {};
    if (one.props) { try { props = JSON.parse(one.props) as Record<string, unknown>; } catch { /* not a level */ } }
    return { code: one.code, props };
  }));
  check("Public and Internal are open to the project", openCodes.includes("PUBLIC") && openCodes.includes("INTERNAL"), openCodes.join(", "));
  check("Restricted and Confidential are not", !openCodes.includes("RESTRICTED") && !openCodes.includes("CONFIDENTIAL"));

  const techUser = await db.user.findFirst({ where: { orgId: org.id, memberships: { some: { projectId: p1.id, function: { code: "ELEC_TECH" } } } } });
  const leadUser = await db.user.findFirst({ where: { orgId: org.id, memberships: { some: { projectId: p1.id, function: { code: "LEAD_ELEC_ENG" } } } } });
  const adminUser = await db.user.findFirst({ where: { orgId: org.id, memberships: { some: { projectId: p1.id, function: { code: "ADMIN" } } } } });
  check("the demo has a technician, a lead and an administrator on P1", !!techUser && !!leadUser && !!adminUser);

  const restrictedDoc = await db.document.findFirst({ where: { projectId: p1.id, confidentiality: "RESTRICTED" } });
  check("a RESTRICTED document exists to test with", !!restrictedDoc, restrictedDoc?.docNumber);

  if (techUser && leadUser && adminUser && restrictedDoc) {
    const reader = (userId: string, everything = false) => scopedClient(org.id, p1.id, { userId, everything, openCodes });
    const techDb = reader(techUser.id);
    const leadDb = reader(leadUser.id);
    const adminDb = reader(adminUser.id, true);

    check("the technician's register does not list it", (await techDb.document.findFirst({ where: { id: restrictedDoc.id } })) === null);
    check("seniority alone does not open it — the lead cannot either",
      (await leadDb.document.findFirst({ where: { id: restrictedDoc.id } })) === null);
    check("the administrator reads it", (await adminDb.document.findFirst({ where: { id: restrictedDoc.id } })) !== null);
    const hunted = await techDb.document.findMany({ where: { docNumber: { contains: restrictedDoc.docNumber } } });
    check("searching for it by number finds nothing", hunted.length === 0);
    check("it is missing from the technician's count",
      (await techDb.document.count()) < (await adminDb.document.count()),
      `${await techDb.document.count()} vs ${await adminDb.document.count()}`);
    check("its revisions are as closed as it is",
      (await techDb.revision.findFirst({ where: { documentId: restrictedDoc.id } })) === null);
    check("so are its reviews",
      (await techDb.reviewCycle.findFirst({ where: { revision: { documentId: restrictedDoc.id } } })) === null);

    // Named on the document, and it opens — for that person only.
    const named = await db.documentAccess.create({
      data: { projectId: p1.id, documentId: restrictedDoc.id, userId: techUser.id, addedById: adminUser.id, addedByName: "verify" },
    });
    check("named on it, the technician reads it", (await techDb.document.findFirst({ where: { id: restrictedDoc.id } })) !== null);
    check("naming one person does not open it to another",
      (await leadDb.document.findFirst({ where: { id: restrictedDoc.id } })) === null);
    await db.documentAccess.delete({ where: { id: named.id } });
    check("taken off the list, it closes again", (await techDb.document.findFirst({ where: { id: restrictedDoc.id } })) === null);
  }


  console.log("\nDistribution is the matrix read through RECEIVE (§11.8)\n");
  const onElecDrawings = await recipientsFor(t, elecDrawing);
  const onCivilDrawings = await recipientsFor(t, civilDrawing);
  check("someone is on the distribution for electrical drawings", onElecDrawings.length > 0,
    onElecDrawings.map((r) => r.functionName).join(", "));
  check("the technician is on it", onElecDrawings.some((r) => r.functionName === "Electrical Technician"));
  check("the technician is NOT on civil drawings", !onCivilDrawings.some((r) => r.functionName === "Electrical Technician"),
    onCivilDrawings.map((r) => r.functionName).join(", ") || "nobody");

  const onRestricted = await recipientsFor(t, restricted);
  check("the technician is not on a RESTRICTED report's distribution",
    !onRestricted.some((r) => r.functionName === "Electrical Technician"));

  // Issuing to someone off the list is allowed, but must be flagged (§11.8).
  const technician = await db.user.findFirst({ where: { orgId: org.id, email: "tech.elec@delios.local" } });
  if (technician) {
    const strangers = await offDistribution(t, civilDrawing, [technician.id]);
    check("issuing civil drawings to the technician is flagged off-distribution", strangers.length === 1,
      strangers[0]?.basis);
    const normal = await offDistribution(t, elecDrawing, [technician.id]);
    check("issuing electrical drawings to them is not flagged", normal.length === 0);
  }

  console.log("\nA function with no rule can do nothing\n");
  const empty = await db.function.create({
    data: { orgId: org.id, code: `TMP_${Date.now()}`, name: "Temporary empty function", clearance: 4, legacyRole: "AUTHOR" },
  });
  const emptyActor = await loadActor(t, empty.id);
  check("holds no verbs at all", verbsFor(emptyActor).length === 0);
  check("cannot read anything", !can(emptyActor, "READ", elecDrawing));
  check("cannot create", !can(emptyActor, "CREATE", elecDrawing));
  check("is on nobody's distribution", !(await recipientsFor(t, elecDrawing)).some((r) => r.functionName === empty.name));
  await db.function.delete({ where: { id: empty.id } });

  console.log("\nThe matrix decides, not a rank on the account\n");
  // One job that originates, reviews and approves — a Mechanical Engineering Manager.
  const manager = await db.function.create({ data: { orgId: org.id, code: `MEM_${Date.now()}`, name: "Mechanical Engineering Manager", clearance: 3, legacyRole: "AUTHOR" } });
  await db.permissionRule.create({ data: { orgId: org.id, functionId: manager.id, discipline: "ME", verbs: JSON.stringify(["READ", "CREATE", "REVISE", "REVIEW", "APPROVE"]) } });
  const mem = await loadActor(t, manager.id);
  const mechCalc = { discipline: "ME", docType: "CAL", confidentiality: "INTERNAL" };
  check("one function may create, review and approve", can(mem, "CREATE", mechCalc) && can(mem, "REVIEW", mechCalc) && can(mem, "APPROVE", mechCalc));
  check("…only for the discipline the matrix names", !can(mem, "APPROVE", elecDrawing));
  await db.permissionRule.deleteMany({ where: { functionId: manager.id } });
  await db.function.delete({ where: { id: manager.id } });

  console.log("\nSettings verbs an administrator can grant\n");
  check("an administrator holds Plan, Review routes and Read matrix through Configure", can(admin, "PLAN") && can(admin, "ROUTES") && can(admin, "MATRIX"));
  const dc = await byCode("CONTROLLER");
  check("Document Control holds none of them until granted", !!dc && !can(dc, "MATRIX") && !can(dc, "ROUTES"));
  const grant = await db.permissionRule.create({ data: { orgId: org.id, functionId: dc!.functionId, verbs: JSON.stringify(["MATRIX", "ROUTES"]) } });
  const dc2 = await loadActor(t, dc!.functionId);
  check("…and holds them once granted", can(dc2, "MATRIX") && can(dc2, "ROUTES") && !can(dc2, "CONFIGURE"));
  await db.permissionRule.delete({ where: { id: grant.id } });
  const pm = await byCode("PROJECT_MANAGER");
  check("the project manager plans and approves nothing", !!pm && can(pm, "PLAN") && !can(pm, "APPROVE", elecDrawing));

  const approvers = await holdersOf(t, "APPROVE", elecDrawing);
  check("who may approve an electrical drawing is read off the matrix", approvers.some((p) => p.functionName === "Lead Electrical Engineer") && !approvers.some((p) => p.functionName === "Electrical Technician"), approvers.map((p) => p.functionName).join(", "));

  console.log(failures === 0 ? "\nAll permission checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
