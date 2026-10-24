"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath, refusal } from "@/lib/client";

/**
 * Handing a review step to somebody else, and carrying that out.
 *
 * Where the control function carries this act out, the reviewer asks and the request
 * waits; where the people doing the work carry it out themselves, the same form
 * puts the delegation in force at once. The backend reads which of the two is in
 * use from the project — see `frontend/lib/settings/control-activities.ts` — and applies the
 * matrix's rule; its refusal is shown word for word.
 */

type State = { error?: string; message?: string };
type Delegation = { reviewId?: string; status: string; toName: string; fromName: string };

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

export async function delegateReviewAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const cycleId = text(formData, "cycleId");
  const toUserId = text(formData, "toUserId");
  const endDate = text(formData, "endDate");
  if (!cycleId) return { error: "A delegation is raised from a review." };
  if (!toUserId) return { error: "Say who takes it." };
  if (!endDate) return { error: "A delegation ends on a date — say when (§8.5)." };
  let row: Delegation;
  try {
    row = await api<Delegation>(projectPath(ctx, `/reviews/${cycleId}/delegations`), {
      body: { toUserId, endDate, reason: text(formData, "reason") || null, fromUserId: text(formData, "fromUserId") || null },
    });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(`/reviews/${cycleId}`);
  const forOther = Boolean(text(formData, "fromUserId"));
  if (row.status === "OPEN") return { message: "Asked. It starts once the control function lets it." };
  return { message: forOther ? `${row.toName} answers it in ${row.fromName}'s place; both are told.` : `${row.toName} answers it in your place.` };
}

/**
 * Adding people to a review in flow (the control function, whoever holds Manage): to the open step or one still to
 * come, or copied in; always with why. Steps already answered never change; nobody is taken off.
 */
export async function addReviewPeopleAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const cycleId = text(formData, "cycleId");
  const userIds = formData.getAll("userIds").map(String).filter(Boolean);
  const copyUserIds = formData.getAll("copyUserIds").map(String).filter(Boolean);
  const reason = text(formData, "reason");
  if (!userIds.length && !copyUserIds.length) return { error: "Choose who is added to the step, or copied in." };
  if (!reason) return { error: "Say why they are added: they, and the record, read it." };
  let done: { seated: number; copied: number };
  try {
    done = await api<{ seated: number; copied: number }>(projectPath(ctx, `/reviews/${cycleId}/people`), {
      body: { step: Number(text(formData, "step")) || null, userIds, copyUserIds, reason },
    });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(`/reviews/${cycleId}`);
  const said = [done.seated ? `${done.seated} added to the step` : null, done.copied ? `${done.copied} copied in` : null].filter(Boolean).join(", ");
  return { message: `${said}; each is told.` };
}

/** One act on a hand-over already made, by its id. */
async function act(formData: FormData, verb: "grant" | "refuse" | "end", body: object = {}): Promise<Delegation | State> {
  const ctx = await requireScope();
  const id = text(formData, "delegationId");
  try {
    return await api<Delegation>(projectPath(ctx, `/delegations/${id}/${verb}`), { body });
  } catch (e) {
    return { error: refusal(e).message };
  }
}

function done(row: Delegation | State, message: (row: Delegation) => string): State {
  if ("error" in row && row.error) return row as State;
  revalidatePath("/reviews", "layout");
  return { message: message(row as Delegation) };
}

/** the control function puts an asked-for delegation in force. */
export async function grantDelegationAction(_prev: State | undefined, formData: FormData): Promise<State> {
  return done(await act(formData, "grant"), (row) => `${row.toName} answers it in ${row.fromName}'s place.`);
}

/** the control function declines it, with a reason — a refusal must be answerable. */
export async function refuseDelegationAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const why = text(formData, "refusedReason");
  if (!why) return { error: "Say why, so the person who asked knows what to do next." };
  return done(await act(formData, "refuse", { reason: why }), () => "Declined, and the person who asked has been told.");
}

/** The person who gave it takes it back; the control function may also end it. */
export async function endDelegationAction(_prev: State | undefined, formData: FormData): Promise<State> {
  return done(await act(formData, "end"), () => "Ended.");
}
