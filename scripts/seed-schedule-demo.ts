// Demo: a schedule with enough activities to see the plan and the table as they
// behave in real life — thirty actions spread across six months, each tagged
// with the disciplines it concerns and most of them needing documents.
//
// Safe to re-run: an action is matched by its Activity Code, so running it twice
// moves nothing and creates nothing twice.
//
// Run after the demo seed: npx tsx scripts/seed-schedule-demo.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { tenantFor } from "../src/lib/tenant";
import { nextActionCode, daysBefore, DEFAULT_LEAD_DAYS } from "../src/lib/schedule";

const db = new PrismaClient();
const day = 86_400_000;
const on = (n: number) => new Date(Date.now() + n * day);

/** Thirty activities of a water-treatment plant, from earthworks to handover. */
const PLAN: { ref: string; name: string; description: string; at: number; departments: string }[] = [
  { ref: "1000", name: "Site establishment — access road and compound", description: "Haul road, gate house, laydown area", at: -84, departments: "CI" },
  { ref: "1010", name: "Bulk earthworks — clarifier basin", description: "Cut to level and shore the basin", at: -70, departments: "CI,ST" },
  { ref: "1020", name: "Piling — clarifier TK-201", description: "42 bored piles under the clarifier raft", at: -56, departments: "CI,ST" },
  { ref: "1030", name: "Foundation concrete pour — clarifier TK-201", description: "Raft under the clarifier, area 20", at: -42, departments: "CI,ST" },
  { ref: "1040", name: "Underground services — area 20", description: "Drainage, ducts and earthing grid", at: -35, departments: "CI,EL" },
  { ref: "1050", name: "Clarifier shell erection", description: "Plate erection and welding", at: -28, departments: "ST,ME" },
  { ref: "1060", name: "Switchroom building — blockwork", description: "Walls up to roof level", at: -21, departments: "CI,AR" },
  { ref: "1070", name: "Inlet works — pipework prefabrication", description: "DN600 headers, spools off site", at: -14, departments: "PI,ME" },
  { ref: "1080", name: "Sludge pumps P-301/302 — delivery to site", description: "Two duty pumps and their baseplates", at: -10, departments: "ME" },
  { ref: "1090", name: "MCC-2 — delivery to site", description: "Motor control centre for area 20", at: -7, departments: "EL" },
  { ref: "1100", name: "Clarifier bridge — mechanical installation", description: "Rotating bridge, drive and scrapers", at: -3, departments: "ME,ST" },
  { ref: "1110", name: "Switchroom — cable tray and containment", description: "Tray routes from MCC-2 to area 20", at: 2, departments: "EL" },
  { ref: "1120", name: "Sludge pumps — mechanical installation", description: "Set, align and grout both pumps", at: 5, departments: "ME,PI" },
  { ref: "1130", name: "MCC-2 — installation and termination", description: "Set in place, terminate incomers", at: 9, departments: "EL" },
  { ref: "1140", name: "Inlet works — pipework installation", description: "Erect the prefabricated spools", at: 12, departments: "PI" },
  { ref: "1150", name: "Instrument loops — area 20 field devices", description: "Level, flow and pressure transmitters", at: 16, departments: "IC,EL" },
  { ref: "1160", name: "Pipework pressure test — inlet works", description: "Hydrotest at 1.5 times design", at: 20, departments: "PI,QA" },
  { ref: "1170", name: "Cable pulling — area 20", description: "Power and control cables to the field", at: 24, departments: "EL" },
  { ref: "1180", name: "Loop checks — area 20", description: "Field to control system, loop by loop", at: 28, departments: "IC" },
  { ref: "1190", name: "Motor solo runs — sludge pumps", description: "Uncoupled runs, rotation and vibration", at: 33, departments: "ME,EL" },
  { ref: "1200", name: "Clarifier — cleaning and inspection", description: "Clean down before water is let in", at: 38, departments: "ME,QA" },
  { ref: "1210", name: "Water fill — clarifier TK-201", description: "First fill and leak inspection", at: 44, departments: "PR,ME" },
  { ref: "1220", name: "Control system — area 20 software load", description: "Load and verify the control narrative", at: 50, departments: "IC" },
  { ref: "1230", name: "Functional testing — inlet works", description: "Sequences, interlocks and alarms", at: 57, departments: "IC,PR" },
  { ref: "1240", name: "Safety systems test — area 20", description: "Emergency stops, trips and permissives", at: 63, departments: "SA,IC" },
  { ref: "1250", name: "Aeration blower BL-301 — commissioning readiness", description: "Readiness review before energisation", at: 70, departments: "ME,PR" },
  { ref: "1260", name: "Energisation — MCC-2", description: "Permanent power on to the switchroom", at: 77, departments: "EL,SA" },
  { ref: "1270", name: "Wet commissioning — area 20", description: "Plant run on water, then on process", at: 85, departments: "PR,ME,IC" },
  { ref: "1280", name: "Performance test — clarifier train", description: "72-hour test against the guarantee", at: 95, departments: "PR,QA" },
  { ref: "1290", name: "Handover — area 20 to operations", description: "Documentation, spares and training", at: 110, departments: "QA,GE,PM" },
];

async function main() {
  const org = await db.organization.findFirstOrThrow({ where: { slug: "our-org" } });
  const project = await db.project.findFirstOrThrow({ where: { orgId: org.id, code: "P1001" } });
  const t = tenantFor(org.id, project.id);

  // The disciplines this project actually publishes; a tag it does not know is
  // dropped rather than invented.
  const published = new Set((await db.configValue.findMany({ where: { orgId: org.id, setKey: "DISCIPLINES" }, select: { code: true } })).map((one) => one.code));
  const documents = await db.document.findMany({
    where: { projectId: project.id, isPlaceholder: false },
    select: { id: true, discipline: true, docNumber: true },
  });
  const statuses = await db.configValue.findMany({ where: { orgId: org.id, setKey: "STATUSES", status: "ACTIVE" }, select: { code: true, props: true } });
  const permits = statuses.find((one) => {
    try { return one.props ? (JSON.parse(one.props) as { executionFlag?: boolean }).executionFlag === true : false; } catch { return false; }
  });
  const requiredStatus = permits?.code ?? statuses[0]?.code ?? "IFC";

  let created = 0;
  let moved = 0;
  let listed = 0;

  for (const activity of PLAN) {
    const departments = activity.departments.split(",").filter((one) => published.has(one)).join(",");
    const scheduledDate = on(activity.at);
    const existing = await db.action.findFirst({ where: { projectId: project.id, scheduleRef: activity.ref } });
    const action = existing
      ? await db.action.update({
          where: { id: existing.id },
          data: { name: activity.name, description: activity.description, scheduledDate, departments },
        })
      : await db.action.create({
          data: {
            projectId: project.id,
            code: await nextActionCode(t),
            scheduleRef: activity.ref,
            name: activity.name,
            description: activity.description,
            scheduledDate,
            departments,
            ownerName: "Construction",
          },
        });
    if (existing) moved++; else created++;

    // Most activities need documents, so the plan has bars rather than dots.
    // They are the register's own documents, matched by discipline where one
    // fits, so nothing here invents a document.
    const wanted = departments
      .split(",")
      .flatMap((discipline) => documents.filter((one) => one.discipline === discipline).slice(0, 2))
      .slice(0, 4);
    for (const document of wanted) {
      const already = await db.baselineEntry.findFirst({ where: { actionId: action.id, documentId: document.id } });
      if (already) continue;
      await db.baselineEntry.create({
        data: {
          projectId: project.id,
          actionId: action.id,
          documentId: document.id,
          department: document.discipline,
          requiredStatus,
          requiredBy: daysBefore(scheduledDate, DEFAULT_LEAD_DAYS),
          leadBusinessDays: DEFAULT_LEAD_DAYS,
          createdByName: "Schedule demo",
        },
      });
      listed++;
    }
  }

  // The early activities are behind us and their documents were delivered, so
  // the plan has ready work on it as well as work that is late: a requirement
  // is asked for the status its document already carries.
  let ready = 0;
  for (const activity of PLAN.filter((one) => one.at < -20)) {
    const action = await db.action.findFirst({ where: { projectId: project.id, scheduleRef: activity.ref } });
    if (!action) continue;
    const entries = await db.baselineEntry.findMany({
      where: { actionId: action.id },
      include: { document: { include: { revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1 } } } },
    });
    const delivered = entries.filter((one) => one.document.revisions[0]?.statusCode);
    if (!delivered.length) continue;
    // What was never released cannot have been delivered for work that is
    // already done, so it is not listed against it.
    for (const entry of entries.filter((one) => !one.document.revisions[0]?.statusCode)) {
      await db.baselineEntry.delete({ where: { id: entry.id } });
    }
    for (const entry of delivered) {
      const carried = entry.document.revisions[0]!.statusCode!;
      if (entry.requiredStatus === carried) continue;
      await db.baselineEntry.update({ where: { id: entry.id }, data: { requiredStatus: carried } });
    }
    ready++;
  }

  const total = await db.action.count({ where: { projectId: project.id } });
  console.log(`${created} activities added, ${moved} re-dated, ${listed} requirements listed, ${ready} ready — ${total} actions on ${project.code}.`);
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
