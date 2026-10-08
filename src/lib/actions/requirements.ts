"use server";

import { requireScope } from "@/lib/scope";

type State = { error?: string; ok?: string };

/**
 * Step 3 — ask each chosen department for the documents its activities need.
 * A call covers the department's activities no earlier call covered, so a new
 * schedule version only asks about what is new.
 */
export async function issueCallsAction(_prev: State | undefined, _formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL")) return { error: "Document Control issues the calls to departments." };
  // The backend keeps no calls to departments.
  return { error: "Calls to departments are not supported yet." };
}

/** Step 5 — a late department is reminded; each reminder is counted and audited. */
export async function remindCallAction(_prev: State | undefined, _formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL")) return { error: "Document Control sends reminders." };
  return { error: "Calls to departments are not supported yet." };
}

/** A department answers that it needs nothing — recorded, not assumed. */
export async function closeCallAction(_prev: State | undefined, _formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL")) return { error: "Document Control records the answer." };
  return { error: "Calls to departments are not supported yet." };
}

/**
 * Step 7 — the approved list goes to whoever sends each document. Suppliers
 * also see it in their package; our departments see it here and on Home.
 */
export async function issueToSendersAction(_prev: State | undefined, _formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL")) return { error: "Document Control issues the list to senders." };
  // The backend keeps no record of a list issued to a sender, and opens no package from it.
  return { error: "Issuing the requirements to senders is not supported yet." };
}

/**
 * Step 8 — before the activity, a department confirms its documents are
 * available. Declaring a shortage needs a note, and alerts Document Control.
 */
export async function confirmReadinessAction(_prev: State | undefined, _formData: FormData): Promise<State> {
  await requireScope();
  // The backend keeps no confirmation by a department; its waiver of a need is the nearest thing.
  return { error: "Confirming readiness is not supported yet." };
}

/**
 * Tell every department an activity concerns where it stands, and name the
 * ones that are short. Everybody sees the risk; the department that must act
 * sees itself named, with what is still missing.
 */
export async function notifyDepartmentsAction(_prev: State | undefined, _formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL") && !ctx.can("PLAN")) return { error: ctx.why("CONTROL") };
  // The backend sends no notifications from an activity.
  return { error: "Notifying departments is not supported yet." };
}

