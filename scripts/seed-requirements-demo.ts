// Demo: the requirements process walked through in order, so every step of
// Schedule & actions → Requirements has something to show — safe to re-run.
//
//   1 · departments per activity  — every activity tagged
//   2 · ask the departments       — Civil, Structural, Electrical,
//                                   Mechanical and Water & wastewater answered; General overdue, reminded once
//   3 · tell each sender           — the lists that came back, one sender already told
//
// Run after the demo seed: npx tsx scripts/seed-requirements-demo.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const day = 86_400_000;
const d = (n: number) => new Date(Date.now() + n * day);

async function main() {
  const org = await db.organization.findFirstOrThrow({ where: { slug: "our-org" } });
  const project = await db.project.findFirstOrThrow({ where: { orgId: org.id, code: "P1" } });
  const projectId = project.id;
  const controller = await db.user.findFirst({ where: { orgId: org.id, email: "controller@delios.local" } })
    ?? (await db.user.findFirstOrThrow({ where: { orgId: org.id, email: "admin@delios.local" } }));

  // Step 1 — which departments each activity concerns.
  const tags: Record<string, string> = { A0007: "CI,ST", A0031: "EL,WW,GE", A0044: "ME", A00001: "EL", A00002: "ME" };
  const actions = await db.action.findMany({ where: { projectId } });
  for (const a of actions) {
    const want = tags[a.code];
    if (want && !a.departments) await db.action.update({ where: { id: a.id }, data: { departments: want } });
  }
  const tagged = await db.action.findMany({ where: { projectId } });
  const codesFor = (dept: string) => tagged.filter((a) => (a.departments ?? "").split(",").includes(dept)).map((a) => a.code);

  // Each listed document belongs to the department that listed it.
  for (const e of await db.baselineEntry.findMany({ where: { projectId, department: null }, include: { document: true, action: true } })) {
    const depts = (e.action.departments ?? "").split(",").filter(Boolean);
    const dept = depts.includes(e.document.discipline) ? e.document.discipline : depts[0];
    if (dept) await db.baselineEntry.update({ where: { id: e.id }, data: { department: dept } });
  }

  // Step 2 — the calls to the departments.
  if (!(await db.requirementCall.count({ where: { projectId } }))) {
    const call = (department: string, issued: number, due: number, answered: number | null, extra: Record<string, unknown> = {}) =>
      db.requirementCall.create({
        data: {
          projectId, department, actionCodes: codesFor(department).join(","), issuedAt: d(issued), dueAt: d(due),
          issuedById: controller.id, issuedByName: controller.name,
          answeredAt: answered === null ? null : d(answered), ...extra,
        },
      });
    await call("CI", -20, -13, -14, { answerNote: "Architectural layout added for the clarifier pour" });
    await call("ST", -20, -13, -15);
    await call("EL", -18, -11, -12);
    await call("ME", -18, -11, -10, { answerNote: "Manual and specification listed" });
    await call("WW", -18, -11, -9, { answerNote: "Operation and maintenance manual listed" });
    await call("GE", -9, -2, null, { reminders: 1, lastRemindedAt: d(-1) });
  }

  // Step 3 — one sender already told; the rest still to do.
  if (!(await db.senderIssue.count({ where: { projectId } }))) {
    const first = await db.baselineEntry.findFirst({ where: { projectId, department: "ST" }, include: { document: true } });
    const sender = first ? first.submittedBy ?? first.document.originator ?? `DEPT:${first.document.discipline}` : null;
    if (sender) {
      const count = await db.baselineEntry.count({ where: { projectId, OR: [{ submittedBy: sender }, { submittedBy: null, document: sender.startsWith("DEPT:") ? { discipline: sender.slice(5), originator: null } : { originator: sender } }] } });
      await db.senderIssue.create({ data: { projectId, sender, entryCount: count, issuedAt: d(-12), issuedById: controller.id, issuedByName: controller.name } });
    }
  }
  console.log("requirements demo: activities tagged, 5 departments answered, General overdue, one sender told");
}

main().finally(() => db.$disconnect());
