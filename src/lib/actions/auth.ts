"use server";

import { signInAction, signOutAction } from "./session";

export type LoginState = {
  error?: string;
  /** Present when the credentials match an account in more than one organization. */
  chooseOrg?: { slug: string; name: string }[];
  email?: string;
};

/**
 * Sign-in, through the backend: a person belongs to one organization, so the
 * email and password are all it needs. The backend checks the password and
 * every limit.
 */
export async function loginAction(_prev: LoginState | undefined, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email || !String(formData.get("password") ?? "")) return { error: "Email and password are required." };
  // Redirects on success.
  const state = await signInAction(undefined, formData);
  if (state.step) {
    // Two-step sign-in (a code from an authenticator app) has no place on this page yet.
    return { error: "This account uses two-step sign-in, which this page does not ask for yet.", email };
  }
  return { error: state.error, email };
}

export async function logoutAction() {
  await signOutAction();
}
