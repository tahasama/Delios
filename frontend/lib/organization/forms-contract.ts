"use server";

import { revalidatePath } from "next/cache";
import { api, refusalForForm } from "@/lib/client";

type Result = { error?: string; ok?: string; fields?: string[] };
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const done = (ok: string): Result => {
  revalidatePath("/organization", "layout");
  return { ok };
};

/** An administrator accepts the current version of the terms or the data processing agreement, for the organization. */
export async function acceptTextAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  try {
    await api("/api/organization/contract/accept", { body: { kind: text(formData, "kind") } });
  } catch (e) {
    return refusalForForm(e);
  }
  return done("Accepted, for the organization. Kept with its version and today's date.");
}

/** An administrator chooses a plan: DELIOS is told, sets it up and sends the first invoice. */
export async function choosePlanAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const users = Number(text(formData, "users") || "0");
  if (!text(formData, "plan")) return { error: "Choose a plan.", fields: ["plan"] };
  if (!(users >= 1)) return { error: "Say how many people will work in it.", fields: ["users"] };
  try {
    await api("/api/organization/contract/plan", { body: { plan: text(formData, "plan"), users, note: text(formData, "note") || null } });
  } catch (e) {
    return refusalForForm(e);
  }
  return done("Sent to DELIOS. They set it up and send your first invoice; you will be told, and it will be here.");
}

/** Cancelling is one click (owner, as such apps do): nothing renews; it ends with the period paid. */
export async function cancelPlanAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  try {
    await api("/api/organization/contract/cancel", { body: { why: text(formData, "why") || null } });
  } catch (e) {
    return refusalForForm(e);
  }
  return done("Cancelled: nothing renews. Everyone works as usual until the end of the period paid; then it reads only, and nothing is deleted.");
}

export async function resumePlanAction(): Promise<Result> {
  try {
    await api("/api/organization/contract/resume", { body: {} });
  } catch (e) {
    return refusalForForm(e);
  }
  return done("It renews again as before.");
}

/** Lets the DELIOS team in to help, for a set time, with why. */
export async function grantSupportAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const why = text(formData, "why");
  if (!why) return { error: "Say why DELIOS is let in.", fields: ["why"] };
  try {
    await api("/api/organization/support", { body: { days: Number(text(formData, "days") || "0"), why } });
  } catch (e) {
    return refusalForForm(e);
  }
  return done("DELIOS is let in for that time. What its team reads is in the audit trail.");
}

export async function endSupportAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  try {
    await api(`/api/organization/support/${text(formData, "grantId")}/end`, { body: {} });
  } catch (e) {
    return refusalForForm(e);
  }
  return done("Ended: DELIOS no longer reads your projects and people.");
}

/** Who the organization's invoices are made out to. */
export async function setBillingDetailsAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  try {
    await api("/api/organization/billing", {
      method: "PUT",
      body: {
        legalName: text(formData, "legalName"), address: String(formData.get("address") ?? "").trim() || null, country: text(formData, "country") || null,
        taxNumber: text(formData, "taxNumber") || null, email: text(formData, "email") || null, reference: text(formData, "reference") || null,
      },
    });
  } catch (e) {
    return refusalForForm(e);
  }
  return done("Saved: the next invoices are made out so.");
}
