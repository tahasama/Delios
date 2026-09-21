import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { getCurrentUser, type SessionUser } from "./auth";
import type { Role } from "./standard";
import { scopedClient, type ScopedDb, type Tenant } from "./tenant";
import { loadActor, can, canSee, verbsFor, explain, visibleConfidentiality, type Actor, type Verb, type DocumentClass } from "./permissions";

export { scopedClient, tenantFor, ORG_SCOPED, PROJECT_SCOPED } from "./tenant";
export type { ScopedDb, Tenant } from "./tenant";

/**
 * The scope is the request-bound tenancy: who is signed in, which project they
 * are looking at, and a Prisma client already narrowed to it. Application code
 * reaches the register through `scope.db` and nothing else.
 */

// ── Resolving the active project ─────────────────────────────────────────────

export const PROJECT_COOKIE = "edms_project";

export type ProjectSummary = {
  id: string;
  orgId: string;
  code: string;
  name: string;
  kind: string;
  status: string;
};

export type Scope = Tenant & {
  user: SessionUser;
  project: ProjectSummary;
  /**
   * The function held on this project, with its rules and clearance. This is
   * the authority; `role` below is its legacy name.
   */
  actor: Actor;
  /** The user's role *in this project*, derived from their function. */
  role: Role;
  /** Every project this user may switch to, for the project picker. */
  available: ProjectSummary[];
  /** True when the signed-in person's account lives in another organization. */
  isGuest: boolean;
  db: ScopedDb;
  /** May the signed-in person do this, here? */
  can: (verb: Verb, target?: DocumentClass | null) => boolean;
  /** §5.7 — is this confidentiality within their clearance? */
  canSee: (confidentiality: string | null | undefined) => boolean;
  /** Every verb they hold against a class, for explaining the screen. */
  verbs: (target?: DocumentClass | null) => Verb[];
  /** Why a decision went the way it did, in the Standard's words. */
  why: (verb: Verb, target?: DocumentClass | null) => string;
};

const SUMMARY = { id: true, orgId: true, code: true, name: true, kind: true, status: true } as const;

/**
 * Resolve the scope for the current request. Returns null when there is no
 * session, or when the user holds no active membership in any project.
 */
export const getScope = cache(async (): Promise<Scope | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const memberships = await db.projectMembership.findMany({
    where: { userId: user.id, active: true, project: { status: "ACTIVE" } },
    include: { project: { select: SUMMARY }, function: true },
    orderBy: { project: { code: "asc" } },
  });
  if (memberships.length === 0) return null;

  const available = memberships.map((m) => m.project);
  const jar = await cookies();
  const wanted = jar.get(PROJECT_COOKIE)?.value;
  const chosen = memberships.find((m) => m.projectId === wanted) ?? memberships[0];

  // The organization axis comes from the *project*, not the person. Someone
  // from another company invited onto this project works inside this
  // organization's published configuration — its value sets, its numbering, its
  // permission matrix — which is the only reading that makes sense. Their own
  // organization is where their account lives, not where they are working.
  const hostOrgId = chosen.project.orgId;

  // Two clients, deliberately. The first is used only to read the function and
  // the published confidentiality levels; the second is the one application
  // code gets, and it already knows what this reader is cleared to see.
  const bootstrap: Tenant = {
    orgId: hostOrgId,
    projectId: chosen.projectId,
    db: scopedClient(hostOrgId, chosen.projectId),
  };

  // A membership always names a function, and a function the organization has
  // retired leaves its holders with no authority rather than with the last
  // authority they happened to have.
  const actor = await loadActor(bootstrap, chosen.functionId);
  if (!actor) return null;

  const allCodes = await bootstrap.db.configValue.findMany({
    where: { setKey: "CONFIDENTIALITY" },
    select: { code: true },
  });
  const allowed = visibleConfidentiality(actor, allCodes.map((c) => c.code));
  const scoped = scopedClient(hostOrgId, chosen.projectId, allowed);

  // Authority is held per project, not globally: the same person may author on
  // one project and control another (§1.4 — ownership is by role).
  const role = actor.legacyRole as Role;

  return {
    user: { ...user, role },
    orgId: hostOrgId,
    projectId: chosen.projectId,
    project: chosen.project,
    actor,
    role,
    available,
    isGuest: user.orgId !== hostOrgId,
    db: scoped,
    can: (verb, target) => can(actor, verb, target),
    canSee: (confidentiality) => canSee(actor, confidentiality),
    verbs: (target) => verbsFor(actor, target),
    why: (verb, target) => explain(actor, verb, target),
  };
});

export async function requireScope(): Promise<Scope> {
  const scope = await getScope();
  if (!scope) {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    // An administrator whose organization has no project yet is not stuck —
    // they are simply earlier in the process than this screen assumes.
    if (user.role === "ADMIN") {
      const projects = await db.project.count({ where: { orgId: user.orgId, status: "ACTIVE" } });
      if (projects === 0) redirect("/setup");
    }
    redirect("/no-project");
  }
  return scope;
}

export async function requireScopeRole(roles: Role[]): Promise<Scope> {
  const scope = await requireScope();
  if (!roles.includes(scope.role)) redirect("/?denied=1");
  return scope;
}

export async function requireAdminScope(): Promise<Scope> {
  const scope = await requireScope();
  if (scope.role !== "ADMIN") redirect("/?denied=1");
  return scope;
}

/**
 * Deliberate escape hatch for the few surfaces that are genuinely cross-project
 * (org administration, the project picker itself, login). Every call site is
 * meant to be reviewable: `grep -rn crossProject src`.
 */
export function crossProject(): typeof db {
  return db;
}


// ── Project switching ────────────────────────────────────────────────────────

export async function setActiveProject(projectId: string, userId: string) {
  const membership = await db.projectMembership.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
  if (!membership || !membership.active) return false;
  const jar = await cookies();
  jar.set(PROJECT_COOKIE, projectId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return true;
}



