import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { publishReferenceConfiguration, functionForRole } from "../src/lib/bootstrap";
import { STANDARD_VERSION } from "../src/lib/standard";

/**
 * A second organization, so multi-tenancy is testable by default rather than
 * something you have to construct by hand.
 *
 * It is built the way signup builds one — own configuration, own parties, own
 * people, own projects — and it deliberately reuses `admin@delios.local` with a
 * *different* password. That single fact is the proof that a login belongs to
 * an organization rather than to the installation.
 */
export async function seedSecondOrganization(db: PrismaClient) {
  const existing = await db.organization.findUnique({ where: { slug: "northwind" } });
  if (existing) {
    console.log("· Second organization already present — skipping.");
    return;
  }

  const org = await db.organization.create({
    data: { slug: "northwind", name: "Northwind Engineering" },
  });
  await publishReferenceConfiguration(db, org.id);

  const party = await db.party.create({
    data: { orgId: org.id, code: "OUR-ORG", name: "Northwind Engineering", isInternal: true },
  });
  await db.party.create({
    data: { orgId: org.id, code: "SUB", name: "Coastal Subsea Ltd", isInternal: false },
  });

  const projects = await Promise.all([
    db.project.create({
      data: { orgId: org.id, code: "NW-1", name: "Offshore substation", kind: "ENERGY", startDate: new Date() },
    }),
    db.project.create({
      data: { orgId: org.id, code: "NW-2", name: "Cable landfall works", kind: "CONSTRUCTION", startDate: new Date() },
    }),
  ]);

  for (const project of projects) {
    await db.scopeConfig.create({
      data: {
        projectId: project.id,
        organizationName: org.name,
        scopeStatement: `All controlled information produced or received for ${project.name}, in any medium.`,
        assessmentLevel: "Core: identity and control",
        standardVersion: STANDARD_VERSION,
        effectiveDate: new Date(),
      },
    });
  }

  // Same address as the other organization's administrator, different password.
  const people = [
    { email: "admin@delios.local", name: "Northwind Administrator", role: "ADMIN", password: "northwind1234", projects: ["NW-1", "NW-2"] },
    { email: "controller@northwind.local", name: "Northwind Document Control", role: "CONTROLLER", password: "northwind1234", projects: ["NW-1", "NW-2"] },
    { email: "engineer@northwind.local", name: "Cable Engineer", role: "AUTHOR", password: "northwind1234", projects: ["NW-1"] },
  ];

  for (const person of people) {
    const user = await db.user.create({
      data: {
        orgId: org.id,
        email: person.email,
        name: person.name,
        role: person.role,
        partyId: party.id,
        passwordHash: await bcrypt.hash(person.password, 10),
        active: true,
      },
    });
    const fn = await functionForRole(db, org.id, person.role);
    if (!fn) throw new Error(`No function published for role ${person.role}.`);
    for (const code of person.projects) {
      const project = projects.find((p) => p.code === code)!;
      await db.projectMembership.create({
        data: { projectId: project.id, userId: user.id, functionId: fn.id },
      });
    }
  }

  console.log(`· Second organization seeded: ${org.name} — projects NW-1/NW-2, admin@delios.local · northwind1234.`);
}
