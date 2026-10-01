// Demo: a document sitting on the administrator's desk for the verdict.
//
// A draft (P1001-50-ME-CAL-09101 where the demo numbered it that way) is
// sent down a two-step route: Reviewer 1
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
const DOC = "P1001-50-ME-CAL-09101";

async function main() {
  const org = await db.organization.findFirstOrThrow({ where: { slug: "our-org" } });
  const project = await db.project.findFirstOrThrow({ where: { orgId: org.id, code: "P1001" } });
  const t = tenantFor(org.id, project.id);
  const person = async (email: string) => {
    const u = await db.user.findFirstOrThrow({ where: { orgId: org.id, email } });
    return { ...u, isInternal: true, partyCode: null } as unknown as SessionUser;
  };
  const admin = await person("admin@delios.local");
  const reviewer = await person("reviewer@delios.local");

  // The named document when the demo produced it; otherwise any draft waiting
  // to be sent, because numbering differs between installations.
  const doc =
    (await t.db.document.findFirst({ where: { docNumber: DOC, revisions: { some: { state: "IN_PREPARATION" } } }, include: { revisions: { orderBy: { createdAt: "desc" } } } })) ??
    (await t.db.document.findFirst({
      where: { revisions: { some: { state: "IN_PREPARATION", workflowRuns: { none: { status: "ACTIVE" } } } } },
      orderBy: { docNumber: "asc" },
      include: { revisions: { orderBy: { createdAt: "desc" } } },
    }));
  if (!doc) throw new Error("No document has a revision in preparation — run the demo seed first.");
  const rev = doc.revisions.find((r) => r.state === "IN_PREPARATION")!;
  if (await t.db.workflowRun.findFirst({ where: { revisionId: rev.id, status: "ACTIVE" } })) {
    console.log(`${doc.docNumber} rev ${rev.value} is already in review.`);
    return;
  }

  // A route will not start on nothing: the draft gets the demo's PDF first,
  // the way an author attaches a file before sending.
  if (!rev.renditionFileId && !rev.nativeFileId) {
    const pdf = await t.db.storedFile.findFirstOrThrow({ where: { mime: "application/pdf" }, orderBy: { createdAt: "asc" } });
    const file = await t.db.storedFile.create({
      data: { projectId: project.id, path: pdf.path, name: `${doc.docNumber}_Rev-${rev.value}.pdf`, size: pdf.size, mime: pdf.mime, sha256: pdf.sha256, kind: "RENDITION", revisionId: rev.id, uploadedById: admin.id, uploadedByName: admin.name },
    });
    await t.db.revision.update({ where: { id: rev.id }, data: { renditionFileId: file.id } });
  }

  const template = await t.db.workflowTemplate.findFirst({ where: { active: true, name: { contains: "Review then" } } })
    ?? (await t.db.workflowTemplate.findFirstOrThrow({ where: { active: true } }));
  const started = await startWorkflowRun(t, rev.id, template.id, admin, [[reviewer.id], [admin.id]]);
  if (!started.ok) throw new Error(started.error);

  // The reviewer's advice is in; the decision is the administrator's. An
  // earlier step advises, from the advice list — it never gives the verdict.
  const codes = await t.db.configValue.findMany({ where: { setKey: "REVIEW_ADVICE", status: "ACTIVE" } });
  const withComments = codes.find((v) => v.code === "COMMENTS") ?? codes[0];
  // Every step says what the revision is issued for, or confirms what it carries.
  const issuedFor = rev.statusCode ?? (await t.db.configValue.findFirstOrThrow({ where: { setKey: "STATUSES", status: "ACTIVE" }, orderBy: { sort: "asc" } })).code;
  const advice = await recordStepOutcome(t, started.runId, reviewer, withComments.code, "Duty point checked against the pump curve; note the margin on the discharge head.", issuedFor, !!rev.statusCode);
  if (!advice.ok) throw new Error(advice.error);

  console.log(`${doc.docNumber} rev ${rev.value}: Reviewer 1 advised ${withComments.code}. Sign in as admin@delios.local — the verdict is yours, on Home under "Give the verdict".`);
}

main().finally(() => db.$disconnect());
