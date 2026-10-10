"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { api, projectPath, refusal } from "@/lib/api/client";
import { upload, filesOf } from "@/lib/api/uploads";
import { planLists, type PlanListKind } from "@/lib/plan-lists";

type Result = { error?: string; ok?: string };

/**
 * Upload one of the schedule's lists as its document's next version. Nothing
 * changes yet: the revision goes on to review and release like any document,
 * and releasing it is the approval that puts the list in force. Files added to
 * a revision still in preparation, rather than starting a new one, carry the
 * uploader's reason, kept in the activity log. The first schedule upload also
 * names that document as the project's schedule.
 */
export async function uploadPlanListAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  if (!ctx.can("PLAN") && !ctx.can("CONTROL") && !ctx.can("CONFIGURE")) return { error: ctx.why("CONTROL") };
  const kind = String(formData.get("kind") ?? "") as PlanListKind;
  const documentId = String(formData.get("documentId") ?? "");
  const why = String(formData.get("why") ?? "").trim();
  const files = filesOf(formData, "file");

  const list = (await planLists(ctx)).find((one) => one.kind === kind);
  if (!list) return { error: "Unknown list." };
  const document = list.documents.find((one) => one.id === documentId);
  if (!document) return { error: `Choose the ${list.title.toLowerCase()} document.` };
  if (!files.length) return { error: "Choose the file to upload." };
  if (!files.some((file) => /\.(xlsx|csv)$/i.test(file.name))) return { error: "Include the list as .xlsx or .csv: that is the file the system reads." };
  if (!files.some((file) => /\.pdf$/i.test(file.name))) return { error: "Include a PDF of the list too: that is what the reviewers read." };

  try {
    const view = await api<{ revisions: { id: string; value: string; state: string }[] }>(projectPath(ctx, `/documents/${documentId}`));
    const latest = view.revisions.at(-1) ?? null;
    if (latest?.state === "IN_REVIEW") return { error: `Rev ${latest.value} is in review. Upload the next version once it is released or returned.` };
    const open = latest?.state === "IN_PREPARATION" ? latest : null;
    if (open && !why) return { error: `Say why these files go onto rev ${open.value}: it is kept as proof.` };
    if (kind === "SCHEDULE") {
      const { source } = await api<{ source: { documentId: string } | null }>(projectPath(ctx, "/schedule"));
      if (!source) await api(projectPath(ctx, "/schedule"), { method: "PUT", body: { documentId } });
    }
    const fileIds = await Promise.all(files.map((file) => upload(ctx, { documentId }, file)));
    if (open) await api(projectPath(ctx, `/documents/${documentId}/revisions/${open.id}/files`), { body: { fileIds, changeDescription: why } });
    else await api(projectPath(ctx, `/documents/${documentId}/revisions`), { body: { fileIds, filesLater: false } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/actions");
  // The revision is sent for review from its own page, like any other.
  redirect(`/documents/${documentId}`);
}

/**
 * Upload a list with no document in the register: read and applied at once,
 * all or nothing. The uploader ticks that they know it is not a register
 * document and says why; that, their name and the file's fingerprint are kept
 * in the activity log.
 */
export async function uploadLooseListAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL")) return { error: "Document Control uploads a list without a register document." };
  const kind = String(formData.get("kind") ?? "") as PlanListKind;
  const aware = formData.get("aware") === "yes";
  const reason = String(formData.get("reason") ?? "").trim();
  const file = filesOf(formData, "file").find((one) => /\.(xlsx|csv)$/i.test(one.name)) ?? null;
  if (!file) return { error: "Choose the list as .xlsx or .csv." };
  if (!aware) return { error: "Tick that you know this list is not a document in the register." };
  if (!reason) return { error: "Say why it is uploaded without a register document: it is kept with the upload." };
  let summary = "";
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    ({ summary } = await api<{ summary: string }>(projectPath(ctx, "/schedule/lists"), {
      body: { kind, fileName: file.name, contentBase64: bytes.toString("base64"), aware, reason },
    }));
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/actions");
  return { ok: `Applied. ${summary}` };
}
