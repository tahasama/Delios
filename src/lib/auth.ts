import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { db } from "./db";
import type { Role } from "./standard";
import { ROLE_RANK } from "./standard";

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
};

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    const uid = payload.uid as string;
    const user = await db.user.findUnique({ where: { id: uid }, include: { party: true } });
    if (!user || !user.active) return null;
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

export async function requireRole(roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/?denied=1");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/?denied=1");
  return user;
}

export function atLeast(user: SessionUser | null, role: Role): boolean {
  if (!user) return false;
  return ROLE_RANK[user.role] >= ROLE_RANK[role];
}

export function isController(user: SessionUser | null): boolean {
  return !!user && (user.role === "CONTROLLER" || user.role === "ADMIN");
}

export function isAdmin(user: SessionUser | null): boolean {
  return !!user && user.role === "ADMIN";
}

export function mayCreateDocument(user: SessionUser | null): boolean {
  return !!user && user.role !== "VIEWER" && user.isInternal;
}

export function mayContributeToDocument(user: SessionUser | null, document: { originator: string | null; createdById: string }): boolean {
  if (!user || user.role === "VIEWER") return false;
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
