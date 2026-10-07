"use server";

import { revalidatePath } from "next/cache";
import { api, refusal } from "@/lib/api/client";
import { requireSession, projectPath } from "@/lib/session";
import type { ActResult } from "./document-acts";

/**
 * A review's acts, through the backend: commenting, settling a comment,
 * answering a step (or recording another organization's answer), sending a
 * step to that organization, releasing, returning and sending the route back.
 * Each returns the backend's refusal as a message to show.
 */

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim() || null;

async function act(form: FormData, path: string, body: unknown, done: string): Promise<ActResult> {
  const session = await requireSession();
  const reviewId = String(form.get("reviewId"));
  try {
    await api(projectPath(session, `/reviews/${reviewId}${path}`), { body });
  } catch (e) {
    return { ok: false, message: refusal(e).message };
  }
  revalidatePath(`/reviews/${reviewId}`);
  return { ok: true, message: done };
}

export async function commentAction(_prev: ActResult | undefined, form: FormData): Promise<ActResult> {
  const step = text(form, "closesWithStep");
  return act(form, "/comments", { text: text(form, "text"), class: text(form, "class"), closesWithStep: step ? Number(step) : null }, "Comment added.");
}

export async function closeCommentAction(_prev: ActResult | undefined, form: FormData): Promise<ActResult> {
  return act(form, `/comments/${form.get("commentId")}/close`, { resolution: text(form, "resolution") }, "Comment settled.");
}

export async function answerAction(_prev: ActResult | undefined, form: FormData): Promise<ActResult> {
  const evidence = text(form, "evidenceFileId");
  return act(form, "/answer", {
    verdict: text(form, "verdict"), status: text(form, "status"), note: text(form, "note"),
    foreignAnswer: text(form, "foreignAnswer"), evidenceFileId: evidence,
  }, "Answer recorded.");
}

export async function dispatchAction(_prev: ActResult | undefined, form: FormData): Promise<ActResult> {
  return act(form, "/dispatch", { channel: text(form, "channel"), reference: text(form, "reference") }, "Recorded as sent.");
}

export async function releaseAction(_prev: ActResult | undefined, form: FormData): Promise<ActResult> {
  return act(form, "/release", { outcome: text(form, "outcome") }, "Released.");
}

export async function returnAction(_prev: ActResult | undefined, form: FormData): Promise<ActResult> {
  const step = text(form, "toStep");
  return act(form, "/return", { note: text(form, "note"), toStep: step ? Number(step) : null, reason: text(form, "reason"), outcome: text(form, "outcome") }, "Sent back.");
}

export async function rewindAction(_prev: ActResult | undefined, form: FormData): Promise<ActResult> {
  return act(form, "/rewind", { toStep: Number(form.get("toStep")), reason: text(form, "reason"), note: text(form, "note") }, "The route went back.");
}
