"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { api, projectPath, refusal } from "@/lib/api/client";

/**
 * Handing a review step to somebody else, and carrying that out.
 *
 * Where Document Control carries this act out, the reviewer asks and the request
 * waits; where the people doing the work carry it out themselves, the same form
 * puts the delegation in force at once. The backend reads which of the two is in
 * use from the project — see `src/lib/control-activities.ts` — and applies the
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
      body: { toUserId, endDate, reason: text(formData, "reason") || null },
    });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(`/reviews/${cycleId}`);
  return { message: row.status === "OPEN" ? "Asked. Document Control puts it in force." : `${row.toName} answers it in your place.` };
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

/** Document Control puts an asked-for delegation in force. */
export async function grantDelegationAction(_prev: State | undefined, formData: FormData): Promise<State> {
  return done(await act(formData, "grant"), (row) => `${row.toName} answers it in ${row.fromName}'s place.`);
}

/** Document Control declines it, with a reason — a refusal must be answerable. */
export async function refuseDelegationAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const why = text(formData, "refusedReason");
  if (!why) return { error: "Say why, so the person who asked knows what to do next." };
  return done(await act(formData, "refuse", { reason: why }), () => "Declined, and the person who asked has been told.");
}

/** The person who gave it takes it back; Document Control may also end it. */
export async function endDelegationAction(_prev: State | undefined, formData: FormData): Promise<State> {
  return done(await act(formData, "end"), () => "Ended.");
}
