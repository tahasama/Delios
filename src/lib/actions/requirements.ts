"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { api, projectPath, refusal } from "@/lib/api/client";

type State = { error?: string; ok?: string };

const failed = (e: unknown): State => ({ error: refusal(e).message });

/**
 * Step 3 — ask each chosen department for the documents its activities need.
 * A call covers the department's activities no earlier call covered, so a new
 * schedule version only asks about what is new.
 */
export async function issueCallsAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL")) return { error: "Document Control issues the calls to departments." };
  const departments = formData.getAll("department").map(String).filter(Boolean);
  if (!departments.length) return { error: "Choose the departments to ask." };
  const dueOn = String(formData.get("dueAt") ?? "").slice(0, 10);
  if (!dueOn) return { error: "Say by when they answer." };
  let issued: unknown[];
  try {
    issued = await api<unknown[]>(projectPath(ctx, "/requirement-calls"), { body: { departments, dueOn } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/actions/requirements");
  return { ok: `${issued.length} department${issued.length === 1 ? "" : "s"} asked.` };
}

/** Step 5 — a late department is reminded; each reminder is counted and audited. */
export async function remindCallAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL")) return { error: "Document Control sends reminders." };
  try {
    await api(projectPath(ctx, `/requirement-calls/${String(formData.get("callId") ?? "")}/remind`), { method: "POST" });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/actions/requirements");
  return { ok: "Reminded." };
}

/** A department answers that it needs nothing — recorded, not assumed. */
export async function closeCallAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL")) return { error: "Document Control records the answer." };
  try {
    await api(projectPath(ctx, `/requirement-calls/${String(formData.get("callId") ?? "")}/answer`), {
      body: { note: String(formData.get("note") ?? "").trim() || null },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/actions/requirements");
  return { ok: "Recorded." };
}

/**
 * Step 7 — the approved list goes to whoever sends each document. They are
 * told, and the list as it went is kept, so what changed since is known.
 */
export async function issueToSendersAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL")) return { error: "Document Control issues the list to senders." };
  const senders = formData.getAll("sender").map(String).filter(Boolean);
  if (!senders.length) return { error: "Choose who it goes to." };
  try {
    for (const sender of senders) await api(projectPath(ctx, "/sender-issues"), { body: { sender } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/actions/requirements");
  return { ok: `Issued to ${senders.length} sender${senders.length === 1 ? "" : "s"}.` };
}

/**
 * Step 8 — before the activity, a department confirms its documents are
 * available. Declaring a shortage needs a note, and alerts Document Control.
 */
export async function confirmReadinessAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const actionId = String(formData.get("actionId") ?? "");
  try {
    await api(projectPath(ctx, `/activities/${actionId}/readiness`), {
      body: {
        department: String(formData.get("department") ?? ""), available: formData.get("available") === "yes",
        note: String(formData.get("note") ?? "").trim() || null,
      },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/actions", "layout");
  return { ok: "Recorded." };
}

/**
 * Tell every department an activity concerns where it stands, and name the
 * ones that are short. Everybody sees the risk; the department that must act
 * sees itself named, with what is still missing.
 */
export async function notifyDepartmentsAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL") && !ctx.can("PLAN")) return { error: ctx.why("CONTROL") };
  let told: { told: number };
  try {
    told = await api(projectPath(ctx, `/activities/${String(formData.get("actionId") ?? "")}/notify-departments`), { method: "POST" });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/actions", "layout");
  return { ok: `${told.told} ${told.told === 1 ? "person" : "people"} told.` };
}
