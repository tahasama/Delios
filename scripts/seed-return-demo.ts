/**
 * Three worked examples of a revision that does not go straight through, so the
 * difference between them can be seen side by side:
 *
 *   1. **Rejected** — the deciding step asks for changes. The route still ends
 *      at the control function, which cannot release it and sends it back to
 *      its author. The revision is Returned: kept, never released, replaced by
 *      the next one.
 *   2. **The route went wrong, found at the gate** — the decision was final,
 *      but the control function sees the wrong file was reviewed and sends the
 *      same revision back to step 1, with a published reason. It runs again
 *      from there.
 *   3. **The route went wrong, found by a reviewer** — the person holding the
 *      open step sees it first and sends it back themselves, which is the only
 *      thing they can do that is not answering on a document they know is wrong.
 *
 * It leaves all three mid-story so each can be finished by hand.
 *
 *   npx tsx scripts/seed-return-demo.ts
 */
import { PrismaClient } from "@prisma/client";
import { tenantFor } from "../src/lib/tenant";
import { startWorkflowRun, recordStepOutcome, type WfStep } from "../src/lib/workflow";

const db = new PrismaClient();

async function main() {
  const project = await db.project.findFirst({ orderBy: { createdAt: "asc" } });
  if (!project) throw new Error("No project.");
  const t = tenantFor(project.orgId, project.id);

  const seat = await db.projectMembership.findFirst({
    where: { projectId: project.id, active: true },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  });
  if (!seat) throw new Error("No people on the project.");
  const who = seat.user as never;

  const steps: WfStep[] = [
    { act: "REVIEW", mode: "ALL", participantIds: [seat.user.id], title: "Discipline check", days: 5 },
    { act: "REVIEW", mode: "ALL", participantIds: [seat.user.id], title: "Lead reads it", days: 5 },
    { act: "APPROVAL", mode: "ANY_OF", participantIds: [seat.user.id], title: "Decision", days: 5 },
  ];
  const name = "Engineering drawings — lead engineer decides";
  const held = await db.workflowTemplate.findFirst({ where: { orgId: project.orgId, name } });
  const template = held
    ? await db.workflowTemplate.update({ where: { id: held.id }, data: { steps: JSON.stringify(steps), active: true } })
    : await db.workflowTemplate.create({
        data: {
          orgId: project.orgId,
          id: `return-demo-${Date.now().toString(36)}`,
          name,
          description: "A discipline check, then the lead reads it, then the lead decides.",
          classes: "*",
          steps: JSON.stringify(steps),
          outcomeSetKey: "REVIEW_OUTCOMES",
          createdByName: "Example",
        },
      });

  const statuses = await db.configValue.findMany({ where: { setKey: "STATUSES", status: "ACTIVE" }, orderBy: { sort: "asc" } });
  const issuedFor = statuses.find((one) => one.code === "IFC")?.code ?? statuses[0]?.code;
  if (!issuedFor) throw new Error("No published statuses.");

  const outcomes = await db.configValue.findMany({ where: { setKey: "REVIEW_OUTCOMES", status: "ACTIVE" } });
  const parse = (one: (typeof outcomes)[number]) => { try { return JSON.parse(one.props ?? "{}") as { proceed?: boolean; resubmit?: boolean }; } catch { return {}; } };
  const advice = await db.configValue.findFirst({ where: { setKey: "REVIEW_ADVICE", code: "NO_COMMENT", status: "ACTIVE" } });
  const accepted = outcomes.find((one) => parse(one).proceed === true && parse(one).resubmit !== true);
  const rejected = outcomes.find((one) => parse(one).proceed !== true);
  if (!advice || !accepted || !rejected) throw new Error("Publish an advice code, an accepting verdict and a returning one first.");

  /** A document with nothing in motion, and a fresh revision on it. */
  async function freshRevision(why: string) {
    // A real engineering document with nothing in motion. The verification
    // scripts leave documents of their own behind (VFY-…); an example told with
    // those reads as nonsense, which defeats the point of an example.
    const document = await db.document.findFirst({
      where: {
        projectId: project!.id,
        deliverableType: "ENG",
        isPlaceholder: false,
        NOT: { docNumber: { startsWith: "VFY-" } },
        revisions: { none: { state: { in: ["IN_PREPARATION", "IN_REVIEW", "NOT_RELEASED"] } } },
      },
      include: { revisions: { orderBy: { createdAt: "desc" } } },
      orderBy: { docNumber: "asc" },
    });
    if (!document) throw new Error("No engineering document is free — every one already has a revision in motion.");
    const used = new Set(document.revisions.map((one) => one.value));
    const value = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((letter) => !used.has(letter)) ?? `A${document.revisions.length}`;
    return db.revision.create({
      data: {
        projectId: project!.id,
        documentId: document.id,
        value,
        series: "DESIGN",
        state: "IN_PREPARATION",
        reasonForRevision: why,
        changeDescription: why,
        authoredById: seat!.user.id,
        authoredByName: seat!.user.name,
        uploadedById: seat!.user.id,
        uploadedByName: seat!.user.name,
      },
      include: { document: true },
    });
  }

  /** Answer the step that is open, with the code and the words given. */
  async function answer(runId: string, code: string, words: string) {
    const res = await recordStepOutcome(t, runId, who, code, words, issuedFor, true);
    if (!res.ok) throw new Error(res.error);
  }

  // ── 1 · Rejected: it ends at the control function, which cannot release it ──
  const one = await freshRevision("Example: the decision asks for changes");
  const runOne = await startWorkflowRun(t, one.id, template.id, who);
  if (!runOne.ok) throw new Error(runOne.error);
  await answer(runOne.runId, advice.code, "Read it against the discipline checklist. Nothing to raise.");
  await answer(runOne.runId, advice.code, "Read it. Nothing to raise.");
  await answer(runOne.runId, rejected.code, "The pump duty on the schedule does not match the calculation. Correct both and resubmit.");
  console.log(`1 · ${one.document.docNumber} rev ${one.value} — decided ${rejected.code}. Open it: the release button is gone, and Send it back is open. Send it to its author; the revision becomes Returned.`);

  // ── 2 · The route went wrong, and the gate finds it ─────────────────────────
  const two = await freshRevision("Example: the wrong file was reviewed");
  const runTwo = await startWorkflowRun(t, two.id, template.id, who);
  if (!runTwo.ok) throw new Error(runTwo.error);
  await answer(runTwo.runId, advice.code, "Checked against the discipline standards. Nothing to raise.");
  await answer(runTwo.runId, advice.code, "Read it. Agreed.");
  await answer(runTwo.runId, accepted.code, "Accepted as it stands.");
  console.log(`2 · ${two.document.docNumber} rev ${two.value} — decided ${accepted.code}, waiting to be released. Open it and choose Send it back → "1. Discipline check": it asks for a published reason, and the route runs again from step 1.`);

  // ── 3 · The route went wrong, and the reviewer finds it ─────────────────────
  const three = await freshRevision("Example: the reviewer finds it first");
  const runThree = await startWorkflowRun(t, three.id, template.id, who);
  if (!runThree.ok) throw new Error(runThree.error);
  await answer(runThree.runId, advice.code, "Checked. Nothing to raise.");
  const openStep = (await db.workflowRun.findUniqueOrThrow({ where: { id: runThree.runId } }));
  const openCycle = (JSON.parse(openStep.steps) as { cycleId?: string }[])[openStep.currentStep]?.cycleId;
  console.log(`3 · ${three.document.docNumber} rev ${three.value} — step 2 is open. Go to /reviews/${openCycle} : the card "Something is wrong with the route" lets you send it back to step 1 without answering.`);
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); })
  .finally(() => db.$disconnect());
