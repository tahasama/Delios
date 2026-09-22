// Demo: the project's Document Management Plan, linked to the published lists.
// Rev A of the DMP was released 30 days ago; the review verdict list was then
// changed to C1 Accepted · C2 Accepted with comments · C3 Rejected · C4 For
// information only — so the lists page and Assurance remind you to revise the
// DMP. Safe to re-run.
//
// Run after the demo seed: npx tsx scripts/seed-dmp-demo.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

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
  const project = await db.project.findFirstOrThrow({ where: { orgId: org.id, code: "P1" } });
  const admin = await db.user.findFirstOrThrow({ where: { orgId: org.id, email: "admin@delios.local" } });
  const docNumber = "Q6637021-00-GE-PLN-00001";

  let dmp = await db.document.findFirst({ where: { projectId: project.id, docNumber } });
  if (!dmp) {
    dmp = await db.document.create({
      data: {
        projectId: project.id, docNumber, title: "Project Document Management Plan", deliverableType: "ENG", docType: "PLN", discipline: "GE",
        criticality: "QUALITY", confidentiality: "INTERNAL", state: "ACTIVE", createdById: admin.id, createdByName: admin.name, createdDate: ago(45),
      },
    });
    await db.revision.create({
      data: {
        projectId: project.id, documentId: dmp.id, value: "A", state: "RELEASED", statusCode: "IFI", createdAt: ago(40),
        releasedAt: ago(30), releasedById: admin.id, releasedByName: admin.name, issueDate: ago(30),
        changeDescription: "First issue — numbering, lists and review routes agreed at project start",
      },
    });
    // The lists as agreed in rev A: nothing changed after its release…
    await db.configValue.updateMany({ where: { orgId: org.id }, data: { updatedAt: ago(35) } });
    // …until the verdict list was reworded.
    for (const v of VERDICTS) {
      await db.configValue.updateMany({ where: { orgId: org.id, setKey: "REVIEW_OUTCOMES", code: v.code }, data: { label: v.label, props: JSON.stringify(v.props) } });
    }
  }
  const scope = await db.scopeConfig.findFirst({ where: { projectId: project.id } });
  if (scope && !scope.dmpDocumentId) await db.scopeConfig.update({ where: { id: scope.id }, data: { dmpDocumentId: dmp.id } });
  console.log(`dmp demo: ${docNumber} rev A released 30 days ago; the verdict list changed since`);
}

main().finally(() => db.$disconnect());
