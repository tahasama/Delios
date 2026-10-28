"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { problemOf, refusalForForm, SESSION_COOKIE } from "@/lib/client";
import { CONSOLE_COOKIE, consoleApi, consoleFetch } from "@/lib/console/client";

type Result = { error?: string; ok?: string; fields?: string[] };
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const failed = (e: unknown): Result => refusalForForm(e);
/** A day typed on a form, as the backend reads it (it counts to the end of that day). */
const day = (value: string) => value || null;

export type SignInState = {
  error?: string;
  /** The first sign-in: the authenticator to set up, its QR code drawn here (a picture: nothing in it runs). */
  setup?: { secret: string; qr: string; challenge: string };
  /** Shown once, right after the authenticator is set up. */
  recoveryCodes?: string[];
};

type Answer = { step: "SIGNED_IN" | "SETUP"; secret?: string; uri?: string; challenge?: string; recoveryCodes?: string[] | null };

/** Keeps the console's session from the backend's answer on the screens' own cookie. */
async function keepSession(response: Response): Promise<boolean> {
  const set = response.headers.getSetCookie().find((one) => one.startsWith("delios_console="));
  const token = set?.split(";")[0].slice("delios_console=".length);
  if (!token) return false;
  (await cookies()).set(CONSOLE_COOKIE, token, {
    httpOnly: true, sameSite: "strict", path: "/", maxAge: 8 * 60 * 60, secure: process.env.NODE_ENV === "production",
  });
  return true;
}

/**
 * The DELIOS team signs in: email and password, then the code of their authenticator app. The first time, the page
 * shows a QR code to scan, asks the first code, and gives recovery codes once.
 */
export async function consoleSignInAction(prev: SignInState | undefined, formData: FormData): Promise<SignInState> {
  const challenge = text(formData, "challenge");
  const response = challenge
    ? await consoleFetch("/api/console/auth/setup", { body: { challenge, code: text(formData, "code") } })
    : await consoleFetch("/api/console/auth/sign-in", {
        body: { email: text(formData, "email"), password: String(formData.get("password") ?? ""), code: text(formData, "code") },
      });
  if (!response.ok) return { error: (await problemOf(response)).message, setup: challenge ? prev?.setup : undefined };
  const answer = (await response.json()) as Answer;
  if (answer.step === "SETUP" && answer.uri && answer.secret && answer.challenge) {
    const qr = await QRCode.toDataURL(answer.uri, { margin: 1, width: 220, errorCorrectionLevel: "M" });
    return { setup: { secret: answer.secret.replace(/(.{4})/g, "$1 ").trim(), qr, challenge: answer.challenge } };
  }
  if (!(await keepSession(response))) return { error: "The console did not open a session. Try again." };
  if (answer.recoveryCodes?.length) return { recoveryCodes: answer.recoveryCodes };
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

/**
 * Enters the organization as one of its administrators while it lets DELIOS in: this browser is then signed in there as
 * "DELIOS support: <you>", until the access ends; its administrators are told, and every act is in their audit trail.
 */
export async function enterAsSupportAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  let answer: { token: string; expires: string };
  try {
    answer = await consoleApi<{ token: string; expires: string }>(`/api/console/organizations/${text(formData, "tenantId")}/enter`, { body: {} });
  } catch (e) {
    return failed(e);
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, answer.token, {
    httpOnly: true, sameSite: "lax", path: "/", expires: new Date(answer.expires), secure: process.env.NODE_ENV === "production",
  });
  jar.delete("edms_project");
  redirect("/organization");
}

/** An invoice issued to an organization: its lines, period and tax; numbered by itself. */
export async function issueInvoiceAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const lines = [0, 1, 2, 3, 4].map((i) => ({
    description: text(formData, `line${i}`), quantity: Number(text(formData, `qty${i}`) || "0"), unitPrice: Number(text(formData, `price${i}`) || "0"),
  })).filter((l) => l.description);
  const rate = text(formData, "taxRate");
  try {
    const { number } = await consoleApi<{ number: string }>(`/api/console/organizations/${text(formData, "tenantId")}/invoices`, {
      body: {
        issuedOn: text(formData, "issuedOn") || null, periodFrom: text(formData, "periodFrom") || null, periodTo: text(formData, "periodTo") || null,
        currency: text(formData, "currency") || "EUR", taxRate: rate === "" ? null : Number(rate), lines, note: text(formData, "note") || null,
      },
    });
    revalidatePath("/console", "layout");
    return { ok: `Invoice ${number} issued; its administrators are told.` };
  } catch (e) {
    return failed(e);
  }
}

export async function invoicePaidAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  try {
    await consoleApi(`/api/console/invoices/${text(formData, "invoiceId")}/paid`, {
      body: { paidOn: text(formData, "paidOn") || null, paidBy: text(formData, "paidBy"), reference: text(formData, "reference") || null },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/console", "layout");
  return { ok: "Recorded as paid; the period it pays for is paid." };
}

export async function voidInvoiceAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const why = text(formData, "why");
  if (!why) return { error: "Say why it is voided.", fields: ["why"] };
  try {
    await consoleApi(`/api/console/invoices/${text(formData, "invoiceId")}/void`, { body: { why } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/console", "layout");
  return { ok: "Voided, kept with why. Issue a new one if needed." };
}

/** DELIOS's own details on every invoice: who sells, its tax numbers, its bank, the tax rate, the mentions. */
export async function setSellerAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const rate = text(formData, "taxRate");
  const days = text(formData, "dueDays");
  try {
    await consoleApi("/api/console/seller", {
      method: "PUT",
      body: {
        name: text(formData, "name"), address: String(formData.get("address") ?? ""), taxNumbers: String(formData.get("taxNumbers") ?? ""),
        bank: String(formData.get("bank") ?? ""), taxRate: rate === "" ? null : Number(rate), dueDays: days === "" ? null : Number(days),
        mentions: String(formData.get("mentions") ?? ""),
      },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/console/payments");
  return { ok: "Saved: new invoices carry it." };
}

/** How many days a new organization tries DELIOS (0: no end). */
export async function setTrialDaysAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const days = text(formData, "days");
  const why = text(formData, "why");
  if (days === "") return { error: "Say how many days (0 for no end).", fields: ["days"] };
  if (!why) return { error: "Say why it changes.", fields: ["why"] };
  try {
    await consoleApi("/api/console/trial-days", { method: "PUT", body: { days: Number(days), why } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/console/payments");
  return { ok: Number(days) === 0 ? "Saved: organizations signing up from now on try DELIOS with no end." : `Saved: organizations signing up from now on try DELIOS for ${days} days.` };
}

/** How organizations reach DELIOS support. */
export async function setSupportContactAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  try {
    await consoleApi("/api/console/platform", {
      method: "PUT", body: { supportEmail: text(formData, "email"), supportHours: text(formData, "hours"), supportPhone: text(formData, "phone") },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/console/team");
  return { ok: "Saved: shown to every organization on Help and Contract & plan." };
}
