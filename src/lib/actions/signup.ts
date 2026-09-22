"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import { PROJECT_KINDS } from "@/lib/profiles/kinds";
import { publishReferenceConfiguration, publishFunctionCatalogue, functionForRole } from "@/lib/bootstrap";
import { STANDARD_VERSION } from "@/lib/standard";

export type SignupState = { error?: string; values?: Record<string, string> };

const RESERVED = new Set(["admin", "api", "login", "signup", "app", "www", "static", "public", "no-project"]);

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * The only self-service path into the system: registering an organization.
 *
 * It creates the organization, publishes the Annex C configuration it cannot
 * operate without (§1.3 — "not implemented until they are published"), opens a
 * first project, and makes the registrant its administrator. Every account
 * after this one is created by that administrator, inside this organization.
 */
export async function signupAction(_prev: SignupState | undefined, formData: FormData): Promise<SignupState> {
  const organizationName = String(formData.get("organizationName") ?? "").trim();
  const projectName = String(formData.get("projectName") ?? "").trim();
  const projectCode = String(formData.get("projectCode") ?? "").trim().toUpperCase();
  const projectKind = String(formData.get("projectKind") ?? "GENERIC");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const values = { organizationName, projectName, projectCode, projectKind, name, email };

  if (!organizationName) return { error: "Your organization needs a name.", values };
  if (!name || !email) return { error: "Your name and email are required.", values };
  if (password.length < 8) return { error: "The password must be at least 8 characters.", values };
  if (password !== confirm) return { error: "The two passwords do not match.", values };
  // The project is optional. An organization exists before its projects do,
  // and forcing a name for one at registration invents a project nobody has
  // decided on yet. Skip it and open the first one from the setup screen.
  const wantsProject = Boolean(projectName || projectCode);
  if (wantsProject) {
    if (!projectName) return { error: "Name the project, or clear its code to skip it for now.", values };
    if (!/^[A-Z0-9][A-Z0-9-]{0,15}$/.test(projectCode)) {
      return { error: "The project code should be short: letters, digits and hyphens, e.g. “P1” or “NORTH-2”.", values };
    }
    if (!PROJECT_KINDS.some((k) => k.code === projectKind)) {
      return { error: "Choose a project type.", values };
    }
  }

  // A stable, readable identifier for the organization.
  const base = slugify(organizationName) || "org";
  let slug = RESERVED.has(base) ? `${base}-org` : base;
  for (let n = 2; await db.organization.findUnique({ where: { slug } }); n++) {
    slug = `${base}-${n}`;
    if (n > 50) return { error: "Could not derive an identifier for that name — try a different one.", values };
  }

  const created = await db.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { slug, name: organizationName } });

    // The registrant's own organization, as a party (§0.3).
    const party = await tx.party.create({
      data: { orgId: org.id, code: "OUR-ORG", name: organizationName, isInternal: true },
    });

    const admin = await tx.user.create({
      data: {
        orgId: org.id,
        email,
        name,
        role: "ADMIN",
        partyId: party.id,
        passwordHash: await hashPassword(password),
        active: true,
      },
    });

    // The catalogue must exist before anyone can hold a function.
    await publishFunctionCatalogue(tx as unknown as typeof db, org.id);
    const adminFunction = await functionForRole(tx as unknown as typeof db, org.id, "ADMIN");
    if (!adminFunction) throw new Error("The Administrator function was not published.");

    // A project only if one was named. Without it the administrator lands on
    // the setup screen, where they can add people and open the first project
    // when they have actually decided on it.
    let projectId: string | null = null;
    if (wantsProject) {
      const project = await tx.project.create({
        data: { orgId: org.id, code: projectCode, name: projectName, kind: projectKind, startDate: new Date() },
      });
      projectId = project.id;
      await tx.projectMembership.create({
        data: { projectId: project.id, userId: admin.id, functionId: adminFunction.id },
      });
      // §1.6 — the scope statement the conformance figure is measured against.
      await tx.scopeConfig.create({
        data: {
          projectId: project.id,
          organizationName,
 scopeStatement: `All controlled information produced or received for ${projectName}, in any medium.`,
          assessmentLevel: "Core: identity and control",
          standardVersion: STANDARD_VERSION,
          effectiveDate: new Date(),
        },
      });
    }

    return { orgId: org.id, userId: admin.id, projectId };
  });

  // Outside the transaction: this writes a few hundred rows and must not hold
  // a write lock on SQLite while it does.
  await publishReferenceConfiguration(db, created.orgId, wantsProject ? projectKind : undefined);

  await createSession(created.userId);
  // With no project there is nothing for the dashboard to show.
  redirect(created.projectId ? "/" : "/setup");
}
