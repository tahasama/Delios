"use server";

import { redirect } from "next/navigation";
import { requireScope } from "@/lib/core/scope";
import { revalidatePath } from "next/cache";
import { formPolicy, checkForm } from "@/lib/settings/field-policy";
import { getActiveSet } from "@/lib/settings/config";
import { api, projectPath, refusal } from "@/lib/client";
import { filesOf, upload } from "@/lib/documents/api-uploads";
import { addressees, dispatchOf, transmittalPage } from "@/lib/transmittals/api";
import type { TransmittalView } from "@/lib/types";
import { once } from "@/lib/core/once";

/** A day the form says, as the backend takes it: empty when today's, which the backend stamps itself. */
function dayOf(value: string): string | null {
  if (!value) return null;
  return value === new Date().toISOString().slice(0, 10) ? null : value;
}

// G.2 steps 5–8 / G.5 steps 1 — the control function raises the transmittal (§11.13).
export async function createTransmittalAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user } = ctx;
  const direction = String(formData.get("direction") ?? "OUTGOING");
  const reasonForIssue = String(formData.get("reasonForIssue") ?? "");
  const dateOfIssue = String(formData.get("dateOfIssue") ?? "");
  const issuingParty = String(formData.get("issuingParty") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim() || null;
  const message = String(formData.get("message") ?? "").trim() || null;
  const revisionIds = formData.getAll("revisionIds").map(String).filter(Boolean);
  // A supplier's documents asked of them as placeholders (outgoing only).
  const placeholderIds = direction === "OUTGOING" ? [...new Set(formData.getAll("placeholderIds").map(String).filter(Boolean))] : [];
  // A supplier's documents it holds, asked back for an update on this transmittal (outgoing only).
  const askBackIds = direction === "OUTGOING" ? [...new Set(formData.getAll("askBackIds").map(String).filter(Boolean))] : [];
  // What came with something received that is not in the register: their
  // letter, the email, the files they attached.
  const attachments = direction === "INCOMING" ? filesOf(formData, "attachments") : [];
  const chosenTo = [...new Set(formData.getAll("recipientUsers").map(String).filter(Boolean))];
  const chosenCc = [...new Set(formData.getAll("copyUsers").map(String).filter(Boolean))].filter((one) => !chosenTo.includes(one));
  // An organization with no accounts here is chosen as "party:<id>".
  const isParty = (one: string) => one.startsWith("party:");
  const recipientUsers = chosenTo.filter((one) => !isParty(one));
  const partyTo = chosenTo.filter(isParty).map((one) => one.slice(6));
  const issueNow = formData.get("issueNow") === "on";
  const inReplyToId = String(formData.get("inReplyTo") ?? "").trim() || null;
  const followsId = String(formData.get("followsId") ?? "").trim() || null;
  const followKind = String(formData.get("followKind") ?? "").trim() || null;
  const activityId = String(formData.get("activityId") ?? "").trim() || null;
  const activityAsk = String(formData.get("activityAsk") ?? "").trim() || null;

  if (!reasonForIssue) return { error: "Every transmittal states its reason for issue." };
  if (!dateOfIssue) return { error: "Date of issue is required." };
  if (!revisionIds.length && !placeholderIds.length && !attachments.length && !message && !subject) return { error: "Enclose at least one revision, or write a subject and a message — a transmittal cannot be empty of both." };
  if (direction === "OUTGOING" && !recipientUsers.length && !partyTo.length) return { error: "Name at least one person to send it to — a company on its own is not a recipient." };
  if (direction === "OUTGOING" && !subject) return { error: "Give the transmittal a subject — it is the first thing the recipient reads." };
  if (askBackIds.length && !issueNow) return { error: "Asking for documents back goes with the transmittal: send it now rather than keeping a draft." };
  if (askBackIds.length && !message) return { error: "Say in the message why you need them back: the supplier reads it with the ask." };
  // Copies are our own people; an organization is sent to, never copied.
  if (chosenCc.some(isParty)) return { error: "Copy people in, not organizations: send to an organization instead." };

  const reasons = await getActiveSet("REASONS_FOR_ISSUE");
  if (!reasons.some((r) => r.code === reasonForIssue)) return { error: "Reason for issue is not in the defined set." };

  // What this organization asks when a transmittal is raised.
  const policy = await formPolicy(ctx, "TRANSMITTAL");
  const asked = checkForm(
    "TRANSMITTAL",
    policy,
    { recipients: [...recipientUsers, ...partyTo], reason: reasonForIssue, subject, message, cc: [], files: "", responseBy: "" },
    (n) => String(formData.get(n) ?? ""),
    // A received transmittal has no subject of ours: the form does not ask it.
    direction === "INCOMING" ? ["reason", "message"] : ["reason", "subject", "message", "responseBy"],
  );
  if (asked.error) return { error: asked.error };
  const extras = Object.fromEntries(Object.entries(asked.extras).filter(([, value]) => !!value));

  let landing: string;
  try {
    if (direction === "INCOMING") {
      // What arrived from another organization. Their own people send it
      // themselves; the control function records it for one working outside the system.
      let fromPartyId: string | undefined;
      if (user.isInternal) {
        const found = (await addressees(ctx)).parties
          .find((one) => one.id === issuingParty || one.name.toLowerCase() === issuingParty.toLowerCase() || one.code.toLowerCase() === issuingParty.toLowerCase());
        if (!found) return { error: `${issuingParty || "That company"} is not an organization set up on this project.` };
        fromPartyId = found.id;
      }
      // Each file that came is something unplanned, waiting for Document
      // Control to register it under our numbering.
      const unplanned = [];
      for (const file of attachments) {
        const fileId = await upload(ctx, { loose: true }, file);
        unplanned.push({ title: file.name.replace(/\.[^.]+$/, ""), fileIds: [fileId] });
      }
      const t = await api<TransmittalView>(projectPath(ctx, "/transmittals/incoming"), {
        body: {
          reason: reasonForIssue, message, revisionIds, unplanned, fromPartyId, note: notes || null, userIds: recipientUsers,
          receivedOn: dayOf(dateOfIssue), inReplyToId, extras: Object.keys(extras).length ? extras : null,
        },
        idempotencyKey: once(formData, "incoming") ?? crypto.randomUUID(),
      });
      landing = `/transmittals/${t.id}`;
    } else {
      // One transmittal to our own people chosen, and one to each organization; those copied in are on each.
      const sent = await api<{ id: string; number: string; toName: string }[]>(projectPath(ctx, "/transmittals"), {
        body: {
          revisionIds, userIds: recipientUsers, partyIds: partyTo, reason: reasonForIssue, subject, message, copyUserIds: chosenCc,
          draft: !issueNow, inReplyToId, followsId, followKind, issuedOn: dayOf(dateOfIssue), extras: Object.keys(extras).length ? extras : null, activityId, activityAsk,
          placeholderIds: placeholderIds.length ? placeholderIds : null,
          // Asked for an answer: by the day given, else as the reason allows. Not ticked: none asked.
          responseRequired: formData.get("answerRequired") === "on",
          responseDue: formData.get("answerRequired") === "on" ? String(formData.get("responseDue") ?? "") || null : null,
        },
        idempotencyKey: once(formData, "compose") ?? crypto.randomUUID(),
      });
      landing = sent.length === 1 ? `/transmittals/${sent[0].id}` : `/transmittals?q=${encodeURIComponent(sent.map((one) => one.number).join(","))}`;
      // The ask itself, on each document: the supplier accepts or refuses it there, and the transmittal is its record.
      for (const documentId of askBackIds) {
        await api(projectPath(ctx, `/documents/${documentId}/asks`), { body: { note: `${message} (${sent.map((one) => one.number).join(", ")})` } });
      }
    }
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/transmittals");
  redirect(landing);
}

/** A draft is issued as it stands, checked again today; it becomes numbered transmittals. */
export async function issueTransmittalAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const id = String(formData.get("transmittalId") ?? "");
  let sent: { id: string; number: string }[];
  try {
    sent = await api(projectPath(ctx, `/transmittals/${id}/issue`), { method: "POST", idempotencyKey: once(formData, "issue") });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/transmittals");
  redirect(sent.length === 1 ? `/transmittals/${sent[0].id}` : `/transmittals?q=${encodeURIComponent(sent.map((one) => one.number).join(","))}`);
}

/**
 * What arrived is accepted or returned by the control function on arrival: each
 * submission it carried is checked, and a return says why, for the sender to
 * read. Something unplanned is registered on its own, from its file.
 */
export async function acceptTransmittalAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const id = String(formData.get("transmittalId") ?? "");
  const reject = formData.get("decision") === "reject";
  const notes = String(formData.get("notes") ?? "").trim();
  if (reject && !notes) return { error: "Say why it is rejected — the sender reads this." };
  const page = await transmittalPage(ctx, id);
  if (!page) return { error: "That transmittal no longer exists." };
  const waiting = page.carried.filter((one) => one.arrival?.state === "TO_CHECK");
  if (!waiting.length) {
    return page.files.length && page.status === "ISSUED"
      ? { error: "What is left on it came unplanned: match each to one of ours, or make it a document." }
      : { error: "Only a transmittal waiting to be checked can be accepted or rejected." };
  }
  // Returned to the sender to correct under the same revision, as the organization words it.
  const outcome = reject
    ? (await getActiveSet("CONTROL_OUTCOMES")).filter((one) => one.props.act === "return")
        .sort((a, b) => Number(b.props.to === "sender" && b.props.newRevision !== true) - Number(a.props.to === "sender" && a.props.newRevision !== true))[0]?.code
    : undefined;
  // Where the organization published no return outcome, it is returned to the sender all the same.
  try {
    for (const item of waiting) {
      await api(projectPath(ctx, `/revisions/${item.revisionId}/arrival`), { body: { outcome, note: notes || null, return: reject && !outcome }, idempotencyKey: once(formData, `arrival-${item.revisionId}`) });
    }
  } catch (e) {
    return { error: refusal(e).message };
  } finally {
    revalidatePath(`/transmittals/${id}`);
  }
  return {};
}

/**
 * Equivalence: something unplanned that arrived is one of our documents. What came becomes that document's (a new
 * submission of the revision being prepared, else its next revision); their number is kept beside ours.
 */
export async function matchItemAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const id = String(formData.get("transmittalId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const documentId = String(formData.get("documentId") ?? "");
  if (!documentId) return { error: "Find the document of ours it is in the register, and choose it." };
  try {
    await api(projectPath(ctx, `/transmittals/${id}/items/${itemId}/match`), { body: { documentId } });
  } catch (e) {
    return { error: refusal(e).message };
  } finally {
    revalidatePath(`/transmittals/${id}`);
  }
  return { ok: "Matched." };
}

/**
 * What came into a package taking documents as they come: accepted, each is in the register as it came (their number,
 * revision, status, review outcome); returned, nothing is registered and they are told why.
 */
export async function checkAsReceivedAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const id = String(formData.get("transmittalId") ?? "");
  const reject = formData.get("decision") === "reject";
  const notes = String(formData.get("notes") ?? "").trim();
  if (reject && !notes) return { error: "Say what is wrong — the sender reads this." };
  try {
    await api(projectPath(ctx, `/transmittals/${id}/as-received`), { body: { return: reject, note: notes || null } });
  } catch (e) {
    return { error: refusal(e).message };
  } finally {
    revalidatePath(`/transmittals/${id}`);
  }
  return {};
}

/** Adding to what came with a received transmittal, after it was recorded. */
export async function attachTransmittalFilesAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const id = String(formData.get("transmittalId") ?? "");
  const files = formData.getAll("attachments").filter((one): one is File => one instanceof File && one.size > 0);
  if (!files.length) return { error: "Choose the files to keep with it." };
  try {
    // What arrived stays as it was; these are kept beside it, said to be added later.
    const fileIds = await Promise.all(files.map((file) => upload(ctx, { loose: true }, file)));
    await api(projectPath(ctx, `/transmittals/${id}/attachments`), { body: { fileIds } });
  } catch (e) {
    return { error: refusal(e).message };
  } finally {
    revalidatePath(`/transmittals/${id}`);
  }
  return { ok: files.length === 1 ? "Kept with it." : `${files.length} files kept with it.` };
}

/**
 * Notifying again the people who have not opened it.
 */
export async function chaseTransmittalAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const id = String(formData.get("transmittalId") ?? "");
  const recipientIds = formData.getAll("recipientIds").map(String).filter(Boolean);
  try {
    await api(projectPath(ctx, `/transmittals/${id}/notify-again`), { body: { recipientIds }, idempotencyKey: once(formData, "notify") });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(`/transmittals/${id}`);
  return {};
}

/**
 * An organization with no accounts here cannot open a transmittal, so it is not
 * seen: one of our people sends it to them outside the system — by email, or
 * through a system of theirs — and records here that it went, with the proof.
 * That record is what stands in for "seen" on that row.
 */
export async function markRecipientSentAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const recipientId = String(formData.get("recipientId") ?? "");
  const channel = String(formData.get("channel") ?? "").trim();
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const when = String(formData.get("sentOn") ?? "").trim();
  if (!channel) return { error: "Say how it went to them." };

  // Whoever carries the exchange with that organization has it waiting for them.
  const transmittalId = await dispatchOf(ctx, recipientId).catch(() => null);
  if (!transmittalId) return { error: "Only whoever carries the exchange with that organization records that it went, once." };
  try {
    // It leaves our system here, so what proves it left is the record.
    const [proof] = filesOf(formData, "evidence");
    const proofFileId = proof ? await upload(ctx, { transmittalId }, proof) : null;
    await api(projectPath(ctx, `/transmittals/${transmittalId}/recipients/${recipientId}/dispatch`), {
      body: { channel, reference, proofFileId, dispatchedOn: dayOf(when) },
    });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(`/transmittals/${transmittalId}`);
  return { ok: "Recorded as sent." };
}
