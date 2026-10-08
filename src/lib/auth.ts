import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { getMe } from "./api/me";
import type { Role } from "./standard";
import { heldVerbs } from "./permissions";

const COOKIE = "edms_session";
const secret = new TextEncoder().encode(process.env.SESSION_SECRET ?? "dev-secret");

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

/** Keeps the backend's session token in the browser's session cookie. */
export async function createSession(token: string) {
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export type SessionUser = {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: Role;
  organization: string | null;
  partyId: string | null;
  partyCode: string | null;
  partyName: string | null;
  isInternal: boolean;
  /** Verbs the function held on the current project grants anywhere in the matrix. Set by the scope. */
  verbs?: string[];
  /** The function held on the current project — the person's job, e.g. "Construction manager". */
  functionName?: string | null;
  /** The department this person answers for on the current project. */
  department?: string | null;
};

const ORG_VERBS = ["PLAN", "ROUTES", "MATRIX"];

/** Does this person hold `verb` anywhere on the current project? */
export function hasVerb(user: SessionUser | null | undefined, verb: string): boolean {
  if (!user) return false;
  const held = heldVerbs(user);
  return held.includes(verb) || (ORG_VERBS.includes(verb) && held.includes("CONFIGURE"));
}

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  // The backend holds the session; a revoked party or a switched-off account ends it there.
  const me = await getMe();
  if (!me) return null;
  return {
    id: me.user.id,
    orgId: me.tenant.slug,
    email: me.user.email,
    name: me.user.name,
    role: (me.user.isAdmin ? "ADMIN" : "VIEWER") as Role,
    organization: me.user.party?.name ?? me.tenant.name,
    partyId: me.user.party?.code ?? null,
    partyCode: me.user.party?.code ?? null,
    partyName: me.user.party?.name ?? me.tenant.name,
    isInternal: me.user.party ? me.user.party.isInternal : true,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** The verb each old role name stood for, so `requireRole` reads the matrix. */
const ROLE_VERB: Record<Role, string> = {
  VIEWER: "READ",
  AUTHOR: "CREATE",
  REVIEWER: "REVIEW",
  APPROVER: "APPROVE",
  CONTROLLER: "CONTROL",
  ADMIN: "CONFIGURE",
};

export async function requireRole(roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.some((r) => hasVerb(user, ROLE_VERB[r]))) redirect("/?denied=1");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasVerb(user, "CONFIGURE")) redirect("/?denied=1");
  return user;
}

/** Holds the verb the named role stood for. */
export function atLeast(user: SessionUser | null, role: Role): boolean {
  return hasVerb(user, ROLE_VERB[role]);
}

/** The control function: Control, or Configure. */
export function isController(user: SessionUser | null): boolean {
  // Configuring a project is not working in it. An administrator sets the app
  // up and leaves; whether anybody stands between the work and the record is
  // the project's answer, given by granting the control function to somebody or
  // to no one. An administrator who is also the control function holds the verb
  // like anybody else.
  return hasVerb(user, "CONTROL");
}

/** An administrator: publishes configuration, people and the matrix. */
export function isAdmin(user: SessionUser | null): boolean {
  return hasVerb(user, "CONFIGURE");
}

/** Contributes nothing: may only read. */
export function isReadOnly(user: SessionUser | null): boolean {
  return !["CREATE", "REVISE", "REVIEW", "APPROVE", "CONTROL", "CONFIGURE"].some((v) => hasVerb(user, v));
}

export function mayCreateDocument(user: SessionUser | null): boolean {
  return !!user && hasVerb(user, "CREATE") && user.isInternal;
}

export function mayContributeToDocument(user: SessionUser | null, document: { originator: string | null; createdById: string }): boolean {
  if (!user || !(hasVerb(user, "CREATE") || hasVerb(user, "REVISE"))) return false;
  if (user.isInternal) return true;
  return !!user.partyCode && document.originator === user.partyCode;
}

// Route handler variant (returns null instead of redirecting)
export async function getSessionUser(): Promise<SessionUser | null> {
  return getCurrentUser();
}

/** The session is the backend's: a token is good when the backend says who it belongs to. */
export async function verifySessionToken(token: string): Promise<string | null> {
  return token ? (await getCurrentUser())?.id ?? null : null;
}

export const SESSION_COOKIE = COOKIE;
