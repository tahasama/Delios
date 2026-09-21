"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, destroySession, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { tenantFor } from "@/lib/tenant";

export type LoginState = {
  error?: string;
  /** Present when the credentials match an account in more than one organization. */
  chooseOrg?: { slug: string; name: string }[];
  email?: string;
};

/**
 * An account belongs to an organization, so the same address may hold accounts
 * in several of them. Authentication therefore resolves (organization, email)
 * rather than email alone.
 *
 * The organization field is optional. We verify the password against every
 * candidate account and only then decide:
 *   no match   → one generic failure, revealing nothing
 *   one match  → signed in
 *   several    → ask which organization; the person has already proved they
 *                hold both accounts, so naming them leaks nothing
 */
export async function loginAction(_prev: LoginState | undefined, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const orgSlug = String(formData.get("org") ?? "").trim().toLowerCase();
  const next = String(formData.get("next") ?? "/");
  if (!email || !password) return { error: "Email and password are required." };

  const candidates = await db.user.findMany({
    where: {
      email,
      active: true,
      org: { active: true, ...(orgSlug ? { slug: orgSlug } : {}) },
      // Someone whose company's access was revoked cannot sign in.
      OR: [{ partyId: null }, { party: { active: true } }],
    },
    include: { party: true, org: true },
  });

  const matched = [];
  for (const candidate of candidates) {
    if (await verifyPassword(password, candidate.passwordHash)) matched.push(candidate);
  }

  if (matched.length === 0) {
    // Same message whether the address is unknown, the password is wrong, or
    // the account is in another organization.
    return { error: "Those credentials do not match an active account.", email };
  }

  if (matched.length > 1) {
    return {
      error: "That address has an account in more than one organization — choose which to sign in to.",
      chooseOrg: matched.map((m) => ({ slug: m.org.slug, name: m.org.name })),
      email,
    };
  }

  const user = matched[0];
  await createSession(user.id);

  // A login is an event in the organization, but audit rows live on a project,
  // so it is recorded against the project the person is about to land in.
  const membership = await db.projectMembership.findFirst({
    where: { userId: user.id, active: true, project: { status: "ACTIVE" } },
    orderBy: { project: { code: "asc" } },
  });
  if (membership) {
    await audit({
      tenant: tenantFor(user.orgId, membership.projectId),
      actor: {
        id: user.id,
        orgId: user.orgId,
        email: user.email,
        name: user.name,
        role: user.role as never,
        organization: user.party?.name ?? user.organization,
        partyId: user.partyId,
        partyCode: user.party?.code ?? null,
        partyName: user.party?.name ?? user.organization,
        isInternal: user.party ? user.party.isInternal : true,
      },
      action: "LOGIN",
      detail: `Signed in to ${user.org.name}.`,
    });
  }

  redirect(next.startsWith("/") ? next : "/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
