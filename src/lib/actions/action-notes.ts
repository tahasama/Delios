"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { isController, isAdmin } from "@/lib/auth";
import { carrierRefusal, actIsOff } from "@/lib/control-activities";
import { api, projectPath, refusal } from "@/lib/api/client";
import { activityDetail, type ActivityDetail } from "@/lib/api/schedule";

/**
 * What was decided about an action that did not have its documents.
 *
 * It went ahead without them or it was stopped for want of them. Either way
 * somebody owns that decision, and somebody owns the delay behind it — and the
 * note says so in their own words, with the day the action stood at when it was
 * written. It is never edited and never deleted: it exists to be read by an
 * audit, and a record that can be tidied afterwards is not one.
 */
type State = { error?: string; message?: string };

export async function recordActionNoteAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const { user } = ctx;
  const actionId = String(formData.get("actionId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const responsibleName = String(formData.get("responsibleName") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const delayResponsible = String(formData.get("delayResponsible") ?? "").trim() || null;
  const delayReason = String(formData.get("delayReason") ?? "").trim() || null;

  if (await actIsOff(ctx, "ACTION_NOTE")) return { error: "Notes on actions are not used on this project." };
  if (decision !== "CARRIED" && decision !== "STOPPED") {
    return { error: "Say whether the work went ahead without its documents, or was stopped." };
  }
  if (!responsibleName) return { error: "Name who carries this decision — the manager the action answers to." };
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
    });
  } catch (e) {
    return { error: refusal(e).message };
  }

  revalidatePath(`/actions/${action.code}`);
  return { message: decision === "CARRIED" ? "Recorded: it went ahead, and the record says on whose word." : "Recorded: it was stopped, and the record says why." };
}
