/**
 * A worked example of a review route with a step answered by an outside party
 * that holds no accounts here: the control office stamps, and one of our people
 * sends the pack and writes down what comes back.
 *
 * It sets the party to answer by proxy, publishes a route that names it, and
 * starts that route on a revision in preparation, so the "Waiting on …" card
 * can be seen without setting anything up by hand.
 *
 *   npx tsx scripts/seed-external-step-demo.ts
 */
import { PrismaClient } from "@prisma/client";
import { tenantFor } from "../src/lib/tenant";
import { startWorkflowRun, type WfStep } from "../src/lib/workflow";

const db = new PrismaClient();

async function main() {
  const project = await db.project.findFirst({ orderBy: { createdAt: "asc" } });
  if (!project) throw new Error("No project.");
  const t = tenantFor(project.orgId, project.id);

  // The party that will answer without an account here.
  const party = await db.party.findFirst({ where: { orgId: project.orgId, isInternal: false }, orderBy: { name: "asc" } });
  if (!party) throw new Error("No outside party. Add one in Parties first.");
  await db.party.update({
    where: { id: party.id },
    data: { participation: "BY_PROXY", externalSystem: null, evidenceRequired: true },
  });

  // Somebody of ours to advise before it goes out.
  const reviewer = await db.projectMembership.findFirst({
    where: { projectId: project.id, active: true },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!reviewer) throw new Error("No people on the project.");

  // One step, held by the party, so the "Waiting on …" card is there the moment
  // the route starts rather than after somebody answers an earlier step.
  const steps: WfStep[] = [
    { act: "APPROVAL", mode: "ANY_OF", participantIds: [], partyId: party.id, title: `${party.name} stamps it`, days: 10 },
  ];

  const name = `Client approval — ${party.name} stamps it`;
  const held = await db.workflowTemplate.findFirst({ where: { orgId: project.orgId, name } });
  const template = held
    ? await db.workflowTemplate.update({ where: { id: held.id }, data: { steps: JSON.stringify(steps), active: true } })
    : await db.workflowTemplate.create({
        data: {
          orgId: project.orgId,
          id: `external-demo-${Date.now().toString(36)}`,
          name,
          description: `${party.name} stamps it. They hold no accounts here, so we send the pack and record their answer.`,
          classes: "*",
          steps: JSON.stringify(steps),
          outcomeSetKey: "REVIEW_OUTCOMES",
          createdByName: "Example",
        },
      });

  // A revision to run it on: one in preparation with no route already running.
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
  // Nothing in preparation: open a fresh revision on the newest document, which
  // is what somebody would do by hand before sending it anywhere.
  if (!revision) {
    const document = await db.document.findFirstOrThrow({
      // Nothing of this document may be in motion, or the new revision would be
      // the second one — which the system refuses, and rightly.
      where: { projectId: project.id, revisions: { none: { state: { in: ["IN_PREPARATION", "IN_REVIEW"] } } } },
      include: { revisions: { orderBy: { createdAt: "desc" } } },
      orderBy: { updatedAt: "desc" },
    });
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const used = new Set(document.revisions.map((item) => item.value));
    const value = letters.split("").find((letter) => !used.has(letter)) ?? `A${document.revisions.length}`;
    const made = await db.revision.create({
      data: {
        projectId: project.id,
        documentId: document.id,
        value,
        series: "DESIGN",
        state: "IN_PREPARATION",
        reasonForRevision: "Example of an outside step",
        changeDescription: "Opened by the external-step example.",
        authoredById: reviewer.user.id,
        authoredByName: reviewer.user.name,
        uploadedById: reviewer.user.id,
        uploadedByName: reviewer.user.name,
      },
      include: { document: true },
    });
    revision = made;
  }

  const starter = await db.user.findFirstOrThrow({ where: { id: reviewer.user.id } });
  const run = await startWorkflowRun(
    t,
    revision.id,
    template.id,
    { id: starter.id, name: starter.name, email: starter.email, role: starter.role } as never,
  );
  if (!run.ok) throw new Error(run.error);

  console.log(`Party ${party.name} now answers by proxy.`);
  console.log(`Route "${name}" published.`);
  console.log(`Started on ${revision.document.docNumber} rev ${revision.value}.`);
  console.log(`Open /documents/${revision.documentId} or /reviews to see it.`);
}

main()
  .catch((error) => { console.error(error); process.exit(1); })
  .finally(() => db.$disconnect());
