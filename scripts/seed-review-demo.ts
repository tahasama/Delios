// Demo: a document sitting on the administrator's desk for the verdict.
//
// Q6637021-74-ME-CAL-09101 rev A is sent down a two-step route: Reviewer 1
// advises first (done here, with a comment), then the administrator decides.
// Sign in as admin@delios.local and it is waiting under "Give the verdict".
//
// Run after the demo seed: npx tsx scripts/seed-review-demo.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { tenantFor } from "../src/lib/tenant";
import { startWorkflowRun, recordStepOutcome } from "../src/lib/workflow";
import type { SessionUser } from "../src/lib/auth";

const db = new PrismaClient();
const DOC = "Q6637021-74-ME-CAL-09101";

async function main() {
  const org = await db.organization.findFirstOrThrow({ where: { slug: "our-org" } });
  const project = await db.project.findFirstOrThrow({ where: { orgId: org.id, code: "P1" } });
  const t = tenantFor(org.id, project.id);
  const person = async (email: string) => {
    const u = await db.user.findFirstOrThrow({ where: { orgId: org.id, email } });
    return { ...u, isInternal: true, partyCode: null } as unknown as SessionUser;
  };
  const admin = await person("admin@delios.local");
  const reviewer = await person("reviewer@delios.local");

  const doc = await t.db.document.findFirst({ where: { docNumber: DOC }, include: { revisions: { orderBy: { createdAt: "desc" } } } });
  if (!doc) throw new Error(`${DOC} is not in the register — run the demo seed first.`);
  const rev = doc.revisions.find((r) => r.state === "IN_PREPARATION") ?? doc.revisions[0];
  if (!rev) throw new Error(`${DOC} has no revision.`);
  if (rev.state !== "IN_PREPARATION") {
    console.log(`${DOC} rev ${rev.value} is ${rev.state.toLowerCase()} — nothing to send.`);
    return;
  }
  if (await t.db.workflowRun.findFirst({ where: { revisionId: rev.id, status: "ACTIVE" } })) {
    console.log(`${DOC} rev ${rev.value} is already in review.`);
    return;
  }

  const template = await t.db.workflowTemplate.findFirst({ where: { active: true, name: { contains: "Review then" } } })
    ?? (await t.db.workflowTemplate.findFirstOrThrow({ where: { active: true } }));
  const started = await startWorkflowRun(t, rev.id, template.id, admin, [[reviewer.id], [admin.id]]);
  if (!started.ok) throw new Error(started.error);

  // The reviewer's advice is in; the decision is the administrator's.
  const codes = await t.db.configValue.findMany({ where: { setKey: "REVIEW_OUTCOMES", status: "ACTIVE" } });
  const props = (v: { props: string | null }) => { try { return v.props ? JSON.parse(v.props) : {}; } catch { return {}; } };
  const withComments = codes.find((v) => props(v).proceed === true && props(v).resubmit === true) ?? codes[0];
  const advice = await recordStepOutcome(t, started.runId, reviewer, withComments.code, "Duty point checked against the pump curve; note the margin on the discharge head.");
  if (!advice.ok) throw new Error(advice.error);

  console.log(`${DOC} rev ${rev.value}: Reviewer 1 advised ${withComments.code}. Sign in as admin@delios.local — the verdict is yours, on Home under "Give the verdict".`);
}

main().finally(() => db.$disconnect());
