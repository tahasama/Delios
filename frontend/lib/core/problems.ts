import { plain } from "@/lib/core/utils";
import { CHECK_BY_ID } from "@/lib/conformance/checks/catalog";
import { liveDefects, type DefectView } from "@/lib/conformance/api";
export const OWNER_LABEL: Record<string, string> = { CF: "Document Control", OR: "Originator", RV: "Reviewer", OG: "Organization" };

/** Where a list of values is kept in Settings, by its name; the numbering and the matrix have pages of their own. */
function settingSpot(set: string, label: string): { label: string; href: string } {
  if (set === "NUMBERING") return { label: `Numbering: ${label}`, href: `/settings/numbering#route-${encodeURIComponent(label)}` };
  if (set === "MATRIX") return { label: "Distribution matrix", href: "/distribution" };
  // The value itself opened for editing when the finding names one; a finding about the whole list opens the list.
  return { label: `${set.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}: ${label}`,
    href: `/settings/config?${new URLSearchParams({ set, edit: `${set}::${label}` })}` };
}

/**
 * The exact spot where a finding is put right: the document's tab for a document, and for anything else the thing
 * itself (the setting and its value, the action, the package, the review), never a page to search.
 */
function fixFor(d: DefectView): { label: string; href: string } {
  const family = d.checkId.split("-")[0];
  const first = d.label.split(" ")[0];
  if (d.entityType === "Settings" && d.entityKey?.startsWith("settings:")) {
    const [, set, ...rest] = d.entityKey.split(":");
    return settingSpot(set, rest.join(":"));
  }
  if (d.entityType === "Action") return { label: `Action ${first}`, href: `/actions/${encodeURIComponent(first)}` };
  if (d.entityType === "Package") return { label: `Package ${first}`, href: `/packages/${encodeURIComponent(first)}` };
  if (d.entityType === "Review" && d.entityId) return { label: `Review ${first}`, href: `/reviews/${d.entityId}` };
  if (d.entityType === "Audit") return { label: "Audit trail", href: "/settings/audit" };
  const documentId = d.documentId;
  if (!documentId) {
    if (family === "SC") return { label: "Schedule", href: "/actions" };
    if (family === "CF") return { label: "The plan", href: "/settings/dmp" };
    return { label: "Settings", href: "/settings" };
  }
  const doc = `/documents/${documentId}`;
  switch (family) {
    case "ID": case "MD": case "CL": case "RT": case "IO": return { label: "Edit details", href: `${doc}#metadata` };
    case "RV": case "ST": case "FM": return { label: "Revisions", href: `${doc}#revisions` };
    case "AP": case "RO": return { label: "Reviews & approval", href: `${doc}#reviews` };
    case "IS": return { label: "Sent out", href: `${doc}#distribution` };
    case "OB": return { label: "Out-of-date risks", href: "/exposures" };
    case "DB": return { label: "Schedule needs", href: `${doc}#relationships` };
    case "PK": return { label: "Packages", href: `${doc}#relationships` };
    default: return { label: "Open document", href: doc };
  }
}

/**
 * What to do about it, in the imperative.
 *
 * A finding says what is wrong; nobody can act on that alone. These are by
 * family, because a family is one kind of fault with one kind of remedy, and
 * 274 separate sentences would go stale the first time a check changed.
 */
const TODO: Record<string, string> = {
  ID: "Open the document and correct how it is identified — its number, its type, or what it is about.",
  MD: "Open the document and fill in what is missing from its description.",
  CL: "Open the document and set the classification it should carry.",
  RT: "Open the document and give it the retention it should be kept under.",
  IO: "Decide what this is — a document that gets revised, or a record that does not — and register it as that.",
  RV: "Open the revisions and put right what was recorded about this one.",
  ST: "Open the revisions: the state it is in does not match what was done to it.",
  FM: "Open the revisions and attach the file that is missing, in the form it should be kept.",
  AP: "Open the reviews: it was released without the approval the rules require.",
  RO: "Open the reviews and finish the route properly — the verdict, who gave it, or an open comment.",
  IS: "Open what was sent out and correct the issue record.",
  OB: "Somebody is holding a copy that is no longer current — tell them, or record that you did.",
  DB: "The schedule still expects this document; settle whether it is owed or withdraw the need.",
  PK: "Open the package and settle what belongs in it.",
  SC: "Open the schedule and settle the activity: record a decision, or chase the document it is waiting for.",
  CF: "An administrator has to publish or correct a setting before this can be right.",
};

/**
 * What to do about a finding of this kind, in the imperative.
 *
 * A setting-up condition has the same remedy whatever family it was gathered
 * under — somebody has to publish the thing — so the phase answers first.
 */
export function todoOf(checkId: string): string {
  if (CHECK_BY_ID.get(checkId)?.phase === "SETUP") return "An administrator has to publish or correct a setting before this can be right.";
  return TODO[checkId.split("-")[0]] ?? "Open it and put right what the check found.";
}

/** The finding's own sentence, without clause references and Standard jargon. */
function plainProblem(text: string): string {
  return plain(text).replace(/\s*—\s*structural contradiction/gi, "").replace(/\s*▲/g, "").replace(/\s*\/\s*[A-Z]{2}-\d{2}/g, "").replace(/\.$/, "") ;
}

/**
 * A defect's document, read from its label: the backend labels a document's
 * finding "number title", and a revision's "number rev X".
 */
function documentOf(d: DefectView): { id: string; docNumber: string; title: string } | null {
  if (!d.documentId) return null;
  const space = d.label.indexOf(" ");
  return space < 0
    ? { id: d.documentId, docNumber: d.label, title: "" }
    : { id: d.documentId, docNumber: d.label.slice(0, space), title: d.label.slice(space + 1) };
}

/** The defects not closed, narrowed to one owner when asked. */
async function defectsOf(t: { projectId: string }, owner?: string) {
  return (await liveDefects(t.projectId)).filter((d) => !owner || d.owner === owner);
}

/** Every finding of one kind, newest first, for the drill-down. */
export async function findingsOfType(t: { projectId: string }, checkId: string, take = 200) {
  const rows = (await defectsOf(t))
    .filter((d) => d.checkId === checkId)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, take);
  return rows.map((d) => ({
    id: d.id,
    status: d.status,
    severity: d.severity,
    text: plainProblem(d.description),
    label: d.label,
    document: documentOf(d),
    fix: fixFor(d),
    accepted: d.status === "ACCEPTED" ? { by: d.acceptedBy, why: d.acceptedReason } : null,
  }));
}
