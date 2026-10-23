"use server";

import { trimXer } from "@/lib/actions/xer";
import { revalidatePath } from "next/cache";
import { mayUploadLists } from "@/lib/core/permissions";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath, refusal } from "@/lib/client";
import { filesOf } from "@/lib/documents/api-uploads";
import { planLists, type PlanListKind } from "@/lib/actions/plan-lists";

type Result = { error?: string; ok?: string; link?: { href: string; label: string } };

/**
 * Upload the spreadsheet of the revision in force. Revisions are made on the
 * document's own page, never here: the list is read from this file and
 * recorded against the released revision, at once, all or nothing. The
 * uploader confirms the file is that revision's list as released, taking
 * responsibility for it matching, or says why it differs; either is kept in
 * the activity log.
 */
/** The placeholders a requirements list registered, found in the register by their numbers. */
const placeholders = (numbers: string[] | undefined) => numbers?.length
  ? { href: `/documents?q=${encodeURIComponent(numbers.join(", "))}`, label: `See the ${numbers.length} new placeholder${numbers.length === 1 ? "" : "s"} in the register →` }
  : undefined;

export async function uploadPlanListAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  if (!mayUploadLists(ctx.user.verbs)) return { error: "Your function does not upload the schedule's lists. The control function, or a function given Plan, does." };
  const kind = String(formData.get("kind") ?? "") as PlanListKind;
  const revisionId = String(formData.get("revisionId") ?? "");
  const confirmed = formData.get("confirmed") === "yes";
  const reason = String(formData.get("reason") ?? "").trim();
  const list = (await planLists(ctx)).find((one) => one.kind === kind);
  if (!list) return { error: "Unknown list." };
  const document = list.documents.find((one) => one.released?.id === revisionId);
  if (!document) return { error: `Choose the ${list.title.toLowerCase()} that is released.` };
  const rev = document.released!.value;
  if (!confirmed && !reason) return { error: `Tick that this file is the list of rev ${rev} as released, or say why it differs.` };
  // The schedule is read from a Primavera P6 export (.xer) too.
  const file = filesOf(formData, "file").find((one) => (kind === "SCHEDULE" ? /\.(xlsx|csv|xer)$/i : /\.(xlsx|csv)$/i).test(one.name)) ?? null;
  if (!file) return { error: kind === "SCHEDULE" ? "Choose the schedule as .xlsx, .csv or a P6 export (.xer)." : "Choose the list as .xlsx or .csv." };
  let summary = "";
  let registered: string[] = [];
  try {
    const raw = Buffer.from(await file.arrayBuffer());
    // A P6 export is sent with only the tables the schedule reads.
    const bytes = /\.xer$/i.test(file.name) ? trimXer(raw) : raw;
    ({ summary, registered } = await api<{ summary: string; registered: string[] }>(projectPath(ctx, "/schedule/lists"), {
      body: { kind, fileName: file.name, contentBase64: bytes.toString("base64"), revisionId, confirmed, reason: reason || null,
        p6Project: String(formData.get("p6Project") ?? "").trim() || null },
    }));
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/schedule");
  return { ok: `Read as the list of ${document.number} rev ${rev}. ${summary}`, link: placeholders(registered) };
}

/**
 * Upload a list with no document in the register: read and applied at once,
 * all or nothing. The uploader ticks that they know it is not a register
 * document and says why; that, their name and the file's fingerprint are kept
 * in the activity log.
 */
export async function uploadLooseListAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  if (!mayUploadLists(ctx.user.verbs)) return { error: "Your function does not upload the schedule's lists. The control function, or a function given Plan, does." };
  const kind = String(formData.get("kind") ?? "") as PlanListKind;
  const reason = String(formData.get("reason") ?? "").trim();
  // The schedule is read from a Primavera P6 export (.xer) too.
  const file = filesOf(formData, "file").find((one) => (kind === "SCHEDULE" ? /\.(xlsx|csv|xer)$/i : /\.(xlsx|csv)$/i).test(one.name)) ?? null;
  if (!file) return { error: kind === "SCHEDULE" ? "Choose the schedule as .xlsx, .csv or a P6 export (.xer)." : "Choose the list as .xlsx or .csv." };
  if (!reason) return { error: "Say why it is uploaded without a register document: it is kept with the upload." };
  let summary = "";
  let registered: string[] = [];
  try {
    const raw = Buffer.from(await file.arrayBuffer());
    // A P6 export is sent with only the tables the schedule reads.
    const bytes = /\.xer$/i.test(file.name) ? trimXer(raw) : raw;
    ({ summary, registered } = await api<{ summary: string; registered: string[] }>(projectPath(ctx, "/schedule/lists"), {
      body: { kind, fileName: file.name, contentBase64: bytes.toString("base64"), aware: true, reason,
        p6Project: String(formData.get("p6Project") ?? "").trim() || null },
    }));
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/schedule");
  return { ok: `Applied. ${summary}`, link: placeholders(registered) };
}

/**
 * Reads the schedule's released revision again (backend `POST /schedule/import?again=true`): its file as released, read
 * the way the app reads it now, for a schedule read before its WBS and what happened were kept.
 */
export async function readScheduleAgainAction(_prev: Result | undefined): Promise<Result> {
  const ctx = await requireScope();
  if (!mayUploadLists(ctx.user.verbs)) return { error: "The control function, or a function given Plan, reads the schedule again." };
  try {
    const read = await api<{ revision: string; summary: string }>(projectPath(ctx, "/schedule/import"), { method: "POST", query: { again: "true" } });
    revalidatePath("/schedule");
    return { ok: `Rev ${read.revision} read again: ${read.summary}` };
  } catch (e) {
    return { error: refusal(e).message };
  }
}
