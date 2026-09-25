// Review routes: the shapes people actually use, run through the real engine.
//   "Three specialists give input in parallel, any order — then their lead."
// and the rules behind it: Document Control can only send to people the
// distribution matrix names for that document, and a route has exactly one
// decision — its last step's binding verdict, which is the release approval.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { tenantFor } from "../src/lib/tenant";
import { startWorkflowRun, recordStepOutcome, getRunForRevision } from "../src/lib/workflow";
import type { SessionUser } from "../src/lib/auth";

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

  const person = async (email: string) => {
    const u = await db.user.findFirstOrThrow({ where: { orgId: org.id, email } });
    return { ...u, isInternal: true, partyCode: null } as unknown as SessionUser;
  };
  const [r1, r2, comm, lead, tech, admin] = await Promise.all([
    person("reviewer@delios.local"), person("reviewer2@delios.local"), person("commissioning@delios.local"),
    person("approver@delios.local"), person("tech.elec@delios.local"), person("admin@delios.local"),
  ]);

  const proceed = (await db.configValue.findMany({ where: { setKey: "REVIEW_OUTCOMES", status: "ACTIVE" } }))
    .map((v) => ({ code: v.code, props: v.props ? (JSON.parse(v.props) as { proceed?: boolean; resubmit?: boolean }) : {} }));
  const ok = proceed.find((v) => v.props.proceed === true && !v.props.resubmit)!;
  // A verdict that stops release; "approved with comments" proceeds.
  const back = proceed.find((v) => v.props.proceed === false)!;

  // Advice, from the advisory steps' own list: what the adviser's comments amount to.
  const adviceValues = (await db.configValue.findMany({ where: { setKey: "REVIEW_ADVICE", status: "ACTIVE" } }))
    .map((v) => ({ code: v.code, props: v.props ? (JSON.parse(v.props) as { comments?: string }) : {} }));
  const nothingToSay = adviceValues.find((v) => v.props.comments === "none")!;
  const blockingAdvice = adviceValues.find((v) => v.props.comments === "blocking")!;

  // What a proceeding verdict says the revision may be used for.
  const useFor = (await db.configValue.findFirstOrThrow({ where: { setKey: "STATUSES", status: "ACTIVE" } })).code;
  const stamp = Date.now().toString(36);
  const made: { docs: string[]; templates: string[] } = { docs: [], templates: [] };

  async function freshRevision(label: string) {
    const doc = await t.db.document.create({
      data: {
        projectId: p1.id, docNumber: `VERIFY-WF-${stamp}-${label}`, title: `Route check ${label}`, deliverableType: "ENG",
        docType: "CAL", discipline: "ME", criticality: "ROUTINE", confidentiality: "INTERNAL", state: "ACTIVE",
        createdById: admin.id, createdByName: admin.name,
      },
    });
    made.docs.push(doc.id);
    return t.db.revision.create({ data: { projectId: p1.id, documentId: doc.id, value: "A", state: "IN_PREPARATION" } });
  }
  async function template(name: string, steps: object[]) {
    const tpl = await t.db.workflowTemplate.create({ data: { orgId: org.id, name: `${name} ${stamp}`, classes: "*", steps: JSON.stringify(steps), active: true, isDefault: false } as never });
    made.templates.push(tpl.id);
    return tpl.id;
  }

  try {
    const parallelThenLead = await template("Three inputs then lead", [
      { act: "REVIEW", mode: "ALL", participantIds: [r1.id, r2.id, comm.id], days: 5 },
      { act: "REVIEW", mode: "ANY_OF", participantIds: [lead.id], days: 3 },
    ]);

    console.log("\nOnly the distribution matrix decides who can be sent a document\n");
    const offMatrix = await template("Includes a technician", [
      { act: "REVIEW", mode: "ALL", participantIds: [r1.id, tech.id] },
      { act: "REVIEW", mode: "ANY_OF", participantIds: [lead.id] },
    ]);
    const rev0 = await freshRevision("MATRIX");
    const refused = await startWorkflowRun(t, rev0.id, offMatrix, admin, [[r1.id, tech.id], [lead.id]]);
    check("choosing someone the matrix does not name is refused", !refused.ok && /distribution matrix/.test(refused.error), refused.ok ? "started" : refused.error);
    const rev0b = await freshRevision("MATRIX2");
    const trimmed = await startWorkflowRun(t, rev0b.id, offMatrix, admin);
    const trimmedRun = await getRunForRevision(t, rev0b.id);
    check("a template's default person the matrix does not allow is left out", trimmed.ok && !(trimmedRun?.steps[0].participantIds ?? []).includes(tech.id) && (trimmedRun?.steps[0].participantIds ?? []).includes(r1.id));

    console.log("\nA step can name functions; the matrix decides who\n");
    const reviewerFn = await db.function.findFirstOrThrow({ where: { orgId: org.id, code: "REVIEWER" } });
    const techFn = await db.function.findFirstOrThrow({ where: { orgId: org.id, code: "ELEC_TECH" } });
    const byFunction = await template("By function", [
      { act: "REVIEW", mode: "ALL", participantIds: [], functionIds: [reviewerFn.id, techFn.id] },
      { act: "REVIEW", mode: "ANY_OF", participantIds: [lead.id] },
    ]);
    const rev3 = await freshRevision("FN");
    const s3 = await startWorkflowRun(t, rev3.id, byFunction, admin);
    const run3 = await getRunForRevision(t, rev3.id);
    const chosen = new Set(run3?.steps[0].participantIds ?? []);
    check("function holders are proposed", s3.ok && chosen.has(r1.id) && chosen.has(r2.id), s3.ok ? `${chosen.size} people` : s3.error);
    check("a function the matrix does not allow proposes nobody", !chosen.has(tech.id));

    console.log("\nThree in parallel, any order, then their lead\n");
    const rev = await freshRevision("PAR");
    const started = await startWorkflowRun(t, rev.id, parallelThenLead, admin);
    check("route starts", started.ok, started.ok ? "" : started.error);
    const runId = started.ok ? started.runId : "";

    const verdictOnAdvice = await recordStepOutcome(t, runId, r2, ok.code, "no issue");
    check("an adviser cannot reach a verdict code", !verdictOnAdvice.ok, verdictOnAdvice.error ?? "recorded");
    const second = await recordStepOutcome(t, runId, r2, nothingToSay.code);
    check("any of the three may go first", second.ok, second.error ?? "");
    let run = await getRunForRevision(t, rev.id);
    check("step waits while others are outstanding", run?.currentStep === 0);
    const openCycle = await t.db.reviewCycle.findUniqueOrThrow({ where: { id: run?.steps[0].cycleId ?? "" } });
    check("a step with days carries a due date", !!openCycle.dueAt, openCycle.dueAt?.toDateString() ?? "none");
    await recordStepOutcome(t, runId, comm, nothingToSay.code);
    run = await getRunForRevision(t, rev.id);
    check("still waiting on the third", run?.currentStep === 0);
    // Advice has to match the comments: claiming a blocking comment without one is refused.
    const unsupported = await recordStepOutcome(t, runId, r1, blockingAdvice.code);
    check("advice cannot claim a blocking comment that does not exist", !unsupported.ok, unsupported.error ?? "recorded");
    const adviceCycleId = run?.steps[0].cycleId ?? "";
    await t.db.reviewComment.create({
      data: { projectId: p1.id, cycleId: adviceCycleId, authorId: r1.id, authorName: r1.name, text: "Load case is not stated.", classification: "BLOCKING", progressionPreventing: true },
    });
    const blocked = await recordStepOutcome(t, runId, r1, blockingAdvice.code);
    check("all three in — moves to the lead, even when one is blocking", blocked.ok && run?.currentStep === 0, blocked.error ?? "");
    run = await getRunForRevision(t, rev.id);
    check("the advisory step does not return the revision to its author", run?.currentStep === 1 && run?.status === "ACTIVE");
    const adviceCycle = await t.db.reviewCycle.findUniqueOrThrow({ where: { id: adviceCycleId } });
    check("and its custody stops at advice given", !!adviceCycle.returnedFromReviewAt && adviceCycle.returnedToOriginatorAt === null);

    const notLead = await recordStepOutcome(t, runId, r1, ok.code);
    check("only the lead decides the lead step", !notLead.ok);
    const decided = await recordStepOutcome(t, runId, lead, ok.code, "agreed", useFor);
    run = await getRunForRevision(t, rev.id);
    check("the lead's decision completes the route", decided.ok && run?.status === "DONE", decided.error ?? "");
    const approvals = await t.db.approval.findMany({ where: { revisionId: rev.id, withdrawnAt: null } });
    check("the binding verdict is the release approval, recorded once under the lead's name", approvals.length === 1 && approvals[0].approverId === lead.id, `${approvals.length} approval(s)`);
    const cycles = await t.db.reviewCycle.findMany({ where: { revisionId: rev.id }, orderBy: { sequence: "asc" } });
    check("the specialists' step is advice, the lead's step binds", cycles.length === 2 && !cycles[0].binding && cycles[1].binding);
    const decidedRev = await t.db.revision.findUniqueOrThrow({ where: { id: rev.id } });
    check("the verdict carries what it may be used for", decidedRev.proposedStatus === useFor, decidedRev.proposedStatus ?? "none");
    const noStatus = await recordStepOutcome(t, runId, lead, ok.code, "agreed");
    check("a verdict that proceeds without a status is refused", !noStatus.ok);

    console.log("\nOnly someone who may approve takes the deciding step\n");
    const reviewerDecides = await template("Reviewer decides", [{ act: "REVIEW", mode: "ANY_OF", participantIds: [r1.id] }]);
    const rev4 = await freshRevision("DECIDER");
    const s4 = await startWorkflowRun(t, rev4.id, reviewerDecides, admin, [[r1.id]]);
    check("a reviewer cannot be put on the deciding step", !s4.ok && /may not approve/.test(s4.error), s4.ok ? "started" : s4.error);

    console.log("\nA consolidated step: reviewers advise, the last person decides\n");
    const consolidated = await template("Consolidated", [{ act: "REVIEW", mode: "ALL_CONSOLIDATOR", participantIds: [r1.id, r2.id, lead.id] }]);
    const rev5 = await freshRevision("CONS");
    const s5 = await startWorkflowRun(t, rev5.id, consolidated, admin);
    check("reviewers may sit on the deciding step when only the consolidator binds", s5.ok, s5.ok ? "" : s5.error);
    const id5 = s5.ok ? s5.runId : "";
    // A consolidated step is the deciding step, so everyone on it answers from the verdict list.
    const in1 = await recordStepOutcome(t, id5, r1, ok.code, "fine");
    const in2 = await recordStepOutcome(t, id5, r2, ok.code, "fine");
    check("their verdicts are taken as input", in1.ok && in2.ok, in1.error ?? in2.error ?? "");
    check("and approve nothing", (await t.db.approval.count({ where: { revisionId: rev5.id } })) === 0);
    await recordStepOutcome(t, id5, lead, ok.code, "consolidated", useFor);
    const run5 = await getRunForRevision(t, rev5.id);
    const appr5 = await t.db.approval.findMany({ where: { revisionId: rev5.id } });
    check("the consolidator's verdict decides and is the approval", run5?.status === "DONE" && appr5.length === 1 && appr5[0].approverId === lead.id);

    console.log("\nWhen several decide together, the most severe verdict binds\n");
    const inputsOnly = await template("Deciders together", [{ act: "REVIEW", mode: "ALL", participantIds: [lead.id, admin.id] }]);
    const rev2 = await freshRevision("LAST");
    const s2 = await startWorkflowRun(t, rev2.id, inputsOnly, admin);
    const id2 = s2.ok ? s2.runId : "";
    check("deciders start", s2.ok, s2.ok ? "" : s2.error);
    await recordStepOutcome(t, id2, lead, ok.code, undefined, useFor);
    await recordStepOutcome(t, id2, admin, back.code, "rework section 3");
    const run2 = await getRunForRevision(t, rev2.id);
    check("one request for changes returns it to the author", run2?.status === "RETURNED", run2?.status);
    check("and nothing is approved", (await t.db.approval.count({ where: { revisionId: rev2.id } })) === 0);
  } finally {
    // Leave the register as it was.
    const revs = await db.revision.findMany({ where: { documentId: { in: made.docs } }, select: { id: true } });
    const revIds = revs.map((r) => r.id);
    const cycles = await db.reviewCycle.findMany({ where: { revisionId: { in: revIds } }, select: { id: true } });
    const cycleIds = cycles.map((c) => c.id);
    await db.reviewComment.deleteMany({ where: { cycleId: { in: cycleIds } } });
    await db.reviewAssignment.deleteMany({ where: { cycleId: { in: cycleIds } } });
    await db.reviewCycle.deleteMany({ where: { id: { in: cycleIds } } });
    await db.approval.deleteMany({ where: { revisionId: { in: revIds } } });
    await db.workflowRun.deleteMany({ where: { revisionId: { in: revIds } } });
    await db.documentSnapshot.deleteMany({ where: { documentId: { in: made.docs } } });
    await db.revision.deleteMany({ where: { id: { in: revIds } } });
    await db.document.deleteMany({ where: { id: { in: made.docs } } });
    await db.workflowTemplate.deleteMany({ where: { id: { in: made.templates } } });
    await db.auditEvent.deleteMany({ where: { entityLabel: { startsWith: `VERIFY-WF-${stamp}` } } });
    await db.notification.deleteMany({ where: { title: { contains: `VERIFY-WF-${stamp}` } } });
  }

  console.log(failures === 0 ? "\nAll workflow checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
