import type { PrismaClient } from "@prisma/client";
import { CONTRACT_ROLES } from "./profiles/roles";

/**
 * The contract roles this organization offers.
 *
 * The seven the app ships are published as a value set like everything else, so
 * an administrator adds a role the same way they add a discipline — with its own
 * definition, and with its rows written in the matrix afterwards. Only the seven
 * carry a starting matrix; anything added starts empty, which is honest: the app
 * has no opinion about a role it has never heard of.
 *
 * Where the set has not been published yet, the built-in list stands in, so a
 * project can always be opened.
 */
export type RoleOption = { code: string; label: string; approval: string; description: string };

export async function contractRoleOptions(db: PrismaClient, orgId: string): Promise<RoleOption[]> {
  const published = await db.configValue.findMany({
    where: { orgId, setKey: "CONTRACT_ROLES", status: "ACTIVE" },
    orderBy: [{ sort: "asc" }, { code: "asc" }],
    select: { code: true, label: true, props: true },
  });
  if (!published.length) {
    return CONTRACT_ROLES.map((r) => ({ code: r.code, label: r.label, approval: r.approval, description: r.description }));
  }
  return published.map((value) => {
    let props: { approval?: unknown; description?: unknown } = {};
    if (value.props) {
      try { props = JSON.parse(value.props) as typeof props; } catch { /* a malformed prop is simply absent */ }
    }
    const builtIn = CONTRACT_ROLES.find((r) => r.code === value.code);
    return {
      code: value.code,
      label: value.label || builtIn?.label || value.code,
      approval: typeof props.approval === "string" ? props.approval : builtIn?.approval ?? "",
      description: typeof props.description === "string" ? props.description : builtIn?.description ?? "",
    };
  });
}

/** Whether this code is a role the organization offers. */
export async function isContractRole(db: PrismaClient, orgId: string, code: string): Promise<boolean> {
  return (await contractRoleOptions(db, orgId)).some((r) => r.code === code);
}
