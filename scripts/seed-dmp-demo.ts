// Demo: the project's Document Management Plan in the register — where the
// published lists are recorded and approved — and the verdict list as the
// organization uses it: C1 Accepted · C2 Accepted with comments · C3 Rejected ·
// C4 For information only. Safe to re-run.
//
// Run after the demo seed: npx tsx scripts/seed-dmp-demo.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { registerDocument, startRevision } from "../src/lib/register";
import { tenantFor } from "../src/lib/tenant";
import type { SessionUser } from "../src/lib/auth";

const db = new PrismaClient();
const day = 86_400_000;
const ago = (n: number) => new Date(Date.now() - n * day);

const VERDICTS = [
  { code: "C1", label: "Accepted", props: { proceed: true, resubmit: false } },
  { code: "C2", label: "Accepted with comments", props: { proceed: true, resubmit: true } },
  { code: "C3", label: "Rejected — revise and resubmit", props: { proceed: false, resubmit: true } },
  { code: "C4", label: "For information only — no review needed", props: { proceed: true, resubmit: false } },
];

async function main() {
  const org = await db.organization.findFirstOrThrow({ where: { slug: "our-org" } });
  const project = await db.project.findFirstOrThrow({ where: { orgId: org.id, code: "P1001" } });
  const admin = await db.user.findFirstOrThrow({ where: { orgId: org.id, email: "admin@delios.local" } });
  const TITLE = "Project Document Management Plan";
  const t = tenantFor(org.id, project.id);
  const asUser = (u: typeof admin): SessionUser => ({ ...u, isInternal: true, partyCode: null } as unknown as SessionUser);

  let dmp = await db.document.findFirst({ where: { projectId: project.id, title: TITLE } });
  if (!dmp) {
    // Registered and revised the way the application does it, so the plan is
    // not itself a finding on the page that reports findings.
    const registered = await registerDocument(t, asUser(admin), {
      title: TITLE, deliverableType: "ENG", docType: "PLN", discipline: "GE",
      projectCode: "P1001", subProject: "00",
      criticality: "QUALITY", confidentiality: "INTERNAL",
      at: ago(45), how: "The project's own management plan.",
    });
    dmp = await db.document.findUniqueOrThrow({ where: { id: registered.id } });
    const rev = await startRevision(t, asUser(admin), dmp.id, {
      value: "A", statusCode: "IFI",
      reasonForRevision: "First issue — numbering, lists and review routes agreed at project start",
      at: ago(40),
    });
    // Releasing is refused without an approval recorded, so the plan carries one.
    await db.approval.create({
      data: {
        projectId: project.id, revisionId: rev.id, approverId: admin.id, approverName: admin.name,
        approverRole: "Document control", matrixVersion: 1, decidedAt: ago(31),
      },
    });
    await db.revision.update({
      where: { id: rev.id },
      data: {
        state: "RELEASED", releasedAt: ago(30), releasedById: admin.id, releasedByName: admin.name, issueDate: ago(30),
        changeDescription: "First issue — numbering, lists and review routes agreed at project start",
      },
    });
    // The verdict list as the organization uses it.
    for (const v of VERDICTS) {
      await db.configValue.updateMany({ where: { orgId: org.id, setKey: "REVIEW_OUTCOMES", code: v.code }, data: { label: v.label, props: JSON.stringify(v.props) } });
    }
  }
  console.log(`dmp demo: ${dmp.docNumber} rev A in the register; verdict list C1–C4 set`);
}

main().finally(() => db.$disconnect());
