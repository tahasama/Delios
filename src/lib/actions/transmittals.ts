"use server";

import { redirect } from "next/navigation";
import { requireScope } from "@/lib/scope";
import { revalidatePath } from "next/cache";
import { formPolicy, checkForm } from "@/lib/field-policy";
import { getActiveSet } from "@/lib/config";
import { api, projectPath, refusal } from "@/lib/api/client";
import { filesOf, upload } from "@/lib/api/uploads";
import { addressees, dispatchOf, legacyTransmittal } from "@/lib/api/transmittals";
import type { TransmittalView } from "@/lib/api/types";

/**
 * The backend records a transmittal on the day it is sent or received: a day
 * other than today cannot be written on it. A day either side is let through,
 * since the person's today and the project's may differ.
 */
function notToday(value: string): boolean {
  if (!value) return false;
  const day = new Date(`${value}T12:00:00`).getTime();
  return Number.isNaN(day) || Math.abs(day - Date.now()) > 36 * 3_600_000;
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

  if (!reasonForIssue) return { error: "Every transmittal states its reason for issue." };
  if (!dateOfIssue) return { error: "Date of issue is required." };
  if (!revisionIds.length && !attachments.length && !message && !subject) return { error: "Enclose at least one revision, or write a subject and a message — a transmittal cannot be empty of both." };
  if (direction === "OUTGOING" && !recipientUsers.length && !partyTo.length) return { error: "Name at least one person to send it to — a company on its own is not a recipient." };
  if (direction === "OUTGOING" && !subject) return { error: "Give the transmittal a subject — it is the first thing the recipient reads." };
  // What the backend does not keep is refused rather than quietly dropped.
  if (inReplyToId) return { error: "Answering a transmittal is not supported yet." };
  if (followsId) return { error: "Supplementing or replacing a transmittal is not supported yet." };
  if (chosenCc.length) return { error: "Copying people in is not supported yet." };
  if (notToday(dateOfIssue)) return { error: "Dating a transmittal other than today is not supported yet." };

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
  if (Object.values(asked.extras).some(Boolean)) return { error: "Fields of your own on a transmittal are not supported yet." };

  let landing: string;
  try {
    if (direction === "INCOMING") {
      // What arrived from another organization. Their own people send it
      // themselves; Document Control records it for one working outside the system.
      if (notes) return { error: "A note on how it arrived is not supported yet." };
      let fromPartyId: string | undefined;
      if (user.isInternal) {
        const found = (await addressees(ctx)).parties
          .find((one) => one.name.toLowerCase() === issuingParty.toLowerCase() || one.code.toLowerCase() === issuingParty.toLowerCase());
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
        body: { reason: reasonForIssue, message, revisionIds, unplanned, fromPartyId },
        idempotencyKey: crypto.randomUUID(),
      });
      landing = `/transmittals/${t.id}`;
    } else {
      if (!issueNow) return { error: "Keeping a transmittal as a draft is not supported yet." };
      // One transmittal to our own people chosen, and one to each organization.
      const sent = await api<{ id: string; number: string; toName: string }[]>(projectPath(ctx, "/transmittals"), {
        body: { revisionIds, userIds: recipientUsers, partyIds: partyTo, reason: reasonForIssue, subject, message },
        idempotencyKey: crypto.randomUUID(),
      });
      landing = sent.length === 1 ? `/transmittals/${sent[0].id}` : `/transmittals?q=${encodeURIComponent(sent.map((one) => one.number).join(","))}`;
    }
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/transmittals");
  redirect(landing);
}

export async function issueTransmittalAction(_prev: { error?: string } | undefined, _formData: FormData): Promise<{ error?: string }> {
  await requireScope();
  // Every transmittal the backend holds went when it was made.
  return { error: "Issuing a draft transmittal is not supported yet." };
}

/**
 * What arrived is accepted or returned by Document Control on arrival: each
 * submission it carried is checked, and a return says why, for the sender to
 * read. Something unplanned is registered on its own, from its file.
 */
export async function acceptTransmittalAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const id = String(formData.get("transmittalId") ?? "");
  const reject = formData.get("decision") === "reject";
  const notes = String(formData.get("notes") ?? "").trim();
  if (reject && !notes) return { error: "Say why it is rejected — the sender reads this." };
  const t = await legacyTransmittal(ctx, id);
  if (!t) return { error: "That transmittal no longer exists." };
  const waiting = t.items.filter((one) => one.arrival?.state === "TO_CHECK");
  if (!waiting.length) {
    return t.files.length && t.status === "ISSUED"
      ? { error: "What is left on it came unplanned: make each file a document to register it." }
      : { error: "Only a transmittal waiting to be checked can be accepted or rejected." };
  }
  // Returned to the sender to correct under the same revision, as the organization words it.
  const outcome = reject
    ? (await getActiveSet("CONTROL_OUTCOMES")).filter((one) => one.props.act === "return")
        .sort((a, b) => Number(b.props.to === "sender" && b.props.newRevision !== true) - Number(a.props.to === "sender" && a.props.newRevision !== true))[0]?.code
    : undefined;
  if (reject && !outcome) return { error: "Returning what arrived is not supported yet." };
  try {
    for (const item of waiting) {
      await api(projectPath(ctx, `/revisions/${item.revisionId}/arrival`), { body: { outcome, note: notes || null } });
    }
  } catch (e) {
    return { error: refusal(e).message };
  } finally {
    revalidatePath(`/transmittals/${id}`);
  }
  return {};
}

/** Adding to what came with a received transmittal, after it was recorded. */
export async function attachTransmittalFilesAction(_prev: { error?: string; ok?: string } | undefined, _formData: FormData): Promise<{ error?: string; ok?: string }> {
  await requireScope();
  // What came is fixed the moment it arrived: that moment is its receipt.
  return { error: "Keeping more files with a received transmittal is not supported yet." };
}

/**
 * Notifying again the people who have not opened it.
 */
export async function chaseTransmittalAction(_prev: { error?: string } | undefined, _formData: FormData): Promise<{ error?: string }> {
  await requireScope();
  return { error: "Notifying people again is not supported yet." };
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
  if (notToday(when)) return { error: "Recording that it went on a day other than today is not supported yet." };

  // Whoever carries the exchange with that organization has it waiting for them.
  const transmittalId = await dispatchOf(ctx, recipientId).catch(() => null);
  if (!transmittalId) return { error: "Only whoever carries the exchange with that organization records that it went, once." };
  try {
    // It leaves our system here, so what proves it left is the record.
    const [proof] = filesOf(formData, "evidence");
    const proofFileId = proof ? await upload(ctx, { transmittalId }, proof) : null;
    await api(projectPath(ctx, `/transmittals/${transmittalId}/recipients/${recipientId}/dispatch`), {
      body: { channel, reference, proofFileId },
    });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(`/transmittals/${transmittalId}`);
  return { ok: "Recorded as sent." };
}
