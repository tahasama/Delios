import "server-only";
import { cache } from "react";
import { api, projectPath } from "./client";

type Scope = { projectId: string };
const day = (value: string | null | undefined) => (value ? new Date(`${value.slice(0, 10)}T00:00:00`) : null);

export type AssetRow = {
  id: string; code: string; name: string; area: string | null; system: string | null; unit: string | null; description: string | null;
  extras: Record<string, string> | null; active: boolean; documents: number;
};

/** The project's asset tags, by tag. */
export const projectAssets = cache(async (scope: Scope, q?: string): Promise<AssetRow[]> =>
  api<AssetRow[]>(projectPath(scope, "/assets"), { query: { q } }).catch(() => []));

/** One asset and the documents (that the reader may see) describing it. */
export async function projectAsset(scope: Scope, id: string) {
  return api<{
    asset: AssetRow;
    documents: { id: string; number: string; title: string; docType: string; discipline: string; state: string; current: { value: string; statusCode: string | null } | null }[];
  }>(projectPath(scope, `/assets/${id}`)).catch(() => null);
}

/** The assets a document is linked to. */
export async function documentAssets(scope: Scope, documentId: string) {
  return api<{ id: string; assetId: string; code: string; name: string; createdBy: string; createdAt: string }[]>(
    projectPath(scope, `/documents/${documentId}/assets`)).catch(() => []);
}

/** The project's published exceptions to the standard, newest first. */
export async function projectExceptions(scope: Scope) {
  const rows = await api<{ id: string; item: string; clauses: string; reason: string; authority: string; startDate: string; reviewPoint: string | null }[]>(
    projectPath(scope, "/exceptions")).catch(() => []);
  return rows.map((one) => ({ ...one, startDate: day(one.startDate)!, reviewPoint: day(one.reviewPoint) }));
}

export type CallRow = {
  id: string; department: string; activityCodes: string[]; dueOn: string; issuedAt: string; issuedByName: string; reminders: number;
  lastRemindedAt: string | null; answeredAt: string | null; answerNote: string | null;
};

/** Every call to a department so far, the newest first within each. */
export const requirementCalls = cache(async (scope: Scope): Promise<CallRow[]> =>
  api<CallRow[]>(projectPath(scope, "/requirement-calls")).catch(() => []));

/** Every department's readiness answer, per activity. */
export const readinessAnswers = cache(async (scope: Scope) =>
  api<{ activityId: string; department: string; available: boolean; note: string | null; confirmedByName: string; confirmedAt: string }[]>(
    projectPath(scope, "/readiness")).catch(() => []));

/** The requirements list as issued to each sender, newest first. */
export const senderIssues = cache(async (scope: Scope) =>
  api<{ id: string; sender: string; entryCount: number; needIds: string[]; issuedByName: string; issuedAt: string }[]>(
    projectPath(scope, "/sender-issues")).catch(() => []));

export type ControlledRow = {
  id: string; projectId: string | null; kind: string; key: string; title: string; versionLabel: string; state: string; submittedById: string | null; rowCount: number;
  sourceName: string | null; sourceSize: number | null; sourceHash: string | null; notes: string | null; payload: unknown; diff: unknown;
  createdBy: string; createdById: string; createdAt: string; submittedBy: string | null; submittedAt: string | null; decidedBy: string | null;
  decidedAt: string | null; decisionReason: string | null; appliedAt: string | null; appliedSummary: string | null; supersededAt: string | null;
};

/** Uploaded versions of a list, newest first: the project's own, or (no project) the organization's. */
export async function controlledVersions(scope: Scope | null, kind?: string, key?: string): Promise<ControlledRow[]> {
  const path = scope ? projectPath(scope, "/controlled") : "/api/controlled";
  return api<ControlledRow[]>(path, { query: { kind, key } }).catch(() => []);
}
