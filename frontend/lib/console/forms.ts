"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { problemOf, refusalForForm } from "@/lib/client";
import { CONSOLE_COOKIE, consoleApi, consoleFetch } from "@/lib/console/client";

type Result = { error?: string; ok?: string; fields?: string[] };
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const failed = (e: unknown): Result => refusalForForm(e);
/** A day typed on a form, as the backend reads it (it counts to the end of that day). */
const day = (value: string) => value || null;

/** The DELIOS team signs in: email, password and the code of their authenticator app, always. */
export async function consoleSignInAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const response = await consoleFetch("/api/console/auth/sign-in", {
    body: { email: text(formData, "email"), password: String(formData.get("password") ?? ""), code: text(formData, "code") },
  });
  if (!response.ok) return { error: (await problemOf(response)).message };
  const set = response.headers.getSetCookie().find((one) => one.startsWith("delios_console="));
  const token = set?.split(";")[0].slice("delios_console=".length);
  if (!token) return { error: "The console did not open a session. Try again." };
  (await cookies()).set(CONSOLE_COOKIE, token, {
    httpOnly: true, sameSite: "strict", path: "/", maxAge: 8 * 60 * 60, secure: process.env.NODE_ENV === "production",
  });
  redirect("/console");
}

export async function consoleSignOutAction() {
  await consoleFetch("/api/console/auth/sign-out", { body: {} }).catch(() => undefined);
  (await cookies()).delete(CONSOLE_COOKIE);
  redirect("/console/sign-in");
}

export async function setSubscriptionAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const id = text(formData, "tenantId");
  const why = text(formData, "why");
  if (!why) return { error: "Say why it changes.", fields: ["why"] };
  const seats = text(formData, "seats");
  try {
    await consoleApi(`/api/console/organizations/${id}/subscription`, {
      method: "PUT",
      body: {
        plan: text(formData, "plan") || null, state: text(formData, "state"), trialEndsAt: day(text(formData, "trialEndsAt")),
        paidUntil: day(text(formData, "paidUntil")), billing: text(formData, "billing") || null, seats: seats ? Number(seats) : null,
        contractRef: text(formData, "contractRef") || null, contractSignedOn: text(formData, "contractSignedOn") || null,
        providerRef: text(formData, "providerRef") || null, notes: text(formData, "notes") || null, why,
      },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/console", "layout");
  return { ok: "Saved. It applies at once; the organization reads it on its Contract & plan." };
}

export async function setOrganizationActiveAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const why = text(formData, "why");
  if (!why) return { error: "Say why.", fields: ["why"] };
  const active = text(formData, "active") === "true";
  try {
    await consoleApi(`/api/console/organizations/${text(formData, "tenantId")}/active`, { method: "PUT", body: { active, why } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/console", "layout");
  return { ok: active ? "Switched on: its people sign in again." : "Switched off: nobody of it signs in; nothing is deleted." };
}

export async function carryOutMergeAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  try {
    const { said } = await consoleApi<{ said: string }>(`/api/console/merges/${text(formData, "mergeId")}/carry-out`, { body: {} });
    revalidatePath("/console", "layout");
    return { ok: said };
  } catch (e) {
    return failed(e);
  }
}

export async function savePlanAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const price = text(formData, "pricePerUser");
  try {
    await consoleApi("/api/console/plans", {
      body: {
        code: text(formData, "code"), name: text(formData, "name"), pricePerUser: price ? Number(price) : null,
        currency: text(formData, "currency") || "EUR", notes: text(formData, "notes") || null, active: formData.get("active") === "on",
      },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/console/payments");
  return { ok: "Saved." };
}

export async function publishLegalAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const kind = text(formData, "kind");
  try {
    const { version } = await consoleApi<{ version: number }>(`/api/console/legal/${kind}`, {
      body: { title: text(formData, "title"), body: String(formData.get("body") ?? ""), note: text(formData, "note") || null },
    });
    revalidatePath("/console", "layout");
    revalidatePath("/legal", "layout");
    return { ok: `Version ${version} published.` };
  } catch (e) {
    return failed(e);
  }
}

export async function setMatterAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  try {
    await consoleApi(`/api/console/matters/${text(formData, "key")}`, {
      method: "PUT", body: { status: text(formData, "status"), note: text(formData, "note") || null },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/console/legal");
  return { ok: "Saved." };
}

export async function sendNoticeAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  try {
    const { told } = await consoleApi<{ told: number }>("/api/console/notices", { body: { title: text(formData, "title"), body: text(formData, "body") } });
    revalidatePath("/console/notices");
    return { ok: `Sent to ${told} administrator${told === 1 ? "" : "s"}, by notification and email.` };
  } catch (e) {
    return failed(e);
  }
}
