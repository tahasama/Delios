import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { db } from "./db";
import type { Role } from "./standard";

const COOKIE = "edms_session";
const secret = new TextEncoder().encode(process.env.SESSION_SECRET ?? "dev-secret");

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string) {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
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

/**
 * Before a project is chosen there is no function to read, so the account's
 * standing role stands in. Everywhere inside a project the matrix decides.
 */
const ROLE_FALLBACK: Record<Role, string[]> = {
  ADMIN: ["READ", "CREATE", "REVISE", "REVIEW", "APPROVE", "TRANSMIT", "RECEIVE", "ACCEPT", "CONTROL", "CONFIGURE"],
  CONTROLLER: ["READ", "CREATE", "REVISE", "TRANSMIT", "RECEIVE", "ACCEPT", "CONTROL"],
  APPROVER: ["READ", "REVIEW", "APPROVE", "RECEIVE"],
  REVIEWER: ["READ", "REVIEW", "RECEIVE"],
  AUTHOR: ["READ", "CREATE", "REVISE", "RECEIVE"],
  VIEWER: ["READ"],
};

const ORG_VERBS = ["PLAN", "ROUTES", "MATRIX"];

/** Does this person hold `verb` anywhere on the current project? */
export function hasVerb(user: SessionUser | null | undefined, verb: string): boolean {
  if (!user) return false;
  const held = user.verbs ?? ROLE_FALLBACK[user.role] ?? [];
  return held.includes(verb) || (ORG_VERBS.includes(verb) && held.includes("CONFIGURE"));
}

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    const uid = payload.uid as string;
    const user = await db.user.findUnique({ where: { id: uid }, include: { party: true } });
    // A revoked party ends an open session too, not just the next sign-in.
    if (!user || !user.active || (user.party && !user.party.active)) return null;
    return {
      id: user.id,
      orgId: user.orgId,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      organization: user.party?.name ?? user.organization,
      partyId: user.partyId,
      partyCode: user.party?.code ?? null,
      partyName: user.party?.name ?? user.organization,
      isInternal: user.party ? user.party.isInternal : true,
    };
  } catch {
    return null;
  }
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

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return (payload.uid as string) ?? null;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = COOKIE;
