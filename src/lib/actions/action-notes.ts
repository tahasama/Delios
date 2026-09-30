"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { isController, isAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { carrierRefusal } from "@/lib/control-activities";

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
  const { user, db, projectId } = ctx;
  const actionId = String(formData.get("actionId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const responsibleName = String(formData.get("responsibleName") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const delayResponsible = String(formData.get("delayResponsible") ?? "").trim() || null;
  const delayReason = String(formData.get("delayReason") ?? "").trim() || null;

  if (decision !== "CARRIED" && decision !== "STOPPED") {
    return { error: "Say whether the work went ahead without its documents, or was stopped." };
  }
  if (!responsibleName) return { error: "Name who carries this decision — the manager the action answers to." };
  if (!reason) return { error: "Say why. A decision with no reason on it is not a record of anything." };

  const action = await db.action.findUnique({ where: { id: actionId }, select: { id: true, code: true, name: true, scheduledDate: true } });
  if (!action) return { error: "That action no longer exists." };

  const refusal = await carrierRefusal(ctx, "ACTION_NOTE", {
    control: isController(user) || isAdmin(user),
    standing: true,
  });
  if (refusal) return { error: refusal };

  await db.actionNote.create({
    data: {
      projectId,
      actionId,
      decision,
      // The day the action stood at when this was written. A later schedule
      // moves the date, and the note has to keep the one it was written about.
      plannedDate: action.scheduledDate,
      responsibleName,
      reason,
      delayResponsible,
      delayReason,
      recordedById: user.id,
      recordedByName: user.name,
    },
  });

  await audit({
    tenant: ctx, actor: user, action: decision === "CARRIED" ? "ACTION_CARRIED" : "ACTION_STOPPED",
    entityType: "Action", entityId: actionId, entityLabel: `${action.code} — ${action.name}`,
    newValue: responsibleName,
    detail: `${decision === "CARRIED" ? "Carried out without all of its documents" : "Stopped for want of its documents"}: ${reason}${delayResponsible ? ` · delay owed by ${delayResponsible}${delayReason ? `: ${delayReason}` : ""}` : ""}`,
  });

  revalidatePath(`/actions/${action.code}`);
  return { message: decision === "CARRIED" ? "Recorded: it went ahead, and the record says on whose word." : "Recorded: it was stopped, and the record says why." };
}
