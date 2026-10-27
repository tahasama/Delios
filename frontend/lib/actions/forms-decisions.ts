"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { isController, isAdmin } from "@/lib/core/auth";
import { carrierRefusal, actIsOff } from "@/lib/settings/control-activities";
import { api, projectPath, refusal } from "@/lib/client";
import { activityDetail, type ActivityDetail } from "@/lib/actions/api";
import { addressees } from "@/lib/transmittals/api";
import { once } from "@/lib/core/once";

/**
 * What was decided about an action that did not have its documents.
 *
 * It went ahead without them or it was stopped for want of them. Either way
 * somebody owns that decision, and somebody owns the delay behind it — and the
 * note says so in their own words, with the day the action stood at when it was
 * written. It is never edited and never deleted: it exists to be read by an
 * audit, and a record that can be tidied afterwards is not one.
 */
type State = { error?: string; ok?: string };

export async function recordActionNoteAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const { user } = ctx;
  const actionId = String(formData.get("actionId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  // Who decided is picked from the people on the project, of any organization, and kept with their organization.
  const decidedBy = String(formData.get("decidedBy") ?? "");
  const person = decidedBy ? (await addressees(ctx)).people.find((one) => one.id === decidedBy) : null;
  const responsibleName = person ? `${person.name}${person.organization ? ` (${person.organization})` : ""}` : String(formData.get("responsibleName") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const delayResponsible = String(formData.get("delayResponsible") ?? "").trim() || null;
  const delayReason = String(formData.get("delayReason") ?? "").trim() || null;

  if (await actIsOff(ctx, "ACTION_NOTE")) return { error: "Notes on actions are not used on this project." };
  if (!decision) return { error: "Choose what happened." };
  if (!responsibleName) return { error: "Choose who decided it." };
  if (!reason) return { error: "Say why. A decision with no reason on it is not a record of anything." };

  const action = (await activityDetail(ctx, actionId))?.activity;
  if (!action) return { error: "That action no longer exists." };

  const refused = await carrierRefusal(ctx, "ACTION_NOTE", {
    control: isController(user) || isAdmin(user),
    standing: true,
  });
  if (refused) return { error: refused };

  // The backend keeps the day the activity stood at when this was written, and
  // records it in its audit trail.
  try {
    await api<ActivityDetail>(projectPath(ctx, `/activities/${actionId}/decisions`), {
      method: "POST",
      body: { decision, responsibleName, reason, delayOwedBy: delayResponsible, delayReason },
      idempotencyKey: once(formData, "decision"),
    });
  } catch (e) {
    return { error: refusal(e).message };
  }

  revalidatePath(`/actions/${action.code}`);
  return { ok: "Written down. Everyone concerned, and whoever plans the project, has been told." };
}

/** Whoever plans the project confirms a postponement, saying what changes for the next schedule revision. */
export async function confirmPostponementAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const actionId = String(formData.get("actionId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { error: "Say what changes, so the next schedule revision can follow." };
  try {
    const detail = await api<ActivityDetail>(projectPath(ctx, `/activities/${actionId}/decisions/${String(formData.get("decisionId") ?? "")}/confirm`), { body: { note }, idempotencyKey: once(formData, "confirm") });
    revalidatePath(`/actions/${detail.activity.code}`);
  } catch (e) {
    return { error: refusal(e).message };
  }
  return { ok: "Confirmed. Everyone concerned and the control function have been told." };
}

/** the control function takes a decision back, with why. It stays on the record, marked. */
export async function reverseDecisionAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const actionId = String(formData.get("actionId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { error: "Say why it is taken back." };
  try {
    const detail = await api<ActivityDetail>(projectPath(ctx, `/activities/${actionId}/decisions/${String(formData.get("decisionId") ?? "")}/reverse`), { body: { note } });
    revalidatePath(`/actions/${detail.activity.code}`);
  } catch (e) {
    return { error: refusal(e).message };
  }
  return { ok: "Taken back. Everyone concerned and whoever plans the project have been told." };
}
