"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { api, projectPath, refusal } from "@/lib/api/client";
import { getActiveSet } from "@/lib/config";
import { mayUploadLists } from "@/lib/permissions";
import { needDefaults } from "@/lib/schedule";
import { activityDetail } from "@/lib/api/schedule";

type State = { error?: string; ok?: string };

/** Everything that shows an action's disciplines or documents. */
function refresh(code: string, transmittalId?: string | null) {
  revalidatePath(`/actions/${code}`);
  revalidatePath("/actions");
  revalidatePath("/");
  if (transmittalId) revalidatePath(`/transmittals/${transmittalId}`);
}

/**
 * The disciplines concerned by an action, tagged by hand: whoever may upload the
 * disciplines-per-action list (Document Control or Plan). Recorded in the
 * activity log with what it was before.
 */
export async function setDisciplinesAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!mayUploadLists(ctx.user.verbs)) return { error: "Document Control, or whoever plans the project, tags the disciplines." };
  const actionId = String(formData.get("actionId") ?? "");
  const code = String(formData.get("code") ?? "");
  const departments = formData.getAll("departments").map(String).filter(Boolean);
  try {
    await api(projectPath(ctx, `/activities/${actionId}/departments`), { method: "PUT", body: { departments } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  refresh(code);
  return { ok: departments.length ? "Disciplines saved." : "No discipline tagged now." };
}

/**
 * Document Control adds a register document to an action, for one of its
 * disciplines: the number only. Needed for the same purpose and at the same
 * status as the requirements list says when it says nothing, by the project's
 * lead before the day. In answer to a request, the request is closed and
 * whoever asked is told.
 */
export async function addDocumentToActionAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL")) return { error: "Document Control adds documents to an action." };
  const actionId = String(formData.get("actionId") ?? "");
  const documentIds = formData.getAll("documentIds").map(String).filter(Boolean);
  const department = String(formData.get("department") ?? "") || null;
  const transmittalId = String(formData.get("transmittalId") ?? "") || null;
  if (!actionId) return { error: "Choose the action." };
  if (!documentIds.length) return { error: "Choose the document to add." };
  if (!department) return { error: "Say which discipline needs it." };
  // Needed by a discipline the action concerns: tag it on the action first.
  const action = (await activityDetail(ctx, actionId))?.activity;
  if (!action) return { error: "That action is no longer in the schedule." };
  if (!action.departments.includes(department)) return { error: `${action.code} does not concern ${department}: tag it on the action first.` };
  const code = action.code;
  const [reasons, statuses] = await Promise.all([getActiveSet("REASONS_FOR_ISSUE"), getActiveSet("STATUSES")]);
  const { purpose, status } = needDefaults(reasons, statuses);
  try {
    // The request is answered by the first document added for it.
    for (const [i, documentId] of documentIds.entries()) {
      await api(projectPath(ctx, `/activities/${actionId}/needs`), {
        body: { documentId, purpose, requiredStatuses: status ? [status] : [], anchor: "START", department, transmittalId: i === 0 ? transmittalId : null },
      });
    }
  } catch (e) {
    return { error: refusal(e).message };
  }
  refresh(code, transmittalId);
  for (const documentId of documentIds) revalidatePath(`/documents/${documentId}`);
  return { ok: documentIds.length === 1 ? `Added to ${code}.` : `${documentIds.length} added to ${code}.` };
}

/** Document Control takes a document off an action. Recorded in the activity log. */
export async function removeDocumentFromActionAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL")) return { error: "Document Control takes documents off an action." };
  const actionId = String(formData.get("actionId") ?? "");
  const code = String(formData.get("code") ?? "");
  const needId = String(formData.get("needId") ?? "");
  if (!needId) return { error: "Choose the document to take off." };
  try {
    await api(projectPath(ctx, `/activities/${actionId}/needs/${needId}`), { method: "DELETE" });
  } catch (e) {
    return { error: refusal(e).message };
  }
  refresh(code);
  return { ok: "Taken off." };
}

/** Document Control answers a request to add a document without adding one, saying why; whoever asked is told. */
export async function answerActionRequestAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL")) return { error: "Document Control answers these requests." };
  const transmittalId = String(formData.get("transmittalId") ?? "");
  const code = String(formData.get("code") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { error: "Say why nothing is added; whoever asked reads it." };
  try {
    await api(projectPath(ctx, `/transmittals/${transmittalId}/activity-answer`), { body: { note } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  refresh(code, transmittalId);
  return { ok: "Answered." };
}
