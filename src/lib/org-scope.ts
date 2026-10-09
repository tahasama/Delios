import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin, type SessionUser } from "./auth";
import { getMe } from "./api/me";

/**
 * An organization exists before its projects do. Someone who has just
 * registered one has no membership anywhere, so `requireScope()` — which is
 * built around an active project — has nothing to give them.
 *
 * This is the surface for that moment: organization-level only. Value sets,
 * functions, people and the project list all live at organization level, so
 * they are all reachable here. Nothing in a register is, because there is no
 * register yet.
 */

/**
 * A project id that matches no row. The scoped client still narrows every
 * project-scoped read, so an organization-level session sees an empty register
 * rather than everybody's.
 */
const NO_PROJECT = "__no_project__";

export type OrgScope = {
  user: SessionUser;
  orgId: string;
  organization: { id: string; slug: string; name: string };
  /** How many active projects exist — zero is the whole reason to be here. */
  projectCount: number;
};

export const getOrgScope = cache(async (): Promise<OrgScope | null> => {
  const user = await getCurrentUser();
  const me = await getMe();
  if (!user || !me) return null;
  return {
    user,
    orgId: user.orgId,
    organization: { id: user.orgId, slug: me.tenant.slug, name: me.tenant.name },
    projectCount: me.projects.filter((p) => p.status === "ACTIVE").length,
  };
});

/**
 * Setting an organization up is an administrator's job, and only for their own
 * organization. A guest from elsewhere never reaches this.
 */
export async function requireOrgAdmin(): Promise<OrgScope> {
  const scope = await getOrgScope();
  if (!scope) redirect("/login");
  if (!isAdmin(scope.user)) redirect("/?denied=1");
  return scope;
}

export { NO_PROJECT };
