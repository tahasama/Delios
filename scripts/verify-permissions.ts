// Phase 2 exit criterion: authority comes from the function someone holds, and
// a function with no matching rule can neither see nor act.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { tenantFor, scopedClient } from "../src/lib/tenant";
import { loadActor, can, canSee, verbsFor, visibleConfidentiality } from "../src/lib/permissions";
import { recipientsFor, offDistribution } from "../src/lib/distribution";

const db = new PrismaClient();
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const org = await db.organization.findFirstOrThrow({ where: { slug: "our-org" } });
  const p1 = await db.project.findFirstOrThrow({ where: { orgId: org.id, code: "P1" } });
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
    `clearance ${viewer.clearance}`);

  console.log("\nClearance (§5.7)\n");
  check("lead is cleared for RESTRICTED", canSee(lead, "RESTRICTED"), `clearance ${lead.clearance}`);
  check("technician is NOT cleared for RESTRICTED", !canSee(tech, "RESTRICTED"), `clearance ${tech.clearance}`);
  check("technician IS cleared for INTERNAL", canSee(tech, "INTERNAL"));
  check("clearance beats the verb", !can(tech, "READ", restricted), "no read even where the rule would allow it");
  check("lead reads the restricted report", can(lead, "READ", restricted));

  console.log("\nThe clearance filter reaches the query, not just the check\n");
  const allCodes = (await db.configValue.findMany({ where: { orgId: org.id, setKey: "CONFIDENTIALITY" }, select: { code: true } })).map((c) => c.code);
  const techDb = scopedClient(org.id, p1.id, visibleConfidentiality(tech, allCodes));
  const leadDb = scopedClient(org.id, p1.id, visibleConfidentiality(lead, allCodes));

  const restrictedDoc = await db.document.findFirst({ where: { projectId: p1.id, confidentiality: "RESTRICTED" } });
  check("a RESTRICTED document exists to test with", !!restrictedDoc, restrictedDoc?.docNumber);
  if (restrictedDoc) {
    check("technician's register does not list it", (await techDb.document.findFirst({ where: { id: restrictedDoc.id } })) === null);
    check("lead's register does list it", (await leadDb.document.findFirst({ where: { id: restrictedDoc.id } })) !== null);
    check("it is missing from the technician's count",
      (await techDb.document.count()) < (await leadDb.document.count()),
      `${await techDb.document.count()} vs ${await leadDb.document.count()}`);
    // Searching for it by name must not reveal it either.
    const hunted = await techDb.document.findMany({ where: { docNumber: { contains: restrictedDoc.docNumber } } });
    check("searching for it by number finds nothing", hunted.length === 0);
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
  check("nobody under-cleared is on a RESTRICTED distribution",
    !onRestricted.some((r) => r.functionName === "Electrical Technician"));

  // Issuing to someone off the list is allowed, but must be flagged (§11.8).
  const techUser = await db.user.findFirst({ where: { orgId: org.id, email: "tech.elec@delios.local" } });
  if (techUser) {
    const strangers = await offDistribution(t, civilDrawing, [techUser.id]);
    check("issuing civil drawings to the technician is flagged off-distribution", strangers.length === 1,
      strangers[0]?.basis);
    const normal = await offDistribution(t, elecDrawing, [techUser.id]);
    check("issuing electrical drawings to them is not flagged", normal.length === 0);
  }

  console.log("\nA function with no rule can do nothing\n");
  const empty = await db.function.create({
    data: { orgId: org.id, code: `TMP_${Date.now()}`, name: "Temporary empty function", clearance: 4, legacyRole: "AUTHOR" },
  });
  const emptyActor = await loadActor(t, empty.id);
  check("holds no verbs at all", verbsFor(emptyActor).length === 0);
  check("cannot read, despite clearance 4", !can(emptyActor, "READ", elecDrawing));
  check("cannot create", !can(emptyActor, "CREATE", elecDrawing));
  check("is on nobody's distribution", !(await recipientsFor(t, elecDrawing)).some((r) => r.functionName === empty.name));
  await db.function.delete({ where: { id: empty.id } });

  console.log(failures === 0 ? "\nAll permission checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
