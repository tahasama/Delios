"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { api, refusal } from "@/lib/client";

type State = { error?: string; ok?: string };

/** The organization asks everyone for two-step sign-in, or stops asking. Administrators only (the backend checks). */
export async function setMfaRequiredAction(_prev: State | undefined, formData: FormData): Promise<State> {
  await requireScope();
  const required = formData.get("required") === "on";
  try {
    await api("/api/admin/security", { method: "PUT", body: { mfaRequired: required } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/security");
  return { ok: required ? "Everyone sets up two-step sign-in at their next sign-in." : "Two-step sign-in is each person's choice again." };
}

/**
 * The organization's own sign-in provider (single sign-on, OpenID Connect): its name on the button, its address, the
 * client id and secret the provider gave, the email domains it signs in, and whether it is used. The secret is asked the
 * first time and kept encrypted; left empty later, the one kept stays. Administrators only (the backend checks).
 */
export async function setSsoAction(_prev: State | undefined, formData: FormData): Promise<State> {
  await requireScope();
  const text = (name: string) => String(formData.get(name) ?? "").trim();
  try {
    await api("/api/admin/security/sso", {
      method: "PUT",
      body: {
        name: text("name"), authority: text("authority"), clientId: text("clientId"), clientSecret: text("clientSecret") || null,
        allowedDomains: text("domains").split(/[\s,;]+/).filter(Boolean), enabled: formData.get("enabled") === "on",
      },
    });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/security");
  return { ok: formData.get("enabled") === "on" ? "Saved: people may sign in with the organization's account." : "Saved, not in use: everyone signs in with a password." };
}

/** Password sign-in on, or for administrators only once everyone signs in through the organization's provider. */
export async function setPasswordSignInAction(_prev: State | undefined, formData: FormData): Promise<State> {
  await requireScope();
  const on = formData.get("passwordSignIn") === "on";
  try {
    await api("/api/admin/security", { method: "PUT", body: { passwordSignIn: on } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/security");
  return { ok: on ? "Everyone may sign in with a password." : "Only administrators sign in with a password; everyone else through the organization's account." };
}

/** Turns someone's two-step sign-in off, for a lost phone: they set it up again at their next sign-in if it is required. */
export async function resetMfaAction(_prev: State | undefined, formData: FormData): Promise<State> {
  await requireScope();
  const userId = String(formData.get("userId") ?? "");
  try {
    await api(`/api/admin/users/${userId}/mfa/reset`, { body: {} });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/security");
  return { ok: "Two-step sign-in is off for them. They can set it up again." };
}

export type MySetup = State & { secret?: string; uri?: string; recoveryCodes?: string[]; done?: boolean };

/** Your own two-step sign-in, step by step: a new key, then a code from it, which turns it on and shows the recovery codes once. */
export async function myMfaAction(_prev: MySetup | undefined, formData: FormData): Promise<MySetup> {
  await requireScope();
  const step = String(formData.get("step") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  try {
    if (step === "start") {
      const setup = await api<{ secret: string; uri: string }>("/api/me/mfa/setup", { body: {} });
      return { secret: setup.secret, uri: setup.uri };
    }
    if (step === "confirm") {
      const secret = String(formData.get("secret") ?? "");
      const uri = String(formData.get("uri") ?? "");
      try {
        const confirmed = await api<{ recoveryCodes: string[] }>("/api/me/mfa/confirm", { body: { code } });
        revalidatePath("/account");
        return { recoveryCodes: confirmed.recoveryCodes };
      } catch (e) {
        return { secret, uri, error: refusal(e).message };
      }
    }
    if (step === "disable") {
      await api("/api/me/mfa/disable", { body: { code } });
      revalidatePath("/account");
      return { done: true, ok: "Two-step sign-in is off." };
    }
  } catch (e) {
    return { error: refusal(e).message };
  }
  return {};
}
