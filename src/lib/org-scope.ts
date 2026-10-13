import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin, type SessionUser } from "./auth";
import { getMe } from "./api/me";
type OrgScope = {
  user: SessionUser;
  orgId: string;
  organization: { id: string; slug: string; name: string };
  /** How many active projects exist — zero is the whole reason to be here. */
  projectCount: number;
};

const getOrgScope = cache(async (): Promise<OrgScope | null> => {
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

;
