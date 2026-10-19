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
    return await api<PackageView>(projectPath(scope, `/packages/${id}`));
  } catch (e) {
    if (e instanceof ApiProblem && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
});

/** Who may receive a transmittal, and the outside organizations with their ids. Empty for another organization's people. */
export const addressees = cache(async (scope: Scope): Promise<Addressees> =>
  api<Addressees>(projectPath(scope, "/addressees")).catch(() => ({ people: [], parties: [] })));

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
  api<{ code: string; name: string; participation: string }[]>("/api/parties").catch(() => []));

/** Register rows for these documents, in number order. */
export async function documentsByIds(scope: Scope, ids: string[]): Promise<{ id: string; docNumber: string; title: string }[]> {
  if (!ids.length) return [];
  const page = await api<RegisterPage>(projectPath(scope, "/register"), { query: { ids: ids.join(","), per: 250 } });
  return page.rows.map((row) => ({ id: row.id, docNumber: row.number, title: row.title })).sort((a, b) => a.docNumber.localeCompare(b.docNumber));
}

/** The packages of one kind, in full, each brought up to date with its rule: soonest due first, those without a date last. */
export const packagesOf = cache(async (scope: Scope, kind: "DELIVERY" | "SUPPLY"): Promise<PackageView[]> =>
  api<PackageView[]>(projectPath(scope, "/packages/views"), { query: { kind } }));

/** The package with this number, brought up to date with its rule; null when there is none the reader may see. */
export const packageByNumber = cache(async (scope: Scope, number: string): Promise<PackageView | null> => {
  try {
    return await api<PackageView>(projectPath(scope, `/packages/by-number/${encodeURIComponent(number)}`));
  } catch (e) {
    if (e instanceof ApiProblem && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
});

/** How the project takes other organizations' documents (the Control room): by placeholder, or as they come. */
export type Intake = { mode: "PLACEHOLDERS" | "AS_RECEIVED"; deliverableType: string | null; docType: string | null; discipline: string | null };

export const projectIntake = cache(async (scope: Scope): Promise<Intake> =>
  api<Intake>(projectPath(scope, "/intake")).catch(() => ({ mode: "PLACEHOLDERS", deliverableType: null, docType: null, discipline: null })));
