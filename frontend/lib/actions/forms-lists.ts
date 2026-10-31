"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mayUploadLists } from "@/lib/core/permissions";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath, refusal } from "@/lib/client";
import { filesOf } from "@/lib/documents/api-uploads";
import { planLists, type PlanListKind } from "@/lib/actions/plan-lists";
import type { ListSourceKind } from "@/lib/actions/list-source-kinds";

type Result = { error?: string; ok?: string; link?: { href: string; label: string } };

/** A line of what a list would change: an action, or a discipline's need, before and after. */
export type ListChangeLine = { key: string; outcome: "NEW" | "UPDATE" | "REMOVED" | "SAME"; title: string; changes: { field: string; was: string | null; now: string | null }[] };
/** A list checked: what it would change and why it cannot be read; nothing written. */
/** A row of a disciplines or requirements file: its line, what it does, and why not. */
export type ListRow = { line: number; outcome: "NEW" | "UPDATE" | "SAME" | "PROBLEM" | "PENDING"; title: string; changes: { field: string; was: string | null; now: string | null }[]; problems: string[] };
/** The file as read: every row, the row its headings are on, and each row under them. */
export type ListSheet = { cells: string[][]; headerAt: number; headings: string[]; rows: ListRow[]; inherited?: number[] | null };
export type ListCheck = { kind: string; title: string; source: string | null; lines: ListChangeLine[]; problems: string[]; summary: string | null; new: number; updates: number; removed: number; same: number;
  sheet?: ListSheet | null };

/** The placeholders a requirements list registered, found in the register by their numbers. */
const placeholders = (numbers: string[] | undefined) => numbers?.length
  ? { href: `/documents?q=${encodeURIComponent(numbers.join(", "))}`, label: `See the ${numbers.length} new placeholder${numbers.length === 1 ? "" : "s"} in the register →` }
  : undefined;

/**
 * What is sent for a list, the same for its check and for applying it (owner: every import shows what it would do
 * first). Three ways: the spreadsheet of the released revision (the uploader vouches it matches, or says why it
 * differs), a file with no released document (with why), or the other source read again (`from`, with why: the
 * control function or whoever holds Manage).
 */
async function bodyOf(formData: FormData): Promise<{ body?: Record<string, unknown>; said?: string; error?: string }> {
  const ctx = await requireScope();
  const mode = String(formData.get("mode") ?? "document");
  const kind = String(formData.get("kind") ?? "") as PlanListKind;
  const reason = String(formData.get("reason") ?? "").trim();
  const p6Project = String(formData.get("p6Project") ?? "").trim() || null;
  if (mode === "switch") {
    if (!ctx.can("CONTROL") && !ctx.can("MANAGE")) return { error: "The control function, or whoever holds Manage, makes a list read from its other source." };
    const from = String(formData.get("from") ?? "");
    if (!reason) return { error: "Say why the list is read from its other source: it is kept with the read." };
    return { body: { kind, from, reason }, said: from === "DOCUMENT" ? "Read again from its register document." : "Read again from the file last uploaded." };
  }
  if (!mayUploadLists(ctx.user.verbs)) return { error: "Your function does not upload the schedule's lists. The control function, or a function given Plan, does." };
  // The schedule is read from a Primavera P6 export (.xer) too.
  const file = filesOf(formData, "file").find((one) => (kind === "SCHEDULE" ? /\.(xlsx|csv|xer)$/i : /\.(xlsx|csv)$/i).test(one.name)) ?? null;
  if (!file) return { error: kind === "SCHEDULE" ? "Choose the schedule as .xlsx, .csv or a P6 export (.xer)." : "Choose the list as .xlsx or .csv." };
  // Sent whole: it is kept as it came, to be downloaded as it is.
  const contentBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  if (mode === "loose") {
    if (!reason) return { error: "Say why it is uploaded without a register document: it is kept with the upload." };
    return { body: { kind, fileName: file.name, contentBase64, aware: true, reason, p6Project }, said: "Applied." };
  }
  const revisionId = String(formData.get("revisionId") ?? "");
  const confirmed = formData.get("confirmed") === "yes";
  const list = (await planLists(ctx)).find((one) => one.kind === kind);
  if (!list) return { error: "Unknown list." };
  const document = list.documents.find((one) => one.released?.id === revisionId);
  if (!document) return { error: `Choose the ${list.title.toLowerCase()} that is released.` };
  const rev = document.released!.value;
  if (!confirmed && !reason) return { error: `Tick that this file is the list of rev ${rev} as released, or say why it differs.` };
  return { body: { kind, fileName: file.name, contentBase64, revisionId, confirmed, reason: reason || null, p6Project }, said: `Read as the list of ${document.number} rev ${rev}.` };
}

/** What the list would change, line by line, read exactly as applying it would and undone: nothing is written. */
export async function checkListAction(formData: FormData): Promise<{ check?: ListCheck; error?: string }> {
  const ctx = await requireScope();
  const { body, error } = await bodyOf(formData);
  if (!body) return { error };
  try {
    return { check: await api<ListCheck>(projectPath(ctx, "/schedule/lists/check"), { body }) };
  } catch (e) {
    return { error: refusal(e).message };
  }
}

/**
 * The list read and applied, all or nothing, once its check was seen. The uploader's word (it is the released
 * revision's list as released, or why it differs; or why there is no document; or why the other source) is kept in
 * the activity log.
 */
export async function applyListAction(formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const { body, said, error } = await bodyOf(formData);
  if (!body) return { error };
  let summary = "";
  let registered: string[] = [];
  try {
    ({ summary, registered } = await api<{ summary: string; registered: string[] }>(projectPath(ctx, "/schedule/lists"), { body }));
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/schedule");
  return { ok: `${said} ${summary}`, link: placeholders(registered) };
}

/**
 * The register document a list is read from, chosen in the register by the control function (owner: chosen, never
 * designated by the app). Logged with what it was before; back to the page the list is brought in on.
 */
export async function chooseListSourceAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL")) return { error: "The control function chooses which register document a list is read from." };
  const kind = String(formData.get("kind") ?? "") as ListSourceKind;
  const documentId = String(formData.get("documentId") ?? "") || null;
  const back = String(formData.get("back") ?? "") === "import" ? "/import" : "/schedule";
  if (!documentId) return { error: "Tick the document that holds the list." };
  try {
    await api(projectPath(ctx, `/lists/sources/${kind}`), { method: "PUT", body: { documentId, reason: String(formData.get("reason") ?? "").trim() || null } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(back);
  redirect(back);
}

/** A list of Import & export brought in: from its register document's released revision, or from a file uploaded. */
export async function listBroughtAction(kind: ListSourceKind, from: "DOCUMENT" | "UPLOAD", revisionId: string | null, label: string | null): Promise<void> {
  const ctx = await requireScope();
  await api(projectPath(ctx, `/lists/sources/${kind}/brought`), { body: { from, revisionId, label } }).catch(() => undefined);
  revalidatePath("/import");
  revalidatePath("/");
}
