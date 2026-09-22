"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { isController } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { untoldRecipients } from "@/lib/supersession";
import { getActiveSet } from "@/lib/config";
import { createTransmittalAction } from "@/lib/actions/transmittals";

type State = { error?: string; ok?: string };

/**
 * Prepare the transmittal that puts the current revision in the hands of
 * everyone who still has the replaced one. It opens as a draft for Document
 * Control to check and issue; once issued, the risk clears by itself.
 */
export async function sendCurrentRevisionAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  if (!isController(ctx.user)) return { error: "Document Control issues transmittals." };
  const oldId = String(formData.get("revisionId") ?? "");
  const item = (await untoldRecipients(ctx)).find((u) => u.old.id === oldId);
  if (!item) return { error: "Everyone who received that revision has already been told." };
  if (!item.current) return { error: "There is no released revision to send yet." };
  if (item.draft) return { error: `${item.draft.number} already carries it — open it and issue it.` };

  // Same reason as the original issue, unless the current status no longer supports it.
  const reasons = await getActiveSet("REASONS_FOR_ISSUE");
  const statuses = await getActiveSet("STATUSES");
  const executes = statuses.find((s) => s.code === item.current!.statusCode)?.props.executionFlag === true;
  const reason = reasons.find((r) => r.code === item.reason && (r.code !== "EXECUTION" || executes))?.code ?? reasons.find((r) => r.code === "INFORMATION")?.code ?? reasons[0]?.code;

  const form = new FormData();
  form.set("direction", "OUTGOING");
  form.set("reasonForIssue", reason ?? "");
  form.set("dateOfIssue", new Date().toISOString().slice(0, 10));
  form.set("notes", `Rev ${item.current.value} supersedes rev ${item.old.value} of ${item.document.docNumber}, which you received on ${[...new Set(item.recipients.map((r) => r.via))].join(", ")}. Stop using rev ${item.old.value}.`);
  form.append("revisionIds", item.current.id);
  for (const r of item.recipients) form.append("recipientNames", r.organization ? `${r.name} (${r.organization})` : r.name);
  // Redirects to the new draft transmittal.
  return createTransmittalAction(undefined, form);
}

/** Record that the recipients were told another way — a meeting, a letter — and how. */
export async function recordToldAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const { db, user, projectId } = ctx;
  if (!isController(user)) return { error: "Document Control records this." };
  const oldId = String(formData.get("revisionId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { error: "Say how they were told — e.g. \"Site meeting 22 Sept, minutes MIN-014\"." };
  const item = (await untoldRecipients(ctx)).find((u) => u.old.id === oldId);
  if (!item) return { error: "Everyone who received that revision has already been told." };
  const record = await db.obsolescenceRecord.findFirst({ where: { kind: "SUPERSEDED", revisionId: oldId }, orderBy: { createdAt: "desc" } });
  const data = { toldAt: new Date(), toldByName: user.name, toldNote: note };
  if (record) await db.obsolescenceRecord.update({ where: { id: record.id }, data });
  else await db.obsolescenceRecord.create({ data: { projectId, kind: "SUPERSEDED", documentId: item.document.id, revisionId: oldId, reason: `Superseded by rev ${item.current?.value ?? "?"}`, authorityName: user.name, createdById: user.id, ...data } });
  await audit({ actor: user, action: "SUPERSESSION_TOLD", entityType: "Revision", entityId: oldId, entityLabel: `${item.document.docNumber} rev ${item.old.value}`, detail: `${item.recipients.map((r) => r.name).join(", ")} — ${note}` });
  revalidatePath("/exposures");
  return { ok: "Recorded." };
}
