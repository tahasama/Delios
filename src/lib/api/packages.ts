import "server-only";
import { cache } from "react";
import { api, ApiProblem, projectPath } from "./client";
import { getMe } from "./me";
import type { Addressees, PackageSummary, PackageView, RegisterPage } from "./types";
import { describeFilter, type PackageFilter } from "../package-rule";

/**
 * Packages as the old screens read them. The backend keeps one package record
 * for both kinds: a DELIVERY package (what we hand over) and a SUPPLY package
 * (what one supplier owes us; the old "SUPPLIER" category). These rebuild the
 * old shape from it — lists of ids as JSON text, statuses as "AB,IFC" — so a
 * screen changes only the line that loads its data.
 *
 * The screens address a package by its number; the backend by its id.
 */

type Scope = { projectId: string };

export type LegacyMember = {
  id: string; documentId: string; requiredStatus: string;
  document: { docNumber: string; title: string; revisions: { value: string; statusCode: string | null }[] };
};

export type LegacyPackage = {
  id: string; identifier: string; title: string | null; description: string | null; purpose: string;
  type: "ACCUMULATED" | "DEFINED"; category: "SUPPLIER" | "DELIVERY"; partyCode: string | null;
  recipientName: string; recipientPartyId: string | null; recipientPartyIds: string | null;
  completionDate: Date | null; requiredStatus: string;
  compositionOwnerId: string; compositionOwnerName: string; compositionOwnerIds: string | null;
  acceptanceAuthorityId: string; acceptanceAuthorityName: string; acceptanceAuthorityIds: string | null;
  membershipRule: string | null; membershipFilter: string | null; membershipExcluded: string | null;
  assessedAt: Date | null; shortfall: string | null; shortfallIssuedAt: Date | null; shortfallAcceptedBy: string | null;
  closedAt: Date | null; deliveredAt: Date | null; closureNote: string | null; acceptedAt: Date | null; acceptedByName: string | null;
  transmittalId: string | null; createdAt: Date;
  members: LegacyMember[];
  /** The backend's package, for what the old record did not carry. */
  view: PackageView;
  /** Read for its own page (each document in full), not for a list. */
  detail: boolean;
};

const date = (iso: string | null | undefined) => (iso ? new Date(iso) : null);

/** The project's packages, newest first. */
export const packageList = cache(async (scope: Scope): Promise<PackageSummary[]> =>
  api<PackageSummary[]>(projectPath(scope, "/packages")));

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

/** Planned and active documents not in the package, with their released revision: what may be added. At most 500. */
export async function deliveryCandidates(scope: Scope, members: string[]) {
  const pages = await Promise.all(["PLANNED", "ACTIVE"].flatMap((state) => [1, 2].map((page) =>
    api<RegisterPage>(projectPath(scope, "/register"), { query: { state, per: 250, page } }))));
  const have = new Set(members);
  const seen = new Set<string>();
  return pages.flatMap((one) => one.rows)
    .filter((row) => !have.has(row.id) && !seen.has(row.id) && seen.add(row.id))
    .sort((a, b) => a.number.localeCompare(b.number))
    .slice(0, 500)
    .map((row) => ({
      id: row.id, docNumber: row.number, title: row.title,
      revisions: row.releasedRevision ? [{ value: row.releasedRevision, statusCode: row.releasedStatus }] : [],
    }));
}

/** The old record rebuilt from the backend's package. */
async function legacyOf(scope: Scope, view: PackageView, createdAt: string, detail: boolean): Promise<LegacyPackage> {
  const [book, me] = await Promise.all([addressees(scope), getMe()]);
  const person = (id: string) => book.people.find((one) => one.id === id)?.name ?? "";
  const names = (ids: string[]) => ids.map(person).filter(Boolean).join(", ");
  const supply = view.kind === "SUPPLY";
  // A supply package's rule always names its supplier; the narrowing is the rest of it.
  const filter: PackageFilter = {
    disciplines: view.rule?.disciplines ?? [], docTypes: view.rule?.docTypes ?? [], originators: supply ? [] : view.rule?.originators ?? [],
    assetIds: view.rule?.assetIds ?? [],
  };
  const narrowing = !!(filter.disciplines!.length || filter.docTypes!.length || filter.originators!.length || filter.assetIds!.length);
  const membershipRule = narrowing ? await describeFilter(filter) : null;
  // Our own organization is not among the outside parties: a recipient that is not one is us.
  const recipients = view.recipientPartyIds.map((id) => book.parties.find((one) => one.id === id)?.name ?? me?.tenant.name ?? "us");
  const outgoing = view.transmittals.filter((one) => one.direction === "OUTGOING");
  const delivered = view.state === "DELIVERED" || (view.state === "ACCEPTED" && outgoing.length > 0);
  const shortfall = view.assessedAt && view.shortfall.length
    ? JSON.stringify(view.shortfall.map((one) => ({
        docNumber: one.documentNumber, requiredStatus: one.required.join(","), currentStatus: one.current ?? "not released",
        reason: "not yet at required status", expectedDate: null,
      })))
    : null;
  return {
    id: view.id, identifier: view.number, title: view.title, description: view.description, purpose: (view.reasons?.length ? view.reasons : [view.reason]).join(","),
    type: view.rule ? "ACCUMULATED" : "DEFINED", category: supply ? "SUPPLIER" : "DELIVERY",
    partyCode: supply ? view.rule?.originators[0] ?? me?.user.party?.code ?? null : null,
    recipientName: supply ? view.supplier ?? "" : recipients.join(", "),
    recipientPartyId: view.recipientPartyIds[0] ?? null, recipientPartyIds: JSON.stringify(view.recipientPartyIds),
    completionDate: date(view.completionDate), requiredStatus: view.requiredStatuses.join(","),
    compositionOwnerId: view.ownerIds[0] ?? "", compositionOwnerName: names(view.ownerIds) || view.createdBy, compositionOwnerIds: JSON.stringify(view.ownerIds),
    acceptanceAuthorityId: view.acceptorIds[0] ?? "", acceptanceAuthorityName: names(view.acceptorIds), acceptanceAuthorityIds: JSON.stringify(view.acceptorIds),
    membershipRule: supply ? membershipRule : view.rule ? membershipRule ?? "every document" : null,
    membershipFilter: narrowing ? JSON.stringify(filter) : null, membershipExcluded: JSON.stringify(view.excluded),
    assessedAt: date(view.assessedAt), shortfall, shortfallIssuedAt: date(view.shortfallIssuedAt), shortfallAcceptedBy: view.shortfallAcceptedBy,
    closedAt: date(view.closedAt), deliveredAt: delivered ? date(view.closedAt) : null, closureNote: view.closureNote,
    acceptedAt: date(view.acceptedAt), acceptedByName: view.acceptedBy, transmittalId: outgoing[0]?.id ?? null,
    createdAt: new Date(createdAt),
    members: view.members.map((m) => ({
      id: `${view.id}-${m.documentId}`, documentId: m.documentId, requiredStatus: m.required.join(","),
      document: { docNumber: m.documentNumber, title: m.title, revisions: m.revision ? [{ value: m.revision, statusCode: m.status }] : [] },
    })),
    view, detail,
  };
}

/** The packages of one kind, as the list shows them: soonest due first, those without a date last. */
export async function legacyPackages(scope: Scope, category: "SUPPLIER" | "DELIVERY"): Promise<LegacyPackage[]> {
  const kind = category === "SUPPLIER" ? "SUPPLY" : "DELIVERY";
  const rows = (await packageList(scope)).filter((one) => one.kind === kind);
  const views = await Promise.all(rows.map((one) => packageView(scope, one.id)));
  const packages = await Promise.all(rows.map((one, i) => (views[i] ? legacyOf(scope, views[i]!, one.createdAt, false) : null)));
  return packages.filter((one): one is LegacyPackage => !!one)
    .sort((a, b) => (a.completionDate?.getTime() ?? Infinity) - (b.completionDate?.getTime() ?? Infinity));
}

/** The package with this number, read for its own page; null when there is none the reader may see. */
export async function legacyPackageByNumber(scope: Scope, number: string): Promise<LegacyPackage | null> {
  const row = (await packageList(scope)).find((one) => one.number === number);
  const view = row ? await packageView(scope, row.id) : null;
  return view ? legacyOf(scope, view, row!.createdAt, true) : null;
}

/** The package's number, for the page to refresh after an act on it. */
export async function numberOf(scope: Scope, id: string): Promise<string | null> {
  return (await packageView(scope, id))?.number ?? null;
}
