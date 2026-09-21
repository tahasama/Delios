// Run the Annex H check engine from the command line:
//   npm run checks                 → every active project
//   PROJECT=P1 npm run checks      → one project, by code
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { tenantFor } from "../src/lib/tenant";

const db = new PrismaClient();

async function main() {
  const only = process.env.PROJECT;
  const projects = await db.project.findMany({
    where: { status: "ACTIVE", ...(only ? { code: only } : {}) },
    orderBy: { code: "asc" },
  });
  if (!projects.length) throw new Error(only ? `No active project with code "${only}".` : "No active projects.");

  const { runAllChecks } = await import("../src/lib/checks/engine");

  // A conformance figure is about one project's register (§17.4), so each
  // project is measured separately and reports its own integrity.
  for (const project of projects) {
    // The control function or an administrator — whoever the organization has
    // put in that seat on this project (§17.5 attribution).
    const member = await db.projectMembership.findFirst({
      where: {
        projectId: project.id,
        active: true,
        function: { active: true, legacyRole: { in: ["CONTROLLER", "ADMIN"] } },
      },
      include: { user: { include: { party: true } }, function: true },
    });
    if (!member) {
      console.log(`· ${project.code} — skipped: no active controller or administrator.`);
      continue;
    }
    const { user } = member;
    const tenant = tenantFor(project.orgId, project.id);
    const res = await runAllChecks(tenant, {
      id: user.id,
      orgId: user.orgId,
      email: user.email,
      name: user.name,
      role: member.function.legacyRole as "CONTROLLER",
      organization: user.party?.name ?? user.organization,
      partyId: user.partyId,
      partyCode: user.party?.code ?? null,
      partyName: user.party?.name ?? user.organization,
      isInternal: user.party ? user.party.isInternal : true,
    });
    console.log(`· ${project.code} — integrity ${res.integrity}% · coverage ${res.coverage}% · ${res.failed} failing checks · run ${res.runId}`);
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
