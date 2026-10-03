// The Control room: acts that may be left out, and the names an organization
// gives its states. What may be skipped is a short, fixed list; skipping never
// moves who carries an act out; a rename changes a name and nothing else.
//
// Runs against a throwaway organization so the seeded fixtures are untouched.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { tenantFor } from "../src/lib/tenant";
import { SKIPPABLE, SKIP_KEY, actIsOff, controlDoes, controlSettings, CONTROL_ACTIVITIES } from "../src/lib/control-activities";
import { stateNames, stateName, DEFAULT_STATE_NAMES, STATE_NAMES } from "../src/lib/state-names";
import { REV_STATES } from "../src/lib/standard";
import { typeSkipsReview } from "../src/lib/review-need";

const db = new PrismaClient();
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function removeOrg(orgId: string) {
  await db.controlSetting.deleteMany({ where: { project: { orgId } } });
  await db.stateName.deleteMany({ where: { orgId } });
  await db.configValue.deleteMany({ where: { orgId } });
  await db.configSet.deleteMany({ where: { orgId } });
  await db.project.deleteMany({ where: { orgId } });
  await db.organization.delete({ where: { id: orgId } });
}

async function main() {
  for (const o of await db.organization.findMany({ where: { slug: { startsWith: "verify-room-" } }, select: { id: true } })) await removeOrg(o.id);
  const org = await db.organization.create({ data: { slug: `verify-room-${Date.now()}`, name: "Control room verification" } });
  const project = await db.project.create({ data: { orgId: org.id, code: "CR1", name: "Control room project" } });
  const t = tenantFor(org.id, project.id);

  try {
    console.log("\nWhat may be left out\n");
    const never = ["WITHDRAW", "VOID", "RETURN_OUTCOME", "ISSUE", "REVIEW_ISSUE"];
    check("delegation may be left out", !!SKIPPABLE.DELEGATE);
    check("the action note may be left out", !!SKIPPABLE.ACTION_NOTE);
    check("release, void, withdrawal and the answer reaching its author may not", never.every((key) => !SKIPPABLE[key]));
    check("every skippable act is a real act", Object.keys(SKIPPABLE).every((key) => CONTROL_ACTIVITIES.some((one) => one.key === key)));

    check("nothing is left out until somebody says so", !(await actIsOff(t, "DELEGATE")));
    const before = await controlDoes(t, "DELEGATE");
    await db.controlSetting.upsert({ where: { projectId_key: { projectId: project.id, key: SKIP_KEY("DELEGATE") } }, create: { projectId: project.id, key: SKIP_KEY("DELEGATE"), mode: "OFF" }, update: { mode: "OFF" } });
    check("delegation reads as left out once switched off", await actIsOff(t, "DELEGATE"));
    check("leaving it out does not move who would carry it out", (await controlDoes(t, "DELEGATE")) === before);
    const rows = (await controlSettings(t)).rows;
    check("the settings screen sees it as skipped", rows.find((row) => row.activity.key === "DELEGATE")?.off === true);
    check("and only that act", rows.filter((row) => row.off).length === 1);

    await db.controlSetting.upsert({ where: { projectId_key: { projectId: project.id, key: SKIP_KEY("VOID") } }, create: { projectId: project.id, key: SKIP_KEY("VOID"), mode: "OFF" }, update: { mode: "OFF" } });
    check("an act that may not be skipped ignores a stray switch", !(await actIsOff(t, "VOID")));
    await db.controlSetting.upsert({ where: { projectId_key: { projectId: project.id, key: SKIP_KEY("ACTION_NOTE") } }, create: { projectId: project.id, key: SKIP_KEY("ACTION_NOTE"), mode: "OFF" }, update: { mode: "OFF" } });
    check("the action note reads as left out on its own switch", (await actIsOff(t, "ACTION_NOTE")) && (await controlSettings(t)).rows.filter((row) => row.off).length === 2);

    console.log("\nDocument types reviewed, or not\n");
    await db.configSet.create({ data: { orgId: org.id, key: "DOCUMENT_TYPES", title: "Document types" } });
    await db.configValue.createMany({ data: [
      { orgId: org.id, setKey: "DOCUMENT_TYPES", code: "DWG", label: "Drawing", props: JSON.stringify({ appliesTo: "Non-supplier" }) },
      { orgId: org.id, setKey: "DOCUMENT_TYPES", code: "MOM", label: "Minutes", props: JSON.stringify({ review: false }) },
      { orgId: org.id, setKey: "DOCUMENT_TYPES", code: "SPC", label: "Specification", props: JSON.stringify({ review: true }) },
    ] });
    check("a type that says nothing is reviewed", !(await typeSkipsReview(t, "DWG")));
    check("a type published as not reviewed skips review", await typeSkipsReview(t, "MOM"));
    check("a type published as reviewed is reviewed", !(await typeSkipsReview(t, "SPC")));
    check("an unknown type is reviewed", !(await typeSkipsReview(t, "XYZ")) && !(await typeSkipsReview(t, null)));

    console.log("\nWhat states are called\n");
    const defaults = await stateNames(t);
    check("an organization that renamed nothing reads the defaults", STATE_NAMES.every((one) => defaults[one.code] === DEFAULT_STATE_NAMES[one.code]));
    check("every revision state has a name", REV_STATES.every((state) => stateName(defaults, state).length > 0));
    check("released reads as one act by default", stateName(defaults, "RELEASED") === "Released & issued");
    check("where releasing means go ahead, it reads Released", stateName(defaults, "RELEASED", { together: false }) === "Released");
    check("on hold wins over released", stateName(defaults, "RELEASED", { together: true, held: true }) === "On hold");

    await db.stateName.create({ data: { orgId: org.id, code: "RELEASED_ISSUED", label: "Approved & sent" } });
    await db.stateName.create({ data: { orgId: org.id, code: "IN_REVIEW", label: "Under check" } });
    const renamed = await stateNames(t);
    check("a renamed state reads its new name", stateName(renamed, "RELEASED", { together: true }) === "Approved & sent" && stateName(renamed, "IN_REVIEW") === "Under check");
    check("the others keep theirs", stateName(renamed, "VOID") === "Void" && stateName(renamed, "RELEASED", { together: false }) === "Released");

    const other = await db.organization.create({ data: { slug: `verify-room-other-${Date.now()}`, name: "Another organization" } });
    const otherProject = await db.project.create({ data: { orgId: other.id, code: "CR2", name: "Other" } });
    const elsewhere = await stateNames(tenantFor(other.id, otherProject.id));
    check("one organization's names never reach another", elsewhere.RELEASED_ISSUED === "Released & issued");
    await removeOrg(other.id);
  } finally {
    await removeOrg(org.id);
  }

  console.log(failures ? `\n${failures} check(s) failed.\n` : "\nAll checks passed.\n");
  await db.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
