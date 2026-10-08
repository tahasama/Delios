"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession } from "@/lib/auth";
import { apiFetch, problemOf } from "@/lib/api/client";

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
  const next = String(formData.get("next") ?? "/");
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
  const token = response.headers.getSetCookie().find((c) => c.startsWith("delios_session="))?.slice("delios_session=".length).split(";")[0];
  if (!token) {
    // A code from an authenticator app is asked next, and this page has no place for it.
    return { error: "This account uses two-step sign-in, which this page does not ask for yet.", email };
  }
  await createSession(token);

  redirect(next.startsWith("/") ? next : "/");
}

export async function logoutAction() {
  await apiFetch("/api/auth/sign-out", { method: "POST" }).catch(() => undefined);
  await destroySession();
  redirect("/login");
}
