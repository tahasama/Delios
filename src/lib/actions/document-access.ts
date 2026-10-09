"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { api, projectPath, refusal } from "@/lib/api/client";

/**
 * Who may read a document that is above the open confidentiality levels.
 *
 * The people who may read it are named one by one, and only by whoever is
 * answerable for the content — the person who registered it, and whoever
 * authored or uploaded a revision of it — plus an administrator, who reads
 * everything anyway. A reader's own function, however senior, names nobody.
 * The backend keeps the list and applies the rule.
 */

type State = { error?: string; message?: string };

export async function addDocumentReaderAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const documentId = String(formData.get("documentId") ?? "");
  const userIds = [...new Set(formData.getAll("userId").map(String).filter(Boolean))];
  if (!userIds.length) return { error: "Say who." };
  let answer: { added: string[]; already: string[] };
  try {
    answer = await api(projectPath(ctx, `/documents/${documentId}/readers`), {
      body: { userIds, reason: String(formData.get("reason") ?? "").trim() || null },
    });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(`/documents/${documentId}`);
  if (!answer.added.length) return { message: `${answer.already.join(", ")} ${answer.already.length === 1 ? "was" : "were"} already on the list.` };
  return { message: `${answer.added.join(", ")} may read it.` };
}

export async function removeDocumentReaderAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const accessId = String(formData.get("accessId") ?? "");
  try {
    await api(projectPath(ctx, `/document-readers/${accessId}`), { method: "DELETE" });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/documents", "layout");
  return {};
}
