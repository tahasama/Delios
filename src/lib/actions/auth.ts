"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession } from "@/lib/auth";
import { apiFetch, problemOf } from "@/lib/api/client";

export type LoginState = {
  error?: string;
  /** Present when the credentials match an account in more than one organization. */
  chooseOrg?: { slug: string; name: string }[];
  email?: string;
  /** Two-step sign-in: the code is asked next. MFA_SETUP when the organization requires it and it is not set up yet. */
  mfa?: { step: "MFA_CODE" | "MFA_SETUP"; challenge: string; secret?: string; uri?: string };
  /** Shown once, after two-step sign-in is set up: the codes that sign in without the app. */
  recoveryCodes?: string[];
  next?: string;
};

/** The session the backend started, from its cookie. */
function sessionOf(response: Response): string | undefined {
  return response.headers.getSetCookie().find((c) => c.startsWith("delios_session="))?.slice("delios_session=".length).split(";")[0];
}

/** The second step: the code from the authenticator app (or a recovery code), or the first one when setting it up. */
async function secondStep(formData: FormData, next: string): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const challenge = String(formData.get("challenge") ?? "");
  const step = formData.get("step") === "MFA_SETUP" ? "MFA_SETUP" : "MFA_CODE";
  const secret = String(formData.get("secret") ?? "") || undefined;
  const uri = String(formData.get("uri") ?? "") || undefined;
  const code = String(formData.get("code") ?? "").replace(/\s+/g, "");
  const again: LoginState = { email, mfa: { step, challenge, secret, uri } };
  if (!code) return { ...again, error: "Type the code your authenticator app shows." };
  let response: Response;
  try {
    response = await apiFetch(step === "MFA_SETUP" ? "/api/auth/mfa/confirm" : "/api/auth/mfa", { method: "POST", body: { challenge, code } });
  } catch {
    return { ...again, error: "The server does not answer. Try again in a moment." };
  }
  if (!response.ok) {
    const problem = await problemOf(response);
    // An expired challenge starts again from the password.
    if (problem.code === "MFA_CHALLENGE_INVALID") return { email, error: "That took too long. Sign in again." };
    return { ...again, error: problem.message };
  }
  const token = sessionOf(response);
  if (!token) return { email, error: "The server did not start a session. Sign in again." };
  await createSession(token);
  if (step === "MFA_SETUP") {
    // Shown this once: they are the way back in without the app.
    const body = (await response.json().catch(() => ({}))) as { recoveryCodes?: string[] };
    return { recoveryCodes: body.recoveryCodes ?? [], next };
  }
  redirect(next);
}

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
  const wanted = String(formData.get("next") ?? "/");
  const next = wanted.startsWith("/") && !wanted.startsWith("//") ? wanted : "/";
  if (formData.get("challenge")) return secondStep(formData, next);
  if (!email || !password) return { error: "Email and password are required." };

  // The backend checks the password, the lockout and every limit, and records
  // the sign-in. A person belongs to one organization, so the email says which.
  let response: Response;
  try {
    response = await apiFetch("/api/auth/sign-in", { method: "POST", body: { email, password } });
  } catch {
    return { error: "The server does not answer. Try again in a moment.", email };
  }
  if (!response.ok) {
    const problem = await problemOf(response);
    return { error: problem.code === "SIGN_IN_FAILED" ? "Those credentials do not match an active account." : problem.message, email };
  }
  const token = sessionOf(response);
  if (!token) {
    // Two-step sign-in: the code from an authenticator app is asked next.
    const step = (await response.json().catch(() => null)) as { next?: string; challenge?: string } | null;
    if (!step?.challenge) return { error: "The server did not start a session. Try again.", email };
    if (step.next === "MFA_SETUP") {
      const setup = await apiFetch("/api/auth/mfa/setup", { method: "POST", body: { challenge: step.challenge } }).catch(() => null);
      if (!setup?.ok) return { error: setup ? (await problemOf(setup)).message : "The server does not answer. Try again in a moment.", email };
      const { secret, uri } = (await setup.json()) as { secret: string; uri: string };
      return { email, mfa: { step: "MFA_SETUP", challenge: step.challenge, secret, uri } };
    }
    return { email, mfa: { step: "MFA_CODE", challenge: step.challenge } };
  }
  await createSession(token);

  redirect(next);
}

export async function logoutAction() {
  await apiFetch("/api/auth/sign-out", { method: "POST" }).catch(() => undefined);
  await destroySession();
  redirect("/login");
}
