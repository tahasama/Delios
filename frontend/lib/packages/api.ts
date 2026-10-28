import "server-only";
import { cache } from "react";
import { api, ApiProblem, projectPath } from "@/lib/client";
import type { Addressees, PackageView, RegisterPage } from "@/lib/types";

/**
 * Packages as the screens read them. The backend keeps one package record for
 * both kinds: a DELIVERY package (what we hand over) and a SUPPLY package (what
 * one supplier owes us). The screens address a package by its number.
 */

type Scope = { projectId: string };

/** One package in full, or null when it does not exist or is not the reader's to see. */
export const packageView = cache(async (scope: Scope, id: string): Promise<PackageView | null> => {
  try {
    return await api<PackageView>(projectPath(scope, `/packages/${id}`), { keep: { areas: ["packages", "docs", "reviews", "transmittals"] } });
  } catch (e) {
    if (e instanceof ApiProblem && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
});

/** Who may receive a transmittal, and the outside organizations with their ids. Empty for another organization's people. */
export const addressees = cache(async (scope: Scope): Promise<Addressees> =>
  api<Addressees>(projectPath(scope, "/addressees"), { keep: { areas: [] } }).catch(() => ({ people: [], parties: [] })));

/** Our own people on the project: who may put a package together or accept it. */
export async function ourPeople(scope: Scope): Promise<{ id: string; name: string; functionName: string }[]> {
  return (await addressees(scope)).people.filter((one) => !one.organization).map((one) => ({ id: one.id, name: one.name, functionName: one.function }));
}

/**
 * The organizations a package may go to or come from, as the old party rows.
 * Our own organization is not among them: the backend gives out no id for it.
 */
export async function packageParties(scope: Scope): Promise<{ id: string; code: string; name: string; isInternal: boolean }[]> {
  const found = await addressees(scope);
  const ours = (found as { ours?: { id: string; code: string; name: string } | null }).ours;
  return [
    ...found.parties.map((one) => ({ id: one.id, code: one.code, name: one.name, isInternal: false })),
    ...(ours ? [{ id: ours.id, code: ours.code, name: ours.name, isInternal: true }] : []),
  ];
}

/** The organization's active outside parties, by code (GET /api/parties). */
export const outsideParties = cache(async (): Promise<{ code: string; name: string; participation: string }[]> =>
  api<{ code: string; name: string; participation: string }[]>("/api/parties", { keep: { areas: [] } }).catch(() => []));

/** Register rows for these documents, in number order. */
export async function documentsByIds(scope: Scope, ids: string[]): Promise<{ id: string; docNumber: string; title: string }[]> {
  if (!ids.length) return [];
  const page = await api<RegisterPage>(projectPath(scope, "/register"), { keep: { areas: ["docs", "reviews", "transmittals", "packages"] }, query: { ids: ids.join(","), per: 250 } });
  return page.rows.map((row) => ({ id: row.id, docNumber: row.number, title: row.title })).sort((a, b) => a.docNumber.localeCompare(b.docNumber));
}

/** The packages of one kind, in full, each brought up to date with its rule: soonest due first, those without a date last. */
export const packagesOf = cache(async (scope: Scope, kind: "DELIVERY" | "SUPPLY"): Promise<PackageView[]> =>
  api<PackageView[]>(projectPath(scope, "/packages/views"), { query: { kind }, keep: { areas: ["packages", "docs", "transmittals", "reviews"] } }));

/**
 * The packages at the top of one kind, a page at a time, soonest due first (the Packages list: owner, only what is seen
 * first). One more than asked is read, to know whether there are more.
 */
export const packagesAtTop = cache(async (scope: Scope, kind: "DELIVERY" | "SUPPLY", take: number): Promise<PackageView[]> =>
  api<PackageView[]>(projectPath(scope, "/packages/views"), { query: { kind, top: true, take }, keep: { areas: ["packages", "docs", "transmittals", "reviews"] } }));

/** The package with this number, brought up to date with its rule; null when there is none the reader may see. */
export const packageByNumber = cache(async (scope: Scope, number: string): Promise<PackageView | null> => {
  try {
    return await api<PackageView>(projectPath(scope, `/packages/by-number/${encodeURIComponent(number)}`), { keep: { areas: ["packages", "docs", "reviews", "transmittals"] } });
  } catch (e) {
    if (e instanceof ApiProblem && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
});

/** How the project takes other organizations' documents (the Control room): by placeholder, or as they come. */
export type Intake = { mode: "PLACEHOLDERS" | "AS_RECEIVED"; deliverableType: string | null; docType: string | null; discipline: string | null };

export const projectIntake = cache(async (scope: Scope): Promise<Intake> =>
  api<Intake>(projectPath(scope, "/intake"), { keep: { areas: [] } }).catch(() => ({ mode: "PLACEHOLDERS", deliverableType: null, docType: null, discipline: null })));

/** One document of a package with what its page shows beside it (PackageEndpoints.cs PackageLineView). */
export type PackageLine = {
  documentId: string; number: string; title: string; isPlaceholder: boolean;
  revisionId: string | null; revision: string | null; revisionState: string | null; submittedAt: string | null; statusCode: string | null;
  returnedReason: string | null; returnedAt: string | null; resentAt: string | null; releasedAt: string | null; issuedAt: string | null;
  submissions: number; outcome: string | null; outcomeNote: string | null; incomingId: string | null; incomingNumber: string | null;
  comments: { by: string; text: string; blocking: boolean; settled: boolean; review: string; rev: string }[];
};

/**
 * Every document of a package with what its page shows beside it, read at once by the backend (it was read document
 * by document: the document, its context and each of its reviews). Reading it records nothing in anyone's activity.
 */
export const packageLines = cache(async (scope: Scope, packageId: string): Promise<PackageLine[]> =>
  api<PackageLine[]>(projectPath(scope, `/packages/${packageId}/lines`), { keep: { areas: ["packages", "docs", "transmittals", "reviews"] } }));

/** One document a delivery carries, at the revision that goes (PackageService.cs GoingLine). */
export type GoingLine = { documentId: string; number: string; title: string; revisionId: string; revision: string; status: string | null; ready: boolean; package: string };

/**
 * What delivering a package carries (PackageService.GoingAsync): the package and every package under it, each document
 * once at the revision that goes, what has no revision yet, and the words saying what went short. Or why it cannot go.
 */
export type Going = { packageId: string; number: string; title: string; kind: "DELIVERY" | "SUPPLY"; reason: string; lines: GoingLine[]; left: string[]; note: string | null; packages: string[] };

/** What delivering this package would carry, or the backend's refusal in its words. Read fresh: it waits on readiness. */
export async function packageGoing(scope: Scope, packageId: string): Promise<{ going: Going | null; why: string | null }> {
  try {
    return { going: await api<Going>(projectPath(scope, `/packages/${packageId}/going`)), why: null };
  } catch (e) {
    if (e instanceof ApiProblem) return { going: null, why: e.message };
    throw e;
  }
}
