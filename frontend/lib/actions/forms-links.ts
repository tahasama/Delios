"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath, refusal } from "@/lib/client";
import { getActiveSet } from "@/lib/settings/config";
import { needDefaults } from "@/lib/actions/schedule";
import { activityDetail } from "@/lib/actions/api";
import { controlDoes } from "@/lib/settings/control-activities";
import { backendDocument } from "@/lib/documents/api";

/** Each document's own discipline: an action needs a document for that discipline, never another. */
async function disciplinesOf(ctx: Awaited<ReturnType<typeof requireScope>>, ids: string[]): Promise<Map<string, string>> {
  const docs = await Promise.all(ids.map((id) => backendDocument(ctx, id).catch(() => null)));
  return new Map(docs.filter((d): d is NonNullable<typeof d> => !!d).map((d) => [d.id, d.discipline] as const));
}

type State = { error?: string; ok?: string };

/** Everything that shows an action's disciplines or documents. */
function refresh(code: string, transmittalId?: string | null) {
  revalidatePath(`/actions/${code}`);
  revalidatePath("/actions");
  revalidatePath("/");
  if (transmittalId) revalidatePath(`/transmittals/${transmittalId}`);
}

/**
 * The disciplines concerned by an action, tagged by hand: the control function (or
 * an administrator). Recorded in the activity log with what it was before. In
 * answer to a request for a missing discipline, the request is closed and
 * whoever asked is told.
 */
export async function setDisciplinesAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL")) return { error: "The control function tags the disciplines by hand." };
  const actionId = String(formData.get("actionId") ?? "");
  const code = String(formData.get("code") ?? "");
  const transmittalId = String(formData.get("transmittalId") ?? "") || null;
  const departments = formData.getAll("departments").map(String).filter(Boolean);
  try {
    await api(projectPath(ctx, `/activities/${actionId}/departments`), { method: "PUT", body: { departments, transmittalId } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  refresh(code, transmittalId);
  return { ok: departments.length ? "Disciplines saved." : "No discipline tagged now." };
}

/**
 * The control function adds a register document to an action, for one of its
 * disciplines: the number only. Needed for the same purpose and at the same
 * status as the requirements list says when it says nothing, by the project's
 * lead before the day. In answer to a request, the request is closed and
 * whoever asked is told.
 */
export async function addDocumentToActionAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL")) return { error: "The control function adds documents to an action." };
  const actionId = String(formData.get("actionId") ?? "");
  const documentIds = formData.getAll("documentIds").map(String).filter(Boolean);
  // A request answered names the discipline it was asked for; otherwise each document is needed for its own.
  const department = String(formData.get("department") ?? "") || null;
  const transmittalId = String(formData.get("transmittalId") ?? "") || null;
  if (!actionId) return { error: "Choose the action." };
  if (!documentIds.length) return { error: "Choose the document to add." };
  // Needed by a discipline the action concerns: tag it on the action first.
  const detail = await activityDetail(ctx, actionId);
  const action = detail?.activity;
  if (!action) return { error: "That action is no longer in the schedule." };
  // What it needs already stays as it is.
  const already = new Set(detail!.needs.map((one) => one.documentId));
  const fresh = documentIds.filter((id) => !already.has(id));
  if (!fresh.length) return { error: `${action.code} already needs ${documentIds.length === 1 ? "it" : "all of them"}.` };
  const own = await disciplinesOf(ctx, fresh);
  const forOf = (id: string) => department ?? own.get(id) ?? "";
  const outside = fresh.filter((id) => !action.departments.includes(forOf(id)));
  if (outside.length) return { error: `${action.code} does not concern ${[...new Set(outside.map(forOf))].join(", ")}: tag it on the action first, or choose another action.` };
  const code = action.code;
  const [reasons, statuses] = await Promise.all([getActiveSet("REASONS_FOR_ISSUE"), getActiveSet("STATUSES")]);
  const { purpose, status } = needDefaults(reasons, statuses);
  try {
    // The request is answered by the first document added for it.
    for (const [i, documentId] of fresh.entries()) {
      await api(projectPath(ctx, `/activities/${actionId}/needs`), {
        body: { documentId, purpose, requiredStatuses: status ? [status] : [], anchor: "START", department: forOf(documentId), transmittalId: i === 0 ? transmittalId : null },
      });
    }
  } catch (e) {
    return { error: refusal(e).message };
  }
  refresh(code, transmittalId);
  for (const documentId of fresh) revalidatePath(`/documents/${documentId}`);
  // From the register's selection: back to the action, where they now show.
  if (formData.get("back")) redirect(`/actions/${code}`);
  return { ok: fresh.length === 1 ? `Added to ${code}.` : `${fresh.length} added to ${code}.` };
}

/**
 * The register opened for one action: what is ticked is what the action needs.
 * Ticked and not there yet is added, for the discipline chosen; there and
 * unticked is taken off. The control function. Each change is in the activity log.
 */
export async function setActionDocumentsAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  // Without a control function, the people of a discipline choose their own discipline's documents.
  const own = !ctx.can("CONTROL") && !(await controlDoes(ctx, "ACTION_LINKS")) ? ctx.user.department ?? null : null;
  if (!ctx.can("CONTROL") && !own) return { error: "The control function chooses an action's documents." };
  const actionId = String(formData.get("actionId") ?? "");
  const ticked = new Set(formData.getAll("documentIds").map(String).filter(Boolean));

  const detail = await activityDetail(ctx, actionId);
  if (!detail) return { error: "That action is no longer in the schedule." };
  const activity = detail.activity;
  const needs = own ? detail.needs.filter((one) => one.department === own) : detail.needs;
  const linked = new Set(needs.map((one) => one.documentId));
  const adding = [...ticked].filter((id) => !linked.has(id));
  const leaving = needs.filter((one) => !ticked.has(one.documentId));
  // Each document is needed for its own discipline (without a control function, only one's own discipline's).
  const disciplineOf = await disciplinesOf(ctx, adding);
  const outside = adding.filter((id) => !activity.departments.includes(disciplineOf.get(id) ?? "") || (own && disciplineOf.get(id) !== own));
  if (outside.length) return { error: `${outside.length} ticked document${outside.length === 1 ? " is" : "s are"} of a discipline ${activity.code} does not concern${own ? ", or not yours" : ""}: tag it on the action first, or untick ${outside.length === 1 ? "it" : "them"}.` };
  const [reasons, statuses] = await Promise.all([getActiveSet("REASONS_FOR_ISSUE"), getActiveSet("STATUSES")]);
  const { purpose, status } = needDefaults(reasons, statuses);
  try {
    for (const documentId of adding) {
      await api(projectPath(ctx, `/activities/${actionId}/needs`), {
        body: { documentId, purpose, requiredStatuses: status ? [status] : [], anchor: "START", department: disciplineOf.get(documentId) },
      });
    }
    for (const need of leaving) await api(projectPath(ctx, `/activities/${actionId}/needs/${need.id}`), { method: "DELETE" });
  } catch (e) {
    return { error: refusal(e).message };
  }
  refresh(activity.code);
  for (const id of [...adding, ...leaving.map((one) => one.documentId)]) revalidatePath(`/documents/${id}`);
  redirect(`/actions/${activity.code}`);
}

/** the control function answers a request to add a document without adding one, saying why; whoever asked is told. */
export async function answerActionRequestAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL")) return { error: "The control function answers these requests." };
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

/**
 * The control function checks a request that whoever holds Manage confirms: what will change
 * (the documents and the discipline needing them, or the disciplines), and who
 * confirms it. Nothing changes yet; whoever confirms is told.
 */
export async function checkActionRequestAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL")) return { error: "The control function checks these requests." };
  const transmittalId = String(formData.get("transmittalId") ?? "");
  const code = String(formData.get("code") ?? "");
  const confirmerId = String(formData.get("confirmerId") ?? "") || null;
  if (!confirmerId) return { error: "Choose who confirms it." };
  const [reasons, statuses] = await Promise.all([getActiveSet("REASONS_FOR_ISSUE"), getActiveSet("STATUSES")]);
  const { purpose, status } = needDefaults(reasons, statuses);
  try {
    await api(projectPath(ctx, `/transmittals/${transmittalId}/activity-check`), {
      body: {
        confirmerId,
        documentIds: formData.getAll("documentIds").map(String).filter(Boolean),
        department: String(formData.get("department") ?? "") || null,
        departments: formData.has("departmentsGiven") ? formData.getAll("departments").map(String).filter(Boolean) : null,
        purpose, statuses: status ? [status] : [],
      },
    });
  } catch (e) {
    return { error: refusal(e).message };
  }
  refresh(code, transmittalId);
  return { ok: "Checked, and sent on to confirm." };
}

/** Whoever was asked confirms the request: what the control function checked is applied by itself. */
export async function confirmActionRequestAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const transmittalId = String(formData.get("transmittalId") ?? "");
  const code = String(formData.get("code") ?? "");
  try {
    await api(projectPath(ctx, `/transmittals/${transmittalId}/activity-confirm`), { method: "POST" });
  } catch (e) {
    return { error: refusal(e).message };
  }
  refresh(code, transmittalId);
  return { ok: "Confirmed, and applied." };
}

/** Whoever was asked refuses the request, saying why; nothing changes. */
export async function refuseActionRequestAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const transmittalId = String(formData.get("transmittalId") ?? "");
  const code = String(formData.get("code") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { error: "Say why it is refused; whoever asked reads it." };
  try {
    await api(projectPath(ctx, `/transmittals/${transmittalId}/activity-refuse`), { body: { note } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  refresh(code, transmittalId);
  return { ok: "Refused." };
}

/** Without a control function: someone adds their own discipline to an action that should concern it. */
export async function addOwnDisciplineAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const actionId = String(formData.get("actionId") ?? "");
  const code = String(formData.get("code") ?? "");
  try {
    await api(projectPath(ctx, `/activities/${actionId}/departments/own`), { method: "POST" });
  } catch (e) {
    return { error: refusal(e).message };
  }
  refresh(code);
  return { ok: "Added. Whoever plans the project is told." };
}
