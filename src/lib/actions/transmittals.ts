"use server";

import { redirect } from "next/navigation";
import { requireScope } from "@/lib/scope";
import { revalidatePath } from "next/cache";
import { isController, isAdmin } from "@/lib/auth";
import { audit, notify, notifyMany } from "@/lib/audit";
import { getActiveSet } from "@/lib/config";
import { ENCLOSURE_CONDITIONS } from "@/lib/standard";
import { issueGateError, openReviewCycle } from "@/lib/lifecycle";
import type { Tenant } from "@/lib/scope";
import { enforce } from "@/lib/rules/preflight";
import { nextRecordNumber } from "@/lib/numbering-records";

/**
 * The number a transmittal is raised under: built from the organization's own
 * scheme when one is routed for transmittals, and from the short form when none
 * is. Sender and receiver are party codes, so the same handover reads the same
 * from both ends.
 */
async function nextTransmittalNumber(t: Tenant, facts: { project: string; sender: string | null; receiver: string | null; reason: string }): Promise<string> {
  return nextRecordNumber(t, "TRANSMITTAL", facts, "TR");
}

/** A party's published code, which is what a number carries — never its name. */
async function partyCode(t: Tenant, name: string | null | undefined): Promise<string | null> {
  if (!name) return null;
  const party = await t.db.party.findFirst({ where: { name }, select: { code: true } });
  return party?.code ?? null;
}

// G.2 steps 5–8 / G.5 steps 1 — the control function raises the transmittal (§11.13).
export async function createTransmittalAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
 if (!isController(user) && !isAdmin(user)) return { error: "Information shall not leave (or enter) control other than by a transmittal raised by the control function." };
  const direction = String(formData.get("direction") ?? "OUTGOING");
  const reasonForIssue = String(formData.get("reasonForIssue") ?? "");
  const dateOfIssue = String(formData.get("dateOfIssue") ?? "");
  // Who issued it. For what we send that is us; for what arrives it is them.
  const ourParty = await db.party.findFirst({ where: { isInternal: true }, select: { name: true } });
  const issuingParty = direction === "INCOMING"
    ? String(formData.get("issuingParty") ?? "").trim() || "Unnamed party"
    : ourParty?.name ?? user.organization ?? "Our organization";
  const notes = String(formData.get("notes") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim() || null;
  const message = String(formData.get("message") ?? "").trim() || null;
  const revisionIds = formData.getAll("revisionIds").map(String).filter(Boolean);
  const recipientUsers = [...new Set(formData.getAll("recipientUsers").map(String).filter(Boolean))];
  // Copied in: told, and able to open it, but not asked to do anything — so a
  // transmittal is never "seen" because one of them looked.
  const copyUsers = [...new Set(formData.getAll("copyUsers").map(String).filter(Boolean))]
    .filter((one) => !recipientUsers.includes(one));
  const issueNow = formData.get("issueNow") === "on";
  // The transmittal this one answers, where it is an answer. Correspondence
  // reads as a thread: the question keeps its number, and so does the answer.
  const inReplyToId = String(formData.get("inReplyTo") ?? "").trim() || null;

 if (!reasonForIssue) return { error: "Every transmittal states its reason for issue." };
 if (!dateOfIssue) return { error: "Date of issue is required." };
 // A transmittal with nothing enclosed is ordinary correspondence — a
 // clarification, a notice, an answer — and is allowed, so long as it says
 // something. What it may never be is empty of both documents and words.
 if (!revisionIds.length && !message && !subject) return { error: "Enclose at least one revision, or write a subject and a message — a transmittal cannot be empty of both." };
 if (!recipientUsers.length) return { error: "Name at least one person to send it to — a company on its own is not a recipient." };
  if (direction === "OUTGOING" && !subject) return { error: "Give the transmittal a subject — it is the first thing the recipient reads." };

  const reasons = await getActiveSet("REASONS_FOR_ISSUE");
  const reason = reasons.find((r) => r.code === reasonForIssue);
 if (!reason) return { error: "Reason for issue is not in the defined set." };

  // §11.3 / B.8.2 — what may be issued
  const statuses = await getActiveSet("STATUSES");
  const execStatuses = new Set(statuses.filter((s) => s.props.executionFlag === true).map((s) => s.code));
  if (direction === "OUTGOING") {
    for (const rid of revisionIds) {
      const rev = await db.revision.findUnique({ where: { id: rid }, include: { document: true } });
      if (!rev) return { error: "A listed revision no longer exists." };
      const err = issueGateError(rev.state, false);
      if (err) return { error: `${rev.document.docNumber} rev ${rev.value}: ${err}` };
      // §7.8 — execution requires an execution-permitting status (blocked here, not just flagged by ST-13)
      if (reasonForIssue === "EXECUTION" && rev.statusCode && !execStatuses.has(rev.statusCode)) {
 return { error: `${rev.document.docNumber} rev ${rev.value} is at ${rev.statusCode}, which does not permit physical execution.` };
      }
    }
  }

  const responseRequired = reason.props.response === true;
  const responsePeriodDays = responseRequired ? Number(reason.props.responsePeriodDays ?? 14) : null;
  const base = new Date(dateOfIssue);
  const responseDueDate = responseRequired && responsePeriodDays ? new Date(base.getTime() + responsePeriodDays * 86400000) : null;

  // The number is built before the record, from the parties it travels between.
  const internalParty = await db.party.findFirst({ where: { isInternal: true }, select: { code: true } });
  const recipientParties = recipientUsers.length
    ? await db.user.findMany({ where: { id: { in: [...recipientUsers, ...copyUsers] } }, select: { party: { select: { code: true } } } })
    : [];
  const receiverCodes = [...new Set(recipientParties.map((person) => person.party?.code).filter((code): code is string => !!code))];
  const project = await db.project.findUnique({ where: { id: projectId }, select: { code: true } });
  const transmittalNumber = await nextTransmittalNumber(ctx, {
    project: project?.code ?? "",
    sender: direction === "OUTGOING" ? internalParty?.code ?? null : await partyCode(ctx, issuingParty),
    receiver: direction === "OUTGOING" ? (receiverCodes.length === 1 ? receiverCodes[0] : receiverCodes.length ? "MULTI" : null) : internalParty?.code ?? null,
    reason: reasonForIssue,
  });

  const t = await db.transmittal.create({
    data: {
      projectId,
      number: transmittalNumber,
      direction,
      reasonForIssue,
      dateOfIssue: base,
      issuingParty,
      responseRequired,
      responsePeriodDays,
      responseDueDate,
      status: "DRAFT",
      receivedDate: direction === "INCOMING" ? base : null,
      receivedByParty: direction === "INCOMING" ? user.organization ?? "DELIOS" : null,
      subject,
      message,
      inReplyToId,
      acceptanceNotes: direction === "INCOMING" ? notes || null : null,
      createdById: user.id,
      createdByName: user.name,
      items: { create: revisionIds.map((rid) => ({ projectId, revisionId: rid })) },
      recipients: {
        create: [
          ...recipientUsers.map((uid) => ({ projectId, userId: uid, name: "—", kind: "TO" })),
          ...copyUsers.map((uid) => ({ projectId, userId: uid, name: "—", kind: "CC" })),
        ],
      },
    },
  });
  // The recipient carries the name and company their account holds.
  const chosen = await db.user.findMany({ where: { id: { in: [...recipientUsers, ...copyUsers] } }, include: { party: { select: { name: true } } } });
  for (const u of chosen) {
    await db.transmittalRecipient.updateMany({ where: { transmittalId: t.id, userId: u.id }, data: { name: u.name, organization: u.party?.name ?? u.organization ?? issuingParty } });
  }
  await audit({
    actor: user,
    action: "TRANSMITTAL_RAISED",
    entityType: "Transmittal",
    entityId: t.id,
    entityLabel: t.number,
 detail: `${direction.toLowerCase()} · reason: ${reason.label} · ${revisionIds.length} item(s) · ${recipientUsers.length} recipient(s)${copyUsers.length ? `, ${copyUsers.length} copied in` : ""}${inReplyToId ? " · an answer" : ""}.`,
  });
  // What arrives is a record of something that already happened, so it is issued
  // on creation. What we send is sent when we say so — here, or later from the
  // transmittal itself.
  if (direction === "INCOMING") await db.transmittal.update({ where: { id: t.id }, data: { status: "ISSUED" } });
  else if (issueNow) {
    const sent = await issueTransmittal(ctx, t.id);
    if (sent.error) redirect(`/transmittals/${t.id}?issueError=${encodeURIComponent(sent.error)}`);
  }
  // Incoming documents are reviewed through a route once accepted (§11.11):
  // Document Control sends them from the transmittal, like any other review.
  redirect(`/transmittals/${t.id}`);
}

export async function issueTransmittalAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  return issueTransmittal(ctx, String(formData.get("transmittalId") ?? ""));
}

/** Issuing is the act that sends it: the date stands, the recipients are told, and it becomes evidence. */
async function issueTransmittal(ctx: Awaited<ReturnType<typeof requireScope>>, id: string): Promise<{ error?: string }> {
  const { user, db, projectId, orgId } = ctx;
  try {
    await enforce("ISSUE", { transmittalId: id }, ctx);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Issue blocked." };
  }
  const t = await db.transmittal.findUniqueOrThrow({ where: { id }, include: { items: { include: { revision: { include: { document: true } } } }, recipients: true } });
  if (t.status !== "DRAFT") return { error: "Transmittal already issued." };
  // re-check the gate at issue time
  for (const item of t.items) {
    const err = issueGateError(item.revision.state, item.markedSuperseded);
    if (err) return { error: `${item.revision.document.docNumber} rev ${item.revision.value}: ${err}` };
  }
  const issuedAt = new Date();
  await db.$transaction([
    db.transmittal.update({ where: { id }, data: { status: "ISSUED" } }),
    db.transmittalRecipient.updateMany({
      where: { transmittalId: id, userId: { not: null } },
      data: { notifiedAt: issuedAt },
    }),
  ]);
 await audit({ actor: user, action: "ISSUE", entityType: "Transmittal", entityId: id, entityLabel: t.number, detail: "Issued to recipients." });
  await notifyMany(
    t.recipients.map((r) => r.userId).filter((x): x is string => !!x),
    "TRANSMITTAL",
    `Transmittal ${t.number} issued to you`,
    `${t.items.length} item(s), reason: ${t.reasonForIssue}${t.responseDueDate ? ` — response due ${t.responseDueDate.toDateString()}` : ""}`,
    `/transmittals/${t.id}`
  );
  revalidatePath(`/transmittals/${id}`);
  return {};
}

/** G.5 — acceptance check against the published conditions (§11.9). Failing transmittals are rejected with reason. */
export async function acceptanceCheckAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const id = String(formData.get("transmittalId") ?? "");
  try {
    await enforce("ACCEPT_TRANSMITTAL", { transmittalId: id }, ctx);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Acceptance blocked." };
  }
  const notes = String(formData.get("notes") ?? "").trim();
  const t = await db.transmittal.findUniqueOrThrow({ where: { id }, include: { items: true, recipients: true } });
  if (t.status !== "ISSUED") return { error: "Only an issued transmittal can be accepted or rejected." };

  // A transmittal with nothing enclosed is checked on the conditions that can
  // be checked; the ones about enclosures are recorded as not applicable, so
  // the record says why they were not answered rather than leaving them blank.
  const enclosed = t.items.length > 0;
  const conditions = ["a", "b", "c", "d", "e"].map((k) => (
    !enclosed && (ENCLOSURE_CONDITIONS as readonly string[]).includes(k)
      ? { key: k, pass: true, notApplicable: true }
      : { key: k, pass: formData.get(`cond_${k}`) === "on" }
  ));

  const allPass = conditions.every((c) => c.pass);
  if (!allPass && !notes) return { error: "Tell the sender why it is rejected — they will see this." };
  // §11.12 — response periods run from ACCEPTANCE, not receipt or issue
  const reasons = await getActiveSet("REASONS_FOR_ISSUE");
  const reasonRow = reasons.find((r) => r.code === t.reasonForIssue);
  const responseDays = Number(reasonRow?.props ? ((reasonRow.props as Record<string, unknown>).responsePeriodDays as number | undefined) ?? 14 : 14);
  const responseDueDate = allPass && t.responseRequired ? new Date(Date.now() + responseDays * 86400000) : t.responseDueDate;
  await db.transmittal.update({
    where: { id },
    data: {
      status: allPass ? "ACCEPTED" : "REJECTED",
      responseDueDate,
      conditionsResult: JSON.stringify(conditions),
      checkedByName: user.name,
      acceptanceCheckedAt: new Date(),
      acceptanceNotes: notes || null,
      rejectionReason: allPass ? null : notes,
    },
  });
  await audit({
    actor: user,
    action: allPass ? "TRANSMITTAL_ACCEPTED" : "TRANSMITTAL_REJECTED",
    entityType: "Transmittal",
    entityId: id,
    entityLabel: t.number,
 detail: allPass ? "All acceptance conditions satisfied.": `Rejected — conditions ${conditions.filter((c) => !c.pass).map((c) => c.key).join(", ")} failed; the published consequence applies.`,
  });

  // G.5 step 3 — the issuing party is notified of a rejection
  if (!allPass) {
    // The sender is who raised an incoming transmittal (a supplier submitting
    // through its package); for others, whoever it was addressed to.
    await notifyMany(
      t.direction === "INCOMING" ? [t.createdById] : t.recipients.map((r) => r.userId).filter((x): x is string => !!x),
      "TRANSMITTAL_REJECTED",
      `Transmittal ${t.number} rejected`,
      notes,
      `/transmittals/${t.id}`
    );
  }
  // transmittals with no review obligation are complete on acceptance (§11.11)
  if (allPass && (reasonRow?.props as Record<string, unknown> | undefined)?.reviewCycle !== true) {
    await db.transmittal.update({ where: { id }, data: { status: "CLOSED" } });
  }
  // §11.11 — where the reason requires review, Document Control sends the
  // accepted documents down a review route from the transmittal page.
  revalidatePath(`/transmittals/${id}`);
  return {};
}



/**
 * Telling again the people who have not opened it.
 *
 * A transmittal is evidence that named people were told. They are told once
 * when it is issued, and nothing in the record says what happens when somebody
 * simply never looks — so this says it: they are told again, on a day, and that
 * day is kept. Only the people it was addressed to are chased; somebody copied
 * in owes nothing.
 */
export async function chaseTransmittalAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const id = String(formData.get("transmittalId") ?? "");
  if (!(isController(user) || isAdmin(user))) return { error: "Document Control chases a transmittal." };

  const t = await db.transmittal.findUniqueOrThrow({ where: { id }, include: { recipients: true } });
  if (t.status === "DRAFT") return { error: "Nothing has been sent yet." };

  const waiting = t.recipients.filter((one) => one.kind !== "CC" && !one.openedAt && one.userId);
  if (!waiting.length) return { error: "Everybody it was addressed to has opened it." };

  const now = new Date();
  await db.transmittalRecipient.updateMany({ where: { id: { in: waiting.map((one) => one.id) } }, data: { notifiedAt: now } });
  await notifyMany(
    waiting.map((one) => one.userId).filter((one): one is string => !!one),
    "TRANSMITTAL_CHASED",
    `Transmittal ${t.number} is still waiting for you`,
    t.subject ?? `Sent ${t.dateOfIssue.toISOString().slice(0, 10)}`,
    `/transmittals/${t.id}`,
  );
  await audit({
    actor: user,
    action: "TRANSMITTAL_CHASED",
    entityType: "Transmittal",
    entityId: id,
    entityLabel: t.number,
    detail: `Told again: ${waiting.map((one) => one.name).join(", ")}.`,
  });
  revalidatePath(`/transmittals/${id}`);
  return {};
}

/**
 * Closing it deliberately.
 *
 * Until now a transmittal closed only as a side effect of being accepted, which
 * left everything else open for ever. Closing says the exchange is finished:
 * what was asked for came back, or nothing more is expected.
 */
export async function closeTransmittalAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const id = String(formData.get("transmittalId") ?? "");
  if (!(isController(user) || isAdmin(user))) return { error: "Document Control closes a transmittal." };

  const t = await db.transmittal.findUniqueOrThrow({ where: { id }, include: { answers: { select: { id: true } } } });
  if (t.status === "DRAFT") return { error: "A draft has not been sent, so there is nothing to close." };
  if (t.status === "CLOSED") return { error: "It is already closed." };
  if (t.responseRequired && !t.answers.length) {
    return { error: "An answer was asked for and none has come back. Raise the answer against it first — Reply, on the transmittal — or record that none came." };
  }

  await db.transmittal.update({ where: { id }, data: { status: "CLOSED" } });
  await audit({
    actor: user,
    action: "TRANSMITTAL_CLOSED",
    entityType: "Transmittal",
    entityId: id,
    entityLabel: t.number,
    detail: t.answers.length ? `Closed after ${t.answers.length} answer(s).` : "Closed — nothing further was expected.",
  });
  revalidatePath(`/transmittals/${id}`);
  return {};
}
