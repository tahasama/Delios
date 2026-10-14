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

/** Which column each sort reads. All of them are columns; none is derived. */
export const REGISTER_SORTS: Record<string, string> = {
  fileAdded: "latestFileAt", revStarted: "latestRevAt", docNumber: "docNumber", title: "title",
  rev: "latestRevValue", revState: "latestRevState", docState: "state", releasedFor: "latestStatusCode",
  verdict: "latestVerdict", discipline: "discipline", docType: "docType", originator: "originator",
  subProject: "subProject", contract: "contractRef", criticality: "criticality",
  confidentiality: "confidentiality", retention: "retentionClass", deliverable: "deliverableType",
  phase: "phase",
  planned: "latestPlannedAt", issued: "latestIssueAt", released: "latestReleasedAt",
  updated: "updatedAt", created: "createdDate",
};
