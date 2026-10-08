"use server";

import { requireScope } from "@/lib/scope";

/**
 * Handing a review step to somebody else, and carrying that out.
 *
 * Where Document Control carries this act out, the reviewer asks and the request
 * waits; where the people doing the work carry it out themselves, the same form
 * puts the delegation in force at once. Which of the two is in use is read from
 * the project — see `src/lib/control-activities.ts` — and an administrator may
 * override it per project.
 *
 * The backend keeps no delegations yet, so each of these is refused.
 */

type State = { error?: string; message?: string };

const NOT_YET: State = { error: "Delegation is not supported yet." };

export async function delegateReviewAction(_prev: State | undefined, _formData: FormData): Promise<State> {
  await requireScope();
  return NOT_YET;
}

/** Document Control puts an asked-for delegation in force. */
export async function grantDelegationAction(_prev: State | undefined, _formData: FormData): Promise<State> {
  await requireScope();
  return NOT_YET;
}

/** Document Control declines it, with a reason — a refusal must be answerable. */
export async function refuseDelegationAction(_prev: State | undefined, _formData: FormData): Promise<State> {
  await requireScope();
  return NOT_YET;
}

/** The person who gave it takes it back; Document Control may also end it. */
export async function endDelegationAction(_prev: State | undefined, _formData: FormData): Promise<State> {
  await requireScope();
  return NOT_YET;
}
