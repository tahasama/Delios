import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser, atLeast, type SessionUser } from "./auth";
import type { Role } from "./standard";
import { can, verbsFor, explain, type Actor, type Verb, type DocumentClass } from "./permissions";
import { api, forgetShortLived } from "./api/client";
import { getMe } from "./api/me";

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
  /** What this organization is contracted to do on it. */
  role: string;
  status: string;
};

/**
 * The data used to come from a Prisma client narrowed to the scope. It comes
 * from the backend now, through `api()` in `src/lib/api/client.ts`; this marks
 * every place that still reaches for the old client.
 */
export type RemovedDb = { readonly movedToBackend: true };

export type Scope = {
  orgId: string;
  projectId: string;
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
  db: RemovedDb;
  /** May the signed-in person do this, here? */
  can: (verb: Verb, target?: DocumentClass | null) => boolean;
  /** §5.7 — is this confidentiality within their clearance? */
  /** Every verb they hold against a class, for explaining the screen. */
  verbs: (target?: DocumentClass | null) => Verb[];
  /** Why a decision went the way it did, in the Standard's words. */
  why: (verb: Verb, target?: DocumentClass | null) => string;
};

/** The old role name a function's verbs amount to, for the few screens that still speak in roles. */
function legacyRoleOf(verbs: string[]): Role {
  if (verbs.includes("CONFIGURE")) return "ADMIN" as Role;
  if (verbs.includes("CONTROL")) return "CONTROLLER" as Role;
  if (verbs.includes("APPROVE")) return "APPROVER" as Role;
  if (verbs.includes("REVIEW")) return "REVIEWER" as Role;
  if (verbs.includes("CREATE") || verbs.includes("REVISE")) return "AUTHOR" as Role;
  return "VIEWER" as Role;
}

/**
 * Resolve the scope for the current request, from the backend. Returns null
 * when there is no session, or when the user holds no active membership in any
 * project.
 */
export const getScope = cache(async (): Promise<Scope | null> => {
  const [me, user] = await Promise.all([getMe(), getCurrentUser()]);
  if (!me || !user || me.projects.length === 0) return null;

  const jar = await cookies();
  const wanted = jar.get(PROJECT_COOKIE)?.value;
  const chosen = me.projects.find((p) => p.id === wanted) ?? me.projects[0];
  const summary = (p: (typeof me.projects)[number]): ProjectSummary =>
    ({ id: p.id, orgId: me.tenant.slug, code: p.code, name: p.name, kind: p.kind ?? "GENERIC", role: p.contractRole, status: p.status });
  const available = me.projects.map(summary);
  // An administrator may open any project their organization runs, whether or not they were put on it: joining
  // happens on the switch, so there is still exactly one way to be in a project — a membership.
  if (await configures(me)) {
    const held = new Set(available.map((p) => p.id));
    const rest = (await organizationProjects()).filter((p) => p.status === "ACTIVE" && !held.has(p.id));
    available.push(...rest.map((p): ProjectSummary => ({ id: p.id, orgId: me.tenant.slug, code: p.code, name: p.name, kind: p.kind ?? "GENERIC", role: p.contractRole, status: p.status })));
    available.sort((a, b) => a.code.localeCompare(b.code));
  }

  // Confidentiality levels, as this organization published them.
  const values = await api<Record<string, { code: string; props: Record<string, unknown> | null }[]>>("/api/values", { query: { sets: "CONFIDENTIALITY" } })
    .catch(() => ({} as Record<string, { code: string; props: Record<string, unknown> | null }[]>));
  const levels = new Map<string, number>();
  for (const value of values.CONFIDENTIALITY ?? []) if (typeof value.props?.level === "number") levels.set(value.code, value.props.level);

  // An older backend sends the function's verbs without its rules: read them as one rule for everything.
  const rules = chosen.rules ?? [{
    deliverableType: null, docType: null, discipline: null, criticality: null, confidentiality: null, projectRole: null, verbs: chosen.verbs ?? [],
  }];
  const verbs = [...new Set(rules.flatMap((r) => r.verbs))];
  const actor: Actor = {
    functionId: chosen.function.id,
    functionCode: chosen.function.code,
    functionName: chosen.function.name,
    // The most confidential level read without being named, as its place in the published list; no limit reads past all.
    clearance: chosen.function.clearance
      ? Math.max(0, (values.CONFIDENTIALITY ?? []).findIndex((one) => one.code === chosen.function.clearance))
      : Number.MAX_SAFE_INTEGER,
    legacyRole: legacyRoleOf(verbs),
    levels,
    projectRole: chosen.contractRole,
    rules: rules.map((r) => ({
      deliverableType: r.deliverableType, docType: r.docType, discipline: r.discipline, criticality: r.criticality,
      confidentiality: r.confidentiality, projectRole: r.projectRole, family: null, familyTypes: null, verbs: r.verbs as Verb[],
    })),
  };
  const role = actor.legacyRole as Role;
  const held = [...new Set(actor.rules.filter((r) => r.projectRole === null || r.projectRole === chosen.contractRole).flatMap((r) => r.verbs))];
  return {
    user: { ...user, role, verbs: held, functionName: actor.functionName, department: chosen.department ?? null },
    orgId: me.tenant.slug,
    projectId: chosen.id,
    project: summary(chosen),
    actor,
    role,
    available,
    isGuest: false,
    db: { movedToBackend: true },
    can: (verb, target) => can(actor, verb, target),
    verbs: (target) => verbsFor(actor, target),
    why: (verb, target) => explain(actor, verb, target),
  };
});

export async function requireScope(): Promise<Scope> {
  const scope = await getScope();
  if (!scope) {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    redirect("/no-project");
  }
  return scope;
}

/**
 * A section that belongs to our own organization — the matrix, assurance,
 * reports, tags, settings. Someone from another organization never reaches it,
 * whatever link they follow.
 */
export async function requireInternalScope(): Promise<Scope> {
  const scope = await requireScope();
  if (!scope.user.isInternal) notFound();
  return scope;
}

export async function requireScopeRole(roles: Role[]): Promise<Scope> {
  const scope = await requireScope();
  if (!roles.some((r) => atLeast(scope.user, r))) redirect("/?denied=1");
  return scope;
}

/** Configure — the administrator's verb, read from the matrix. */
export async function requireAdminScope(): Promise<Scope> {
  const scope = await requireScope();
  if (!scope.can("CONFIGURE")) redirect("/?denied=1");
  return scope;
}

/**
 * The access lists the control function keeps day to day: functions, people,
 * parties, numbering, routes. It may not touch an administrator's own function,
 * which is checked where the change is made, not here.
 */
export async function requireAccessScope(): Promise<Scope> {
  const scope = await requireScope();
  if (!scope.can("CONFIGURE") && !scope.can("CONTROL")) redirect("/?denied=1");
  return scope;
}

// ── Project switching ────────────────────────────────────────────────────────

/** Whether this person administers the organization: flagged so, or holding Configure through a function somewhere. */
async function configures(me: NonNullable<Awaited<ReturnType<typeof getMe>>>): Promise<boolean> {
  return me.user.isAdmin || me.projects.some((p) => (p.rules ?? []).some((r) => r.verbs.includes("CONFIGURE")) || (p.verbs ?? []).includes("CONFIGURE"));
}

/** The organization's projects, as an administrator sees them. */
const organizationProjects = cache(async () =>
  api<{ id: string; code: string; name: string; contractRole: string; kind?: string; status: string }[]>("/api/admin/projects").catch(() => []));

export async function setActiveProject(projectId: string, _userId: string) {
  // Only a project the backend says this person is on; an administrator joins one they are not on.
  const me = await getMe();
  if (!me) return false;
  if (!me.projects.some((p) => p.id === projectId)) {
    if (!(await configures(me)) || !(await organizationProjects()).some((p) => p.id === projectId)) return false;
    try {
      await api(`/api/admin/projects/${projectId}/join`, { body: {} });
    } catch {
      return false;
    }
    await forgetShortLived();
  }
  const jar = await cookies();
  jar.set(PROJECT_COOKIE, projectId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return true;
}
