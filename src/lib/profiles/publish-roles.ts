import type { PrismaClient } from "@prisma/client";
import { ROLE_FUNCTIONS, roleFor } from "./roles";

/**
 * Publish a contract role's starting matrix for an organization.
 *
 * Like the function catalogue, this seeds and never rewrites: a row the
 * organization has already published for this role is left exactly as it is.
 * So opening a second PMC project adds nothing, and a matrix corrected through
 * its review route is never undone by opening another project.
 *
 * The rules it writes carry `projectRole`, so they apply only on projects of
 * that role. An organization running EPC and PMC work keeps one matrix.
 */
export async function publishRoleMatrix(
  db: PrismaClient,
  orgId: string,
  roleCode: string,
): Promise<{ functions: number; rules: number }> {
  const role = roleFor(roleCode);
  if (!role || !role.matrix.length) return { functions: 0, rules: 0 };

  // The outside functions the role matrices name. They are created without any
  // rule of their own: everything they may do comes from the rows below, so a
  // design office on a PMC project never silently inherits a blanket grant.
  let functions = 0;
  for (const def of ROLE_FUNCTIONS) {
    const existing = await db.function.findUnique({ where: { orgId_code: { orgId, code: def.code } } });
    if (existing) continue;
    await db.function.create({
      data: {
        orgId,
        code: def.code,
        name: def.name,
        description: def.description,
        clearance: def.clearance,
        legacyRole: def.legacyRole,
        sort: def.sort,
      },
    });
    functions++;
  }

  const byCode = new Map(
    (await db.function.findMany({ where: { orgId } })).map((f) => [f.code, f.id] as const),
  );

  let rules = 0;
  for (let i = 0; i < role.matrix.length; i++) {
    const row = role.matrix[i];
    const functionId = byCode.get(row.functionCode);
    if (!functionId) continue;
    const where = {
      functionId,
      projectRole: role.code,
      deliverableType: row.deliverableType ?? null,
      docType: row.docType ?? null,
    };
    if (await db.permissionRule.findFirst({ where })) continue;
    await db.permissionRule.create({
      data: {
        orgId,
        functionId,
        projectRole: role.code,
        deliverableType: row.deliverableType ?? null,
        docType: row.docType ?? null,
        verbs: JSON.stringify(row.verbs),
        note: `${role.label} starting matrix — ${row.note}`,
        sort: 100 + i,
      },
    });
    rules++;
  }

  return { functions, rules };
}

/** Whether this organization already holds any row for a contract role. */
export async function roleMatrixPublished(db: PrismaClient, orgId: string, roleCode: string): Promise<boolean> {
  return Boolean(await db.permissionRule.findFirst({ where: { orgId, projectRole: roleCode } }));
}
