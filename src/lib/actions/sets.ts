"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { audit } from "@/lib/audit";
import { parseCsv } from "@/lib/csv";
import { summariseDiff, type DiffLine } from "@/lib/controlled/registry";
import { valueSet } from "@/lib/controlled/handlers";

/**
 * Sets are set up by the administrator, on one page, by hand or from a
 * spreadsheet. A spreadsheet is previewed first — what it adds, changes and
 * retires — and applies when the administrator confirms. There is no second
 * approver: the sets are agreed in the DMP, which is approved as a document.
 */
export type SetUploadState = {
  error?: string;
  ok?: string;
  issues?: { line: number; message: string }[];
  preview?: { setKey: string; fileName: string; payload: string; diff: DiffLine[]; summary: string };
};

export async function previewSetUploadAction(_prev: SetUploadState | undefined, formData: FormData): Promise<SetUploadState> {
  const ctx = await requireScope();
  if (!ctx.can("CONFIGURE")) return { error: ctx.why("CONFIGURE") };
  const setKey = String(formData.get("setKey") ?? "");
  const file = formData.get("file") as File | null;
  if (!setKey) return { error: "Choose the set first." };
  if (!file || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > 5_000_000) return { error: "That file is over 5 MB." };
  const parsed = await valueSet.parse(ctx, parseCsv(await file.text()), setKey);
  if (!parsed.ok) return { error: `${parsed.issues.length} problem${parsed.issues.length === 1 ? "" : "s"} in the file — nothing was changed.`, issues: parsed.issues };
  const diff = valueSet.diff(await valueSet.current(ctx, setKey), parsed.payload);
  const summary = summariseDiff(diff);
  return { preview: { setKey, fileName: file.name, payload: JSON.stringify(parsed.payload), diff: diff.filter((l) => l.change !== "UNCHANGED"), summary } };
}

export async function applySetUploadAction(_prev: SetUploadState | undefined, formData: FormData): Promise<SetUploadState> {
  const ctx = await requireScope();
  if (!ctx.can("CONFIGURE")) return { error: ctx.why("CONFIGURE") };
  const setKey = String(formData.get("setKey") ?? "");
  const fileName = String(formData.get("fileName") ?? "");
  let payload: unknown;
  try { payload = JSON.parse(String(formData.get("payload") ?? "[]")); } catch { return { error: "The preview expired — upload the file again." }; }
  // Re-check what is about to be written, so a tampered preview cannot slip through.
  const rows = payload as { code: string; label: string; status: string; sort: number; props: string | null }[];
  const recheck = await valueSet.parse(ctx, [["Code", "Label", "Status", "Sort", "Properties"], ...rows.map((r) => [r.code, r.label, r.status, String(r.sort), r.props ?? ""])], setKey);
  if (!recheck.ok) return { error: "The preview no longer checks out — upload the file again.", issues: recheck.issues };
  const { summary } = await valueSet.apply(ctx, recheck.payload, setKey, fileName);
  await audit({ actor: ctx.user, action: "CONFIG_SET_UPLOADED", entityType: "ConfigSet", entityId: setKey, entityLabel: setKey, detail: `${fileName}: ${summary}` });
  revalidatePath("/admin/config");
  return { ok: `${setKey} updated from ${fileName}: ${summary}` };
}
