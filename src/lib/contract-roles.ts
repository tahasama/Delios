import { getActiveSet } from "./config";
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

export async function contractRoleOptions(_db?: unknown, _orgId?: string): Promise<RoleOption[]> {
  const published = await getActiveSet("CONTRACT_ROLES").catch(() => []);
  if (!published.length) {
    return CONTRACT_ROLES.map((r) => ({ code: r.code, label: r.label, approval: r.approval, description: r.description }));
  }
  return published.map((value) => {
    const props = value.props as { approval?: unknown; description?: unknown };
    const builtIn = CONTRACT_ROLES.find((r) => r.code === value.code);
    return {
      code: value.code,
      label: value.label || builtIn?.label || value.code,
      approval: typeof props.approval === "string" ? props.approval : builtIn?.approval ?? "",
      description: typeof props.description === "string" ? props.description : builtIn?.description ?? "",
    };
  });
}

export async function isContractRole(_db: unknown, _orgId: string, code: string): Promise<boolean> {
  return (await contractRoleOptions()).some((r) => r.code === code);
}
