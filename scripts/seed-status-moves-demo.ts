/**
 * A worked example of statuses that move: a route whose first box hands the
 * revision on at IFR, whose second box hands it on at IFA, and whose deciding
 * box may only decide between AFC and IFC — where AFC is a status Document
 * Control fixes, because it is the other organization's approval that makes it
 * true.
 *
 * It publishes the three status properties on the statuses it uses, publishes
 * the route, and starts it on a revision in preparation, so "to be IFR" can be
 * seen in the register without setting anything up by hand.
 *
 *   npx tsx scripts/seed-status-moves-demo.ts
 */
import { PrismaClient } from "@prisma/client";
import { tenantFor } from "../src/lib/tenant";
import { startWorkflowRun, type WfStep } from "../src/lib/workflow";

const db = new PrismaClient();

/** What each status in the example says about itself. */
const RULES: Record<string, { audience: string; proposableBy: string; grantableBy: string }> = {
  IFR: { audience: "Outside as well", proposableBy: "Any step", grantableBy: "The deciding step" },
  IFA: { audience: "Outside as well", proposableBy: "Any step", grantableBy: "The deciding step" },
  IFC: { audience: "Outside as well", proposableBy: "The deciding step only", grantableBy: "The deciding step" },
  AFC: { audience: "Outside as well", proposableBy: "No step", grantableBy: "Document Control only" },
};

async function main() {
  const project = await db.project.findFirst({ orderBy: { createdAt: "asc" } });
  if (!project) throw new Error("No project.");
  const t = tenantFor(project.orgId, project.id);

  // The statuses say who may put a revision at them. Whatever else a status
  // already carries is kept: only these three properties are written.
  for (const [code, rule] of Object.entries(RULES)) {
    const value = await db.configValue.findFirst({ where: { setKey: "STATUSES", code } });
    if (!value) { console.log(`${code} is not published here — skipped.`); continue; }
    let props: Record<string, unknown> = {};
    try { props = value.props ? JSON.parse(value.props) : {}; } catch { props = {}; }
    await db.configValue.update({ where: { id: value.id }, data: { props: JSON.stringify({ ...props, ...rule }) } });
    console.log(`${code}: ${rule.proposableBy.toLowerCase()} may hand on at it; fixed by ${rule.grantableBy.toLowerCase()}.`);
  }

  const seat = await db.projectMembership.findFirst({
    where: { projectId: project.id, active: true },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  });
  if (!seat) throw new Error("No people on the project.");

  // Three boxes, each saying what it does to the status.
  const steps: WfStep[] = [
    { act: "REVIEW", mode: "ALL", participantIds: [seat.user.id], title: "Discipline check", days: 5 },
    { act: "REVIEW", mode: "ALL", participantIds: [seat.user.id], title: "Lead reads it", days: 5 },
    { act: "APPROVAL", mode: "ANY_OF", participantIds: [seat.user.id], title: "Decision", days: 5, grantsStatuses: ["IFC", "AFC"] },
  ];

  const name = "Engineering drawings — lead engineer decides";
  const held = await db.workflowTemplate.findFirst({ where: { orgId: project.orgId, name } });
  const template = held
    ? await db.workflowTemplate.update({ where: { id: held.id }, data: { steps: JSON.stringify(steps), active: true } })
    : await db.workflowTemplate.create({
        data: {
          orgId: project.orgId,
          id: `status-moves-demo-${Date.now().toString(36)}`,
          name,
          description: "A discipline check, then the lead reads it, then the lead decides. The decision may only be IFC or AFC.",
          classes: "*",
          steps: JSON.stringify(steps),
          outcomeSetKey: "REVIEW_OUTCOMES",
          createdByName: "Example",
        },
      });

  // A document has one revision in motion at a time, so the example takes a
  // revision in preparation whose document has nothing else running.
  let revision = await db.revision.findFirst({
    where: {
      projectId: project.id,
      state: "IN_PREPARATION",
      workflowRuns: { none: { status: "ACTIVE" } },
      document: { revisions: { none: { state: "IN_REVIEW" } } },
    },
    include: { document: true },
    orderBy: { createdAt: "desc" },
  });
  if (!revision) {
    const document = await db.document.findFirstOrThrow({
      // Nothing of this document may be in motion, or the new revision would be
      // the second one — which the system refuses, and rightly.
      where: { projectId: project.id, revisions: { none: { state: { in: ["IN_PREPARATION", "IN_REVIEW"] } } } },
      include: { revisions: { orderBy: { createdAt: "desc" } } },
      orderBy: { updatedAt: "desc" },
    });
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const used = new Set(document.revisions.map((item) => item.value));
    const value = letters.find((letter) => !used.has(letter)) ?? `A${document.revisions.length}`;
    revision = await db.revision.create({
      data: {
        projectId: project.id,
        documentId: document.id,
        value,
        series: "DESIGN",
        state: "IN_PREPARATION",
        reasonForRevision: "Example of statuses that move",
        changeDescription: "Opened by the statuses-that-move example.",
        authoredById: seat.user.id,
        authoredByName: seat.user.name,
        uploadedById: seat.user.id,
        uploadedByName: seat.user.name,
      },
      include: { document: true },
    });
  }

  const run = await startWorkflowRun(t, revision.id, template.id, seat.user as never);
  if (!run.ok) throw new Error(run.error);

  console.log(`Route "${name}" published and started on ${revision.document.docNumber} rev ${revision.value}.`);
  console.log(`Answer the first box at /documents/${revision.documentId} — the revision then reads “to be IFR”.`);
}

main()
  .catch((error) => { console.error(error); process.exit(1); })
  .finally(() => db.$disconnect());
