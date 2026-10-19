"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath, refusal } from "@/lib/client";

type State = { error?: string; ok?: string };

/** Equivalence: another organization's number for this document, matched to ours by hand. */
export async function addNumberAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const documentId = String(formData.get("documentId") ?? "");
  const partyId = String(formData.get("partyId") ?? "");
  const number = String(formData.get("number") ?? "").trim();
  if (!partyId || !number) return { error: "Say whose number it is, and write it." };
  try {
    await api(projectPath(ctx, `/documents/${documentId}/numbers`), { body: { partyId, number } });
  } catch (e) {
    return { error: refusal(e).message };
  } finally {
    revalidatePath(`/documents/${documentId}`);
  }
  return { ok: "Kept beside ours." };
}

/** A matched number taken back, with why; kept, struck through. */
export async function takeBackNumberAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const documentId = String(formData.get("documentId") ?? "");
  const id = String(formData.get("equivalentId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "Say why it is taken back." };
  try {
    await api(projectPath(ctx, `/documents/${documentId}/numbers/${id}/take-back`), { body: { reason } });
  } catch (e) {
    return { error: refusal(e).message };
  } finally {
    revalidatePath(`/documents/${documentId}`);
  }
  return {};
}
