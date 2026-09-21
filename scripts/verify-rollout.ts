// Phase 8 exit criterion: an organization starts from configuration held as
// data, a project type adds its starter values, and adding them to an
// organization that already exists goes through change control like anything
// else.
//
// Runs against throwaway organizations so the seeded fixtures are untouched.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { tenantFor } from "../src/lib/tenant";
import { publishReferenceConfiguration } from "../src/lib/bootstrap";
import { REFERENCE, PROFILES, PROJECT_KINDS, profileForKind, missingFromProfile, draftProfile } from "../src/lib/profiles";

const db = new PrismaClient();
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function freshOrg(kind?: string) {
  const org = await db.organization.create({ data: { slug: `verify-rollout-${kind ?? "general"}-${Date.now()}`, name: "Rollout verification" } });
  const project = await db.project.create({ data: { orgId: org.id, code: "RV1", name: "Rollout project", kind: kind ?? "GENERIC" } });
  await publishReferenceConfiguration(db, org.id, kind);
  return { org, project, t: tenantFor(org.id, project.id) };
}

/** Remove a throwaway organization; the order follows the foreign keys. */
async function removeOrg(orgId: string) {
  const p = { project: { orgId } };
  const sets = await db.controlledSet.findMany({ where: { orgId }, select: { id: true } });
  await db.controlledVersion.deleteMany({ where: { setId: { in: sets.map((x) => x.id) } } });
  await db.controlledSet.deleteMany({ where: { orgId } });
  await db.auditEvent.deleteMany({ where: p });
  await db.projectMembership.deleteMany({ where: p });
  await db.scopeConfig.deleteMany({ where: p });
  await db.permissionRule.deleteMany({ where: { orgId } });
  await db.function.deleteMany({ where: { orgId } });
  await db.project.deleteMany({ where: { orgId } });
  const schemes = await db.scheme.findMany({ where: { orgId }, select: { id: true } });
  await db.schemeField.deleteMany({ where: { schemeId: { in: schemes.map((x) => x.id) } } });
  await db.scheme.deleteMany({ where: { orgId } });
  await db.schemeRouting.deleteMany({ where: { orgId } });
  await db.configValue.deleteMany({ where: { orgId } });
  await db.configSet.deleteMany({ where: { orgId } });
  await db.user.deleteMany({ where: { orgId } });
  await db.party.deleteMany({ where: { orgId } });
  await db.organization.delete({ where: { id: orgId } });
}

async function main() {
  // Earlier runs that stopped half-way leave their organizations behind.
  for (const o of await db.organization.findMany({ where: { slug: { startsWith: "verify-rollout-" } }, select: { id: true } })) await removeOrg(o.id);

  const made: string[] = [];
  try {
    console.log("\nThe starting configuration is data\n");
    check("the reference holds the Annex D sets", REFERENCE.sets.length >= 20 && ["STATUSES", "REVIEW_OUTCOMES", "DISCIPLINES", "DOCUMENT_TYPES"].every((k) => REFERENCE.sets.some((s) => s.key === k)));
    check("every project type has a profile, and every profile a type", PROJECT_KINDS.filter((k) => k.code !== "GENERIC").every((k) => profileForKind(k.code)) && PROFILES.every((p) => PROJECT_KINDS.some((k) => k.code === p.projectKind)));
    for (const p of PROFILES) {
      const clash = p.sets.flatMap((s) => s.values.filter((v) => REFERENCE.sets.find((r) => r.key === s.key)?.values.some((r) => r.code === v.code)).map((v) => `${s.key}:${v.code}`));
      check(`${p.name} only adds — no code clashes with the reference`, clash.length === 0, clash.join(", "));
    }

    console.log("\nA new organization gets the reference, plus its project type\n");
    const general = await freshOrg();
    made.push(general.org.id);
    const refDisciplines = REFERENCE.sets.find((s) => s.key === "DISCIPLINES")!.values.length;
    check("a general organization has exactly the reference disciplines", (await general.t.db.configValue.count({ where: { setKey: "DISCIPLINES" } })) === refDisciplines);
    const statuses = await general.t.db.configValue.findFirst({ where: { setKey: "STATUSES", code: "IFC" } });
    check("reference properties come across (IFC permits execution)", !!statuses?.props && JSON.parse(statuses.props).executionFlag === true);

    const energy = await freshOrg("ENERGY");
    made.push(energy.org.id);
    const profile = profileForKind("ENERGY")!;
    check("an energy organization starts with the energy values", (await missingFromProfile(energy.t, profile)).length === 0);
    check("…on top of the reference ones", (await energy.t.db.configValue.count({ where: { setKey: "DISCIPLINES" } })) === refDisciplines + profile.sets.find((s) => s.key === "DISCIPLINES")!.values.length);

    console.log("\nA new project type later is a controlled change (§4.7)\n");
    const construction = profileForKind("CONSTRUCTION")!;
    const before = await general.t.db.configValue.count({ where: { setKey: "DOCUMENT_TYPES" } });
    const { drafted } = await draftProfile(general.t, construction);
    check("the profile is drafted per value set it extends", drafted.length === construction.sets.length, `${drafted.length}: ${drafted.join(", ")}`);
    check("nothing is published by drafting", (await general.t.db.configValue.count({ where: { setKey: "DOCUMENT_TYPES" } })) === before);
    const draft = await general.t.db.controlledVersion.findFirstOrThrow({ where: { set: { key: "DOCUMENT_TYPES" }, state: "DRAFT" } });
    const lines = JSON.parse(draft.diff ?? "[]") as { change: string }[];
    check("the draft only adds values", lines.every((l) => l.change === "ADDED" || l.change === "UNCHANGED") && lines.filter((l) => l.change === "ADDED").length === construction.sets.find((s) => s.key === "DOCUMENT_TYPES")!.values.length);
    const again = await draftProfile(general.t, construction);
    check("a second request waits for the first decision", again.drafted.length === 0 && again.skipped.length === construction.sets.length);
  } finally {
    for (const id of made) await removeOrg(id);
  }

  await db.$disconnect();
  console.log(failures ? `\n${failures} check(s) FAILED.` : "\nAll rollout checks passed.");
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
