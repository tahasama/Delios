"use server";

import { redirect } from "next/navigation";
import { createSession, deviceId } from "@/lib/core/auth";
import { apiFetch, problemOf } from "@/lib/client";

type SignupState = {
  error?: string; values?: Record<string, string>; confirmEmail?: string;
  /** The email is a guest account another organization made: it may be taken into their own DELIOS. */
  guest?: { host: string; organization: string };
  /** Made with a guest account: their organization is ready; they sign in as usual, at home. */
  ready?: { organization: string; host: string };
};

/**
 * The only self-service path into the system: registering an organization.
 *
 * It creates the organization, publishes the Annex C configuration it cannot
 * operate without (§1.3 — "not implemented until they are published"), and
 * makes the registrant its administrator; projects are opened from inside. Every account
 * after this one is created by that administrator, inside this organization.
 */
export async function signupAction(_prev: SignupState | undefined, formData: FormData): Promise<SignupState> {
  const organizationName = String(formData.get("organizationName") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const values = { organizationName, name, email };
  const takeGuestAccount = formData.get("takeGuestAccount") === "1";
  const guest = takeGuestAccount ? { host: String(formData.get("guestHost") ?? ""), organization: String(formData.get("guestOrganization") ?? "") } : undefined;

  if (!organizationName) return { error: "Your organization needs a name.", values };
  const acceptTerms = formData.get("acceptTerms") === "on";
  if (!acceptTerms) return { error: "Accept the terms of service and the data processing agreement to register your organization.", values, guest };
  if (!name || !email) return { error: "Your name and email are required.", values };
  if (!takeGuestAccount) {
    if (password.length < 8) return { error: "A password has at least 8 characters.", values };
    if (password !== confirm) return { error: "The two passwords do not match.", values };
  } else if (!password) return { error: `Give the password of your account at ${guest?.host}.`, values, guest };
  // The backend creates the organization with the recommended configuration and signs the administrator in.
  // Projects are opened afterwards, from inside (the setup screen first).
  let response: Response;
  try {
    response = await apiFetch("/api/auth/sign-up", {
      method: "POST",
      device: await deviceId(),
      body: {
        organizationName, name, email, password, takeGuestAccount, acceptTerms, turnstile: String(formData.get("cf-turnstile-response") ?? "") || undefined,
      },
    });
  } catch {
    return { error: "The server does not answer. Try again in a moment.", values };
  }
  if (!response.ok) {
    if (response.status === 404) return { error: "Registering an organization is switched off here. Ask the people who run this system.", values };
    const problem = await problemOf(response);
    // Their email is a guest account: offer to take it along, the organization's name filled in.
    if (problem.code === "GUEST_ACCOUNT") {
      const said = (problem.params ?? {}) as { host?: string; organization?: string };
      return { guest: { host: said.host ?? "", organization: said.organization ?? "" }, values: { ...values, organizationName: organizationName || (said.organization ?? "") } };
    }
    return { error: problem.message, values, guest };
  }
  if (response.status === 202) {
    const next = (await response.json().catch(() => ({}))) as { next?: string; organization?: string; host?: string };
    if (next.next === "SIGN_IN") return { ready: { organization: next.organization ?? organizationName, host: next.host ?? "" } };
    return { confirmEmail: email };
  }
  const token = response.headers.getSetCookie().find((c) => c.startsWith("delios_session="))?.slice("delios_session=".length).split(";")[0];
  if (!token) redirect("/login");
  await createSession(token);
  // An organization starts with no project: the setup screen opens the first.
  redirect("/setup");
}
