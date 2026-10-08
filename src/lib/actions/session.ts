"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiFetch, problemOf, SESSION_COOKIE } from "@/lib/api/client";
import type { SignInStep } from "@/lib/api/types";
import { PROJECT_COOKIE } from "@/lib/session";
import { isMigrated } from "@/lib/migrated";

/**
 * Signing in and out, through the backend. The backend checks the password,
 * the two-step code and every limit; these actions only carry the answer back
 * and keep the session cookie in the browser.
 */

export type SignInState = {
  error?: string;
  email?: string;
  /** Set when the password was right and a code is needed next. */
  step?: SignInStep;
  /** For setting up two-step sign-in: the key to enter in the authenticator app. */
  setup?: { secret: string; uri: string };
  /** Shown once, after two-step sign-in is set up. */
  recoveryCodes?: string[];
  next?: string;
};

/** Only same-site paths (or ?next becomes an open redirect), and only to a screen that is working. */
function safeNext(raw: FormDataEntryValue | null): string {
  const next = typeof raw === "string" ? raw : "/";
  return next.startsWith("/") && !next.startsWith("//") && isMigrated(next.split("?")[0]) ? next : "/";
}

/** Keeps the backend's session token in a cookie the browser sends back to this site. */
async function keepSession(response: Response): Promise<boolean> {
  const set = response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  const token = set?.slice(SESSION_COOKIE.length + 1).split(";")[0];
  if (!token) return false;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    // The backend decides how long a session lasts; the cookie only has to outlive it.
    maxAge: 60 * 60 * 24 * 30,
  });
  return true;
}

/**
 * Step one: email and password. A person belongs to one organization, so the
 * email says which.
 */
export async function signInAction(_prev: SignInState | undefined, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim();
  const next = safeNext(form.get("next"));
  let response: Response;
  try {
    response = await apiFetch("/api/auth/sign-in", { method: "POST", body: { email, password: String(form.get("password") ?? "") } });
  } catch {
    return { error: `The server does not answer at ${process.env.DELIOS_API_URL ?? "http://localhost:8080"}. Is the backend running?`, email, next };
  }
  if (!response.ok) return { error: (await problemOf(response)).message, email, next };
  if (await keepSession(response)) redirect(next);
  const step = (await response.json()) as SignInStep;
  if (step.next === "MFA_SETUP") {
    const setup = await apiFetch("/api/auth/mfa/setup", { method: "POST", body: { challenge: step.challenge } });
    if (!setup.ok) return { error: (await problemOf(setup)).message, email, next };
    return { step, setup: await setup.json(), email, next };
  }
  return { step, email, next };
}

/** Step two: the code from the authenticator app (or a recovery code), or the first code when setting it up. */
export async function codeAction(prev: SignInState | undefined, form: FormData): Promise<SignInState> {
  const step = prev?.step;
  if (!step) return { error: "Start again with your password." };
  const code = String(form.get("code") ?? "").trim();
  const path = step.next === "MFA_SETUP" ? "/api/auth/mfa/confirm" : "/api/auth/mfa";
  const response = await apiFetch(path, { method: "POST", body: { challenge: step.challenge, code } });
  if (!response.ok) return { ...prev, error: (await problemOf(response)).message, recoveryCodes: undefined };
  await keepSession(response);
  if (step.next === "MFA_SETUP") {
    // Shown once: the page keeps them on screen until the person continues.
    const { recoveryCodes } = (await response.json()) as { recoveryCodes: string[] };
    return { recoveryCodes, next: prev.next };
  }
  redirect(prev.next ?? "/");
}

/** Ends the session on the backend (on every server) and clears the cookie here. */
export async function signOutAction(): Promise<void> {
  await apiFetch("/api/auth/sign-out", { method: "POST" }).catch(() => undefined);
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(PROJECT_COOKIE);
  redirect("/login");
}

/** Remembers which project the person is working in. */
export async function switchProjectAction(form: FormData): Promise<void> {
  const id = String(form.get("projectId") ?? "");
  (await cookies()).set(PROJECT_COOKIE, id, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect("/");
}
