import "server-only";
import { cache } from "react";
import { api, ApiProblem, projectPath, type Query } from "./client";
import { getMe } from "./me";
import { holders } from "./settings";
import type { Addressees, TransmittalLog, TransmittalPage, TransmittalView, Work } from "./types";

/** Transmittals as the screens read them: the log, one transmittal, its page, drafts, who it can go to. */

type Scope = { projectId: string };

/** One page of the transmittal log, filtered and sorted by the backend. */
export async function transmittalLog(scope: Scope, query: Query): Promise<TransmittalLog> {
  return api<TransmittalLog>(projectPath(scope, "/transmittals/log"), { query });
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
const work = cache(async (scope: Scope): Promise<Work> => api<Work>(projectPath(scope, "/work")));

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
 * work; who else carries it is not published, so the names are Document Control's.
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
  const names = control.filter((one) => one.internal).map((one) => one.name).join(", ") || "Document Control";
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
