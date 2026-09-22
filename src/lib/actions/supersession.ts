"use server";

import { requireScope } from "@/lib/scope";
import { isController } from "@/lib/auth";
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
