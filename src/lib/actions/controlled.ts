"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { api, projectPath, refusal } from "@/lib/api/client";
import { controlledVersions, type ControlledRow } from "@/lib/api/records";
import { parseCsv } from "@/lib/csv";
import { handlerFor, summariseDiff, canDecide, canSubmit, type DiffLine } from "@/lib/controlled/registry";
import "@/lib/controlled/handlers";

export type ControlledState = {
  error?: string;
  ok?: string;
  /** Row-level problems, so a rejected upload says exactly what to fix. */
  issues?: { line: number; message: string }[];
};

/**
 * The change-control workflow, written once for every kind of controlled
 * configuration. Upload produces a draft with its diff already computed;
 * submitting hands it to an approver; approving applies it and supersedes
 * whatever was in force. Nothing reaches the live tables without a recorded
 * decision (§14.7). The backend keeps the versions and their decisions.
 */

type Version = ControlledRow;

async function versionOf(ctx: { projectId: string }, id: string): Promise<Version | null> {
  const all = [...(await controlledVersions(null)), ...(await controlledVersions(ctx))];
  return all.find((one) => one.id === id) ?? null;
}

/** Upload a file and hold it as a draft, with the change already described. */
export async function uploadControlledVersionAction(_prev: ControlledState | undefined, formData: FormData): Promise<ControlledState> {
  const ctx = await requireScope();
  const kind = String(formData.get("kind") ?? "");
  const key = String(formData.get("key") ?? "default").trim() || "default";
  const versionLabel = String(formData.get("versionLabel") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const file = formData.get("file") as File | null;

  const handler = handlerFor(kind);
  if (!handler) return { error: "Unknown kind of controlled configuration." };
  if (!ctx.can("CONFIGURE") && !ctx.can("CONTROL") && !(handler.ownerVerb && ctx.can(handler.ownerVerb))) return { error: ctx.why("CONFIGURE") };
  if (!versionLabel) return { error: "Give this version a label — it is how the change is referred to afterwards." };
  if (!file || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > 5_000_000) return { error: "That file is over 5 MB. Filter it before uploading." };

  const text = await file.text();
  const parsed = await handler.parse(ctx, parseCsv(text), key);
  if (!parsed.ok) return { error: `${parsed.issues.length} problem${parsed.issues.length === 1 ? "" : "s"} — nothing was saved.`, issues: parsed.issues };

  const diff = handler.diff(await handler.current(ctx, key), parsed.payload);
  const path = handler.level === "PROJECT" ? projectPath(ctx, "/controlled") : "/api/controlled";
  try {
    await api(path, {
      body: {
        kind, key, title: key === "default" ? handler.title : `${handler.title} — ${key}`, versionLabel, payload: parsed.payload, diff,
        rowCount: parsed.rowCount, sourceName: file.name, sourceSize: file.size, sourceHash: createHash("sha256").update(text).digest("hex"), notes,
      },
    });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/controlled", "layout");
  return { ok: `${versionLabel} uploaded as a draft: ${summariseDiff(diff)}. ${handler.ownerApproves ? "Check the change, then approve it." : "Review the change, then submit it for approval."}` };
}

/** Hand a draft to whoever approves this kind. */
export async function submitControlledVersionAction(_prev: ControlledState | undefined, formData: FormData): Promise<ControlledState> {
  const ctx = await requireScope();
  const version = await versionOf(ctx, String(formData.get("versionId") ?? ""));
  if (!version) return { error: "That version no longer exists." };
  const handler = handlerFor(version.kind);
  if (!handler) return { error: "Unknown kind of controlled configuration." };
  const allowed = canSubmit({ state: version.state, mayChange: ctx.can("CONFIGURE") || ctx.can("CONTROL") || (!!handler.ownerVerb && ctx.can(handler.ownerVerb)) });
  if (!allowed.ok) return { error: allowed.error };
  try {
    await api(`/api/controlled/${version.id}/submit`, { method: "POST" });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/controlled", "layout");
  return { ok: `${version.versionLabel} submitted for approval.` };
}

/**
 * Approve and apply, or reject. §14.7 — the decision is recorded with its date
 * and reason, and the version that was in force is superseded rather than erased.
 */
export async function decideControlledVersionAction(_prev: ControlledState | undefined, formData: FormData): Promise<ControlledState> {
  const ctx = await requireScope();
  const { user } = ctx;
  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const version = await versionOf(ctx, String(formData.get("versionId") ?? ""));
  if (!version) return { error: "That version no longer exists." };
  const handler = handlerFor(version.kind);
  if (!handler) return { error: "Unknown kind of controlled configuration." };

  // A list its owner approves goes from draft straight to a decision.
  const ownDraft = !!handler.ownerApproves && version.state === "DRAFT";
  const allowed = canDecide({
    state: ownDraft ? "SUBMITTED" : version.state,
    submittedById: ownDraft ? user.id : version.submittedById,
    userId: user.id,
    mayConfigure: ctx.can("CONFIGURE"),
    ownerApproves: handler.ownerApproves,
    mayControl: ctx.can("CONTROL") || (!!handler.ownerVerb && ctx.can(handler.ownerVerb)),
  });
  if (!allowed.ok) return { error: allowed.error };

  if (decision === "REJECT") {
    if (!reason) return { error: "A rejection is recorded with its reason." };
    try {
      await api(`/api/controlled/${version.id}/decide`, { body: { approve: false, reason } });
    } catch (e) {
      return { error: refusal(e).message };
    }
    revalidatePath("/settings/controlled", "layout");
    return { ok: `${version.versionLabel} rejected. Nothing changed.` };
  }
  if (decision !== "APPROVE") return { error: "Choose approve or reject." };

  let result: { summary: string };
  try {
    // Applied first: a version is approved only once what it says is in force.
    result = await handler.apply(ctx, version.payload, version.key, version.versionLabel);
    await api(`/api/controlled/${version.id}/decide`, { body: { approve: true, reason, appliedSummary: result.summary } });
  } catch (e) {
    return { error: e instanceof Error && !(e as { status?: number }).status ? e.message : refusal(e).message };
  }
  revalidatePath("/settings/controlled", "layout");
  revalidatePath("/actions", "layout");
  return { ok: `${version.versionLabel} approved and in force. ${result.summary}` };
}

/** Withdraw a draft that was uploaded in error. It is kept on record, marked so. */
export async function discardControlledVersionAction(_prev: ControlledState | undefined, formData: FormData): Promise<ControlledState> {
  const ctx = await requireScope();
  const version = await versionOf(ctx, String(formData.get("versionId") ?? ""));
  if (!version) return { error: "That version no longer exists." };
  if (version.state !== "DRAFT") return { error: "Only a draft can be discarded. A submitted version is decided, and a decided one is kept." };
  try {
    await api(`/api/controlled/${version.id}/discard`, { method: "POST" });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/controlled", "layout");
  return { ok: `Draft ${version.versionLabel} discarded.` };
}

export async function readDiff(json: string | null): Promise<DiffLine[]> {
  if (!json) return [];
  try {
    const raw = JSON.parse(json) as unknown;
    return Array.isArray(raw) ? (raw as DiffLine[]) : [];
  } catch {
    return [];
  }
}
