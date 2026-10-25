import "server-only";
import { cache } from "react";
import { api, ApiProblem, projectPath, type Query } from "@/lib/client";
import { getMe } from "@/lib/account/api";
import { holders } from "@/lib/settings/api";
import type { Addressees, TransmittalLog, TransmittalPage, TransmittalView, Work } from "@/lib/types";

/** Transmittals as the screens read them: the log, one transmittal, its page, drafts, who it can go to. */

type Scope = { projectId: string };

/** One page of the transmittal log, filtered and sorted by the backend. */
export async function transmittalLog(scope: Scope, query: Query): Promise<TransmittalLog> {
  return api<TransmittalLog>(projectPath(scope, "/transmittals/log"), { query, keep: { areas: ["transmittals", "docs"] } });
}

/** One transmittal, or null when it does not exist or is not the reader's to see. Reading it records a recipient's first opening. */
export const backendTransmittal = cache(async (scope: Scope, id: string): Promise<TransmittalView | null> => {
  try {
    return await api<TransmittalView>(projectPath(scope, `/transmittals/${id}`));
  } catch (e) {
    if (e instanceof ApiProblem && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
});

/** Who a transmittal can go to; empty for someone outside our organization, who may not ask. */
export const addressees = cache(async (scope: Scope): Promise<Addressees> =>
  api<Addressees>(projectPath(scope, "/addressees")).catch(() => ({ people: [], parties: [] })));

/** What waits on the signed-in person in this project. */
const work = cache(async (scope: Scope): Promise<Work> => api<Work>(projectPath(scope, "/work"), { keep: { areas: ["reviews", "transmittals", "docs", "packages", "plan"] } }));

/**
 * Our organization's name as the record carries it: what was sent to us reads
 * as sent to our own party, and without one, to the organization.
 */
export async function ourOrganizationName(): Promise<string> {
  const me = await getMe();
  return me?.user.party?.isInternal ? me.user.party.name : me?.tenant.name ?? "Our organization";
}

/** One transmittal as its page shows it, or null when it does not exist or is not the reader's to see. Reading it records a recipient's opening. */
export const transmittalPage = cache(async (scope: Scope, id: string): Promise<TransmittalPage | null> => {
  try {
    return await api<TransmittalPage>(projectPath(scope, `/transmittals/${id}/page`));
  } catch (e) {
    if (e instanceof ApiProblem && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
});

/**
 * Who of ours carries each organization a transmittal went to by hand, and
 * whether that is the reader. The backend lists the reader's own sending as
 * work; who else carries it is not published, so the names are the control function's.
 */
export async function carriersOf(scope: Scope, t: TransmittalView): Promise<Map<string, { names: string; mine: boolean }>> {
  const outside = t.recipients.filter((one) => one.partyId && !one.userId);
  const result = new Map<string, { names: string; mine: boolean }>();
  if (!outside.length) return result;
  const [mine, control] = await Promise.all([
    work(scope).then((w) => new Set(w.issues.filter((one) => one.kind === "DISPATCH_TRANSMITTAL" && one.transmittalId === t.id).map((one) => one.recipientId)))
      .catch(() => new Set<string | null>()),
    holders(scope.projectId, "CONTROL").catch(() => []),
  ]);
  const names = control.filter((one) => one.internal).map((one) => one.name).join(", ") || "The control function";
  for (const one of outside) {
    const before = result.get(one.partyId!);
    result.set(one.partyId!, { names, mine: (before?.mine ?? false) || mine.has(one.id) });
  }
  return result;
}

/** The transmittal a recipient row belongs to, when sending it on is the reader's to record. */
export async function dispatchOf(scope: Scope, recipientId: string): Promise<string | null> {
  const found = (await work(scope)).issues.find((one) => one.kind === "DISPATCH_TRANSMITTAL" && one.recipientId === recipientId);
  return found?.transmittalId ?? null;
}

/** The drafts the reader may see, newest first: written, not sent, no number yet. */
export async function transmittalDrafts(scope: Scope) {
  return api<{ id: string; subject: string; createdAt: string; createdBy: string; reason: string | null; documents: number; people: number; parties: number; copies: number }[]>(
    projectPath(scope, "/transmittals/drafts")).catch(() => []);
}

/** A reply by email to one of our transmittals, waiting for the control function (or answered). */
export type EmailReply = {
  id: string; transmittalId: string; transmittalNumber: string; organization: string; fromAddress: string; fromName: string | null;
  subject: string; text: string; receivedAt: string; files: { id: string; name: string; size: number }[];
  state: "WAITING" | "RECORDED" | "SET_ASIDE"; recordedTransmittalId: string | null; handledByName: string | null; handledAt: string | null;
  setAsideReason: string | null;
};

/** The replies by email on one transmittal, or (none named) those waiting on the project. The control function's only. */
export const emailReplies = cache(async (scope: Scope, transmittalId?: string): Promise<EmailReply[]> =>
  api<EmailReply[]>(projectPath(scope, "/email-replies"), { query: { transmittalId } }).catch(() => [] as EmailReply[]));
