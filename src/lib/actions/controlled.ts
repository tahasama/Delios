"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { audit, notifyMany } from "@/lib/audit";
import { parseCsv } from "@/lib/csv";
import { handlerFor, summariseDiff, canDecide, canSubmit, type DiffLine } from "@/lib/controlled/registry";
import "@/lib/controlled/handlers";
import { holdersOf } from "@/lib/permissions";

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
 * decision (§14.7).
 */

/** Upload a file and hold it as a draft, with the change already described. */
export async function uploadControlledVersionAction(
  _prev: ControlledState | undefined,
  formData: FormData,
): Promise<ControlledState> {
  const ctx = await requireScope();
  const { db, user, orgId } = ctx;

  const kind = String(formData.get("kind") ?? "");
  const key = String(formData.get("key") ?? "default").trim() || "default";
  const versionLabel = String(formData.get("versionLabel") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const file = formData.get("file") as File | null;

  const handler = handlerFor(kind);
  if (!handler) return { error: "Unknown kind of controlled configuration." };
  if (!ctx.can("CONFIGURE") && !ctx.can("CONTROL") && !(handler.ownerVerb && ctx.can(handler.ownerVerb))) {
    return { error: ctx.why("CONFIGURE") };
  }
  if (!versionLabel) return { error: "Give this version a label — it is how the change is referred to afterwards." };
  if (!file || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > 5_000_000) return { error: "That file is over 5 MB. Filter it before uploading." };

  const text = await file.text();
  const parsed = await handler.parse(ctx, parseCsv(text), key);
  if (!parsed.ok) {
    return {
      error: `${parsed.issues.length} problem${parsed.issues.length === 1 ? "" : "s"} — nothing was saved.`,
      issues: parsed.issues,
    };
  }

  const projectId = handler.level === "PROJECT" ? ctx.projectId : null;
  const set =
    (await db.controlledSet.findFirst({ where: { kind, key, projectId } })) ??
    (await db.controlledSet.create({
      data: { orgId, projectId, kind, key, title: key === "default" ? handler.title : `${handler.title} — ${key}` },
    }));

  const clash = await db.controlledVersion.findFirst({ where: { setId: set.id, versionLabel } });
  if (clash) return { error: `Version ${versionLabel} already exists here. Labels are never reused.` };

  const pending = await db.controlledVersion.findFirst({
    where: { setId: set.id, state: { in: ["DRAFT", "SUBMITTED"] } },
  });
  if (pending) {
    return { error: `${pending.versionLabel} is already ${pending.state.toLowerCase()} here. Decide on it before uploading another.` };
  }

  const current = await handler.current(ctx, key);
  const diff = handler.diff(current, parsed.payload);

  const version = await db.controlledVersion.create({
    data: {
      setId: set.id,
      versionLabel,
      state: "DRAFT",
      payload: JSON.stringify(parsed.payload),
      diff: JSON.stringify(diff),
      rowCount: parsed.rowCount,
      sourceName: file.name,
      sourceSize: file.size,
      sourceHash: createHash("sha256").update(text).digest("hex"),
      notes,
    },
  });

  await audit({
    actor: user,
    action: "CONTROLLED_VERSION_UPLOADED",
    entityType: "ControlledVersion",
    entityId: version.id,
    entityLabel: `${handler.title} ${versionLabel}`,
    detail: `${parsed.rowCount} row(s); ${summariseDiff(diff)}. Held as a draft — nothing is in force yet.`,
  });
  revalidatePath("/admin/controlled");
  return { ok: `${versionLabel} uploaded as a draft: ${summariseDiff(diff)}. ${handler.ownerApproves ? "Check the change, then approve it." : "Review the change, then submit it for approval."}` };
}

/** Hand a draft to whoever approves this kind. */
export async function submitControlledVersionAction(
  _prev: ControlledState | undefined,
  formData: FormData,
): Promise<ControlledState> {
  const ctx = await requireScope();
  const { db, user } = ctx;
  const versionId = String(formData.get("versionId") ?? "");

  const version = await db.controlledVersion.findFirst({ where: { id: versionId, set: { orgId: ctx.orgId } }, include: { set: true } });
  if (!version) return { error: "That version no longer exists." };
  const handler = handlerFor(version.set.kind);
  if (!handler) return { error: "Unknown kind of controlled configuration." };

  const allowed = canSubmit({ state: version.state, mayChange: ctx.can("CONFIGURE") || ctx.can("CONTROL") || (!!handler.ownerVerb && ctx.can(handler.ownerVerb)) });
  if (!allowed.ok) return { error: allowed.error };

  await db.controlledVersion.update({
    where: { id: versionId },
    data: { state: "SUBMITTED", submittedById: user.id, submittedByName: user.name, submittedAt: new Date() },
  });

  // Whoever may approve this needs to know it is waiting.
  const approvers = await holdersOf(ctx, handler.ownerApproves ? "CONTROL" : "CONFIGURE");
  await notifyMany(
    approvers.map((a) => a.id).filter((id) => id !== user.id),
    "CONTROLLED_SUBMITTED",
    `${handler.title} ${version.versionLabel} awaits approval`,
    `${user.name} submitted a change of ${version.rowCount} row(s).`,
    "/admin/controlled",
  );

  await audit({
    actor: user, action: "CONTROLLED_VERSION_SUBMITTED", entityType: "ControlledVersion", entityId: versionId,
    entityLabel: `${handler.title} ${version.versionLabel}`,
    detail: `Submitted for approval by ${handler.approverHint} (${handler.clause}).`,
  });
  revalidatePath("/admin/controlled");
  return { ok: `${version.versionLabel} submitted for approval.` };
}

/**
 * Approve and apply. §14.7 — the decision is recorded with its date and
 * reason, and the version that was in force is superseded rather than erased.
 */
export async function decideControlledVersionAction(
  _prev: ControlledState | undefined,
  formData: FormData,
): Promise<ControlledState> {
  const ctx = await requireScope();
  const { db, user } = ctx;

  const versionId = String(formData.get("versionId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;

  const version = await db.controlledVersion.findFirst({ where: { id: versionId, set: { orgId: ctx.orgId } }, include: { set: true } });
  if (!version) return { error: "That version no longer exists." };
  const handler = handlerFor(version.set.kind);
  if (!handler) return { error: "Unknown kind of controlled configuration." };

  // The authority for this decision, not merely whoever is signed in (§14.7),
  // and never the person who proposed it (§8.3).
  // A list its owner approves goes from draft straight to a decision: the
  // upload and the approval are the same person's, recorded as both.
  const ownDraft = !!handler.ownerApproves && version.state === "DRAFT";
  if (ownDraft) {
    await db.controlledVersion.update({ where: { id: versionId }, data: { state: "SUBMITTED", submittedById: user.id, submittedByName: user.name, submittedAt: new Date() } });
    version.state = "SUBMITTED";
    version.submittedById = user.id;
  }
  const allowed = canDecide({
    state: version.state,
    submittedById: version.submittedById,
    userId: user.id,
    mayConfigure: ctx.can("CONFIGURE"),
    ownerApproves: handler.ownerApproves,
    mayControl: ctx.can("CONTROL") || (!!handler.ownerVerb && ctx.can(handler.ownerVerb)),
  });
  if (!allowed.ok) return { error: allowed.error };

  if (decision === "REJECT") {
    if (!reason) return { error: "A rejection is recorded with its reason." };
    await db.controlledVersion.update({
      where: { id: versionId },
      data: { state: "REJECTED", decidedById: user.id, decidedByName: user.name, decidedAt: new Date(), decisionReason: reason },
    });
    if (version.submittedById) {
      await notifyMany([version.submittedById], "CONTROLLED_REJECTED",
        `${handler.title} ${version.versionLabel} was not approved`, reason, "/admin/controlled");
    }
    await audit({
      actor: user, action: "CONTROLLED_VERSION_REJECTED", entityType: "ControlledVersion", entityId: versionId,
      entityLabel: `${handler.title} ${version.versionLabel}`, detail: reason,
    });
    revalidatePath("/admin/controlled");
    return { ok: `${version.versionLabel} rejected. Nothing changed.` };
  }

  if (decision !== "APPROVE") return { error: "Choose approve or reject." };

  let payload: unknown;
  try {
    payload = JSON.parse(version.payload);
  } catch {
    return { error: "That version's content could not be read back. Upload it again." };
  }

  const result = await handler.apply(ctx, payload, version.set.key, version.versionLabel);

  const now = new Date();
  await db.controlledVersion.updateMany({
    where: { setId: version.setId, state: "APPROVED" },
    data: { state: "SUPERSEDED", supersededAt: now },
  });
  await db.controlledVersion.update({
    where: { id: versionId },
    data: {
      state: "APPROVED",
      decidedById: user.id,
      decidedByName: user.name,
      decidedAt: now,
      decisionReason: reason,
      appliedAt: now,
    },
  });

  if (version.submittedById && version.submittedById !== user.id) {
    await notifyMany([version.submittedById], "CONTROLLED_APPROVED",
      `${handler.title} ${version.versionLabel} approved`, result.summary, "/admin/controlled");
  }
  await audit({
    actor: user, action: "CONTROLLED_VERSION_APPROVED", entityType: "ControlledVersion", entityId: versionId,
    entityLabel: `${handler.title} ${version.versionLabel}`,
    newValue: result.summary,
    detail: `Approved by ${user.name}${reason ? ` — ${reason}` : ""}. ${result.summary} (${handler.clause}).`,
  });

  revalidatePath("/admin/controlled");
  revalidatePath("/admin/functions");
  revalidatePath("/admin/config");
  revalidatePath("/actions");
  revalidatePath("/actions/requirements");
  return { ok: `${version.versionLabel} approved and in force. ${result.summary}` };
}

/** Withdraw a draft that was uploaded in error. */
export async function discardControlledVersionAction(
  _prev: ControlledState | undefined,
  formData: FormData,
): Promise<ControlledState> {
  const ctx = await requireScope();
  const { db, user } = ctx;
  const versionId = String(formData.get("versionId") ?? "");

  const version = await db.controlledVersion.findFirst({ where: { id: versionId, set: { orgId: ctx.orgId } }, include: { set: true } });
  if (!version) return { error: "That version no longer exists." };
  if (version.state !== "DRAFT") {
    return { error: "Only a draft can be discarded. A submitted version is decided, and a decided one is kept." };
  }
  const owner = handlerFor(version.set.kind)?.ownerVerb;
  if (!ctx.can("CONFIGURE") && !ctx.can("CONTROL") && !(owner && ctx.can(owner))) return { error: ctx.why("CONFIGURE") };

  await db.controlledVersion.delete({ where: { id: versionId } });
  await audit({
    actor: user, action: "CONTROLLED_VERSION_DISCARDED", entityType: "ControlledVersion", entityId: versionId,
    entityLabel: `${version.set.title} ${version.versionLabel}`, detail: "Draft discarded before submission.",
  });
  revalidatePath("/admin/controlled");
  return { ok: `Draft ${version.versionLabel} discarded.` };
}

/** Parsed diff for rendering. */
export async function readDiff(json: string | null): Promise<DiffLine[]> {
  if (!json) return [];
  try {
    const raw = JSON.parse(json) as unknown;
    return Array.isArray(raw) ? (raw as DiffLine[]) : [];
  } catch {
    return [];
  }
}
