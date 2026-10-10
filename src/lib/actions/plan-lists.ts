"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { api, projectPath, refusal } from "@/lib/api/client";
import { filesOf } from "@/lib/api/uploads";
import { planLists, type PlanListKind } from "@/lib/plan-lists";

type Result = { error?: string; ok?: string; link?: { href: string; label: string } };

/**
 * Upload the spreadsheet of the revision in force. Revisions are made on the
 * document's own page, never here: the list is read from this file and
 * recorded against the released revision, at once, all or nothing. The
 * uploader confirms the file is that revision's list as released, taking
 * responsibility for it matching, or says why it differs; either is kept in
 * the activity log.
 */
/** After a schedule is read: where its versions and moved dates are shown. */
const changes = (kind: PlanListKind) => kind === "SCHEDULE" ? { href: "/actions/schedules", label: "See what changed →" } : undefined;

/** The placeholders a requirements list registered, found in the register by their numbers. */
const placeholders = (numbers: string[] | undefined) => numbers?.length
  ? { href: `/documents?q=${encodeURIComponent(numbers.join(", "))}`, label: `See the ${numbers.length} new placeholder${numbers.length === 1 ? "" : "s"} in the register →` }
  : undefined;

export async function uploadPlanListAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL") && !ctx.can("PLAN")) return { error: "Your function does not upload the schedule's lists. Document Control, or a function given Plan, does." };
  const kind = String(formData.get("kind") ?? "") as PlanListKind;
  const revisionId = String(formData.get("revisionId") ?? "");
  const confirmed = formData.get("confirmed") === "yes";
  const reason = String(formData.get("reason") ?? "").trim();
  const list = (await planLists(ctx)).find((one) => one.kind === kind);
  if (!list) return { error: "Unknown list." };
  const document = list.documents.find((one) => one.released?.id === revisionId);
  if (!document) return { error: `Choose the ${list.title.toLowerCase()} in force.` };
  const rev = document.released!.value;
  if (!confirmed && !reason) return { error: `Tick that this file is the list of rev ${rev} as released, or say why it differs.` };
  const file = filesOf(formData, "file").find((one) => /\.(xlsx|csv)$/i.test(one.name)) ?? null;
  if (!file) return { error: "Choose the list as .xlsx or .csv." };
  let summary = "";
  let registered: string[] = [];
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    ({ summary, registered } = await api<{ summary: string; registered: string[] }>(projectPath(ctx, "/schedule/lists"), {
      body: { kind, fileName: file.name, contentBase64: bytes.toString("base64"), revisionId, confirmed, reason: reason || null },
    }));
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/actions");
  return { ok: `Read as the list of ${document.number} rev ${rev}. ${summary}`, link: placeholders(registered) ?? changes(kind) };
}

/**
 * Upload a list with no document in the register: read and applied at once,
 * all or nothing. The uploader ticks that they know it is not a register
 * document and says why; that, their name and the file's fingerprint are kept
 * in the activity log.
 */
export async function uploadLooseListAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL") && !ctx.can("PLAN")) return { error: "Your function does not upload the schedule's lists. Document Control, or a function given Plan, does." };
  const kind = String(formData.get("kind") ?? "") as PlanListKind;
  const reason = String(formData.get("reason") ?? "").trim();
  const file = filesOf(formData, "file").find((one) => /\.(xlsx|csv)$/i.test(one.name)) ?? null;
  if (!file) return { error: "Choose the list as .xlsx or .csv." };
  if (!reason) return { error: "Say why it is uploaded without a register document: it is kept with the upload." };
  let summary = "";
  let registered: string[] = [];
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    ({ summary, registered } = await api<{ summary: string; registered: string[] }>(projectPath(ctx, "/schedule/lists"), {
      body: { kind, fileName: file.name, contentBase64: bytes.toString("base64"), aware: true, reason },
    }));
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/actions");
  return { ok: `Applied. ${summary}`, link: placeholders(registered) ?? changes(kind) };
}
