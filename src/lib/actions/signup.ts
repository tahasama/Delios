"use server";

import { redirect } from "next/navigation";
import { createSession } from "@/lib/auth";
import { apiFetch, problemOf } from "@/lib/api/client";
import { PROJECT_KINDS } from "@/lib/profiles/kinds";
import { CONTRACT_ROLES } from "@/lib/profiles/roles";  // signup predates the organization, so the built-in list is all there is

export type SignupState = { error?: string; values?: Record<string, string> };

/**
 * The only self-service path into the system: registering an organization.
 *
 * It creates the organization, publishes the Annex C configuration it cannot
 * operate without (§1.3 — "not implemented until they are published"), opens a
 * first project, and makes the registrant its administrator. Every account
 * after this one is created by that administrator, inside this organization.
 */
export async function signupAction(_prev: SignupState | undefined, formData: FormData): Promise<SignupState> {
  const organizationName = String(formData.get("organizationName") ?? "").trim();
  const projectName = String(formData.get("projectName") ?? "").trim();
  const projectCode = String(formData.get("projectCode") ?? "").trim().toUpperCase();
  const projectKind = String(formData.get("projectKind") ?? "GENERIC");
  const projectRole = String(formData.get("projectRole") ?? "GENERIC");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const values = { organizationName, projectName, projectCode, projectKind, projectRole, name, email };

  if (!organizationName) return { error: "Your organization needs a name.", values };
  if (!name || !email) return { error: "Your name and email are required.", values };
  if (password.length < 8) return { error: "The password must be at least 8 characters.", values };
  if (password !== confirm) return { error: "The two passwords do not match.", values };
  // The project is optional. An organization exists before its projects do,
  // and forcing a name for one at registration invents a project nobody has
  // decided on yet. Skip it and open the first one from the setup screen.
  const wantsProject = Boolean(projectName || projectCode);
  if (wantsProject) {
    if (!projectName) return { error: "Name the project, or clear its code to skip it for now.", values };
    if (!/^[A-Z0-9][A-Z0-9-]{0,15}$/.test(projectCode)) {
      return { error: "The project code should be short: letters, digits and hyphens, e.g. “P1” or “NORTH-2”.", values };
    }
    if (!CONTRACT_ROLES.some((r) => r.code === projectRole)) {
      return { error: "Choose what your organization does on this project.", values };
    }
    if (!PROJECT_KINDS.some((k) => k.code === projectKind)) {
      return { error: "Choose a project type.", values };
    }
  }

  // The backend creates the organization with the recommended configuration,
  // opens the project if one was named, and signs the administrator in.
  let response: Response;
  try {
    response = await apiFetch("/api/auth/sign-up", {
      method: "POST",
      body: {
        organizationName, name, email, password,
        projectCode: wantsProject ? projectCode : null, projectName: wantsProject ? projectName : null, contractRole: wantsProject ? projectRole : null,
      },
    });
  } catch {
    return { error: "The server does not answer. Try again in a moment.", values };
  }
  if (!response.ok) {
    if (response.status === 404) return { error: "Registering an organization is switched off here. Ask the people who run this system.", values };
    return { error: (await problemOf(response)).message, values };
  }
  const token = response.headers.getSetCookie().find((c) => c.startsWith("delios_session="))?.slice("delios_session=".length).split(";")[0];
  if (!token) redirect("/login");
  await createSession(token);
  // With no project there is nothing for the dashboard to show.
  redirect(wantsProject ? "/" : "/setup");
}
