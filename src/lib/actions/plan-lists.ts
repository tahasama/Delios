"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { api, projectPath, refusal } from "@/lib/api/client";
import { upload, filesOf } from "@/lib/api/uploads";
import { planLists, type PlanListKind } from "@/lib/plan-lists";

type Result = { error?: string };

/**
 * Upload one of the schedule's lists: a new revision of its document, carrying
 * the file. Nothing changes yet. The revision goes on to review and release like
 * any document, and releasing it is the approval that puts the list in force.
 * The first schedule upload also names that document as the project's schedule.
 */
export async function uploadPlanListAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  if (!ctx.can("PLAN") && !ctx.can("CONTROL") && !ctx.can("CONFIGURE")) return { error: ctx.why("CONTROL") };
  const kind = String(formData.get("kind") ?? "") as PlanListKind;
  const documentId = String(formData.get("documentId") ?? "");
  const changeDescription = String(formData.get("changeDescription") ?? "").trim();
  const files = filesOf(formData, "file");

  const list = (await planLists(ctx)).find((one) => one.kind === kind);
  if (!list) return { error: "Unknown list." };
  const document = list.documents.find((one) => one.id === documentId);
  if (!document) return { error: `Choose the ${list.title.toLowerCase()} document.` };
  if (!files.length) return { error: "Choose the file to upload." };
  if (!files.some((file) => /\.(xlsx|csv)$/i.test(file.name))) return { error: "Include the list as .xlsx or .csv: that is the file the system reads." };
  if (!files.some((file) => /\.pdf$/i.test(file.name))) return { error: "Include a PDF of the list too: that is what the reviewers read." };
  if (!changeDescription) return { error: "Say what changed in this version." };

  try {
    if (kind === "SCHEDULE") {
      const { source } = await api<{ source: { documentId: string } | null }>(projectPath(ctx, "/schedule"));
      if (!source) await api(projectPath(ctx, "/schedule"), { method: "PUT", body: { documentId } });
    }
    // A revision still being prepared takes the files; one in review must be decided first; otherwise a new one starts.
    const view = await api<{ revisions: { id: string; value: string; state: string }[] }>(projectPath(ctx, `/documents/${documentId}`));
    const latest = view.revisions.at(-1) ?? null;
    if (latest?.state === "IN_REVIEW") return { error: `Rev ${latest.value} is in review. Release or return it first; then upload the next version.` };
    const open = latest && ["IN_PREPARATION", "CORRECTING", "RECEIVED"].includes(latest.state) ? latest : null;
    const fileIds = await Promise.all(files.map((file) => upload(ctx, { documentId }, file)));
    if (open) await api(projectPath(ctx, `/documents/${documentId}/revisions/${open.id}/files`), { body: { fileIds } });
    else await api(projectPath(ctx, `/documents/${documentId}/revisions`), { body: { fileIds, changeDescription, filesLater: false } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/actions");
  // The new revision is sent for review from its own page, like any other.
  redirect(`/documents/${documentId}`);
}
