import type { Tenant } from "./tenant";

/**
 * What the register was asked, read from the address.
 *
 * The register, its export and anything else that answers the same question
 * build their `where` here. Before this, the export honoured four of the
 * eleven filters, so "export what these filters match" quietly meant something
 * else than what the screen showed — the kind of difference nobody notices
 * until a spreadsheet is already in somebody's inbox.
 */
export type RegisterSearch = {
  q?: string;
  state?: string;
  rev?: string;
  status?: string;
  verdict?: string;
  supplier?: string;
  po?: string;
  discipline?: string;
  docType?: string;
  criticality?: string;
  confidentiality?: string;
  deliverable?: string;
  phase?: string;
  /** An action code: the documents that action owes. */
  action?: string;
  on?: string;
  from?: string;
  to?: string;
  view?: string;
};

/** The dates the register holds, and the column each one is kept in. */
export const DATE_COLUMN: Record<string, string> = {
  created: "createdDate",
  revStarted: "latestRevAt",
  fileAdded: "latestFileAt",
  planned: "latestPlannedAt",
  issued: "latestIssueAt",
  released: "latestReleasedAt",
  updated: "updatedAt",
};

/**
 * Two rules, and only two: a space narrows, a comma widens.
 *   pump ME IFC    every word must match, somewhere in the row
 *   P-101, P-102   either one is a match
 *   "feed pump" ME a quoted phrase counts as one word
 */
export function readSearch(q: string) {
  return q
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((part) => ({
      text: part,
      words: [...part.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => (m[1] ?? m[2]).trim()).filter(Boolean).slice(0, 6),
    }))
    .filter((search) => search.words.length);
}

/** A date from the address, as the day it names. */
export function readDay(value: string | undefined, endOfDay: boolean): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const at = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * The documents an asset code names. A search term may be a tag number rather
 * than anything written on the document, and the register answers for both.
 * Assets are not in the backend yet, so no tag names a document.
 */
export async function documentsForAssets(_t: Tenant, _words: string[]): Promise<string[]> {
  return [];
}

/** Which column each sort reads. All of them are columns; none is derived. */
export const REGISTER_SORTS: Record<string, string> = {
  fileAdded: "latestFileAt", revStarted: "latestRevAt", docNumber: "docNumber", title: "title",
  rev: "latestRevValue", revState: "latestRevState", docState: "state", releasedFor: "latestStatusCode",
  verdict: "latestVerdict", discipline: "discipline", docType: "docType", originator: "originator",
  subProject: "subProject", contract: "contractRef", criticality: "criticality",
  confidentiality: "confidentiality", retention: "retentionClass", deliverable: "deliverableType",
  phase: "latestPhase",
  planned: "latestPlannedAt", issued: "latestIssueAt", released: "latestReleasedAt",
  updated: "updatedAt", created: "createdDate",
};
