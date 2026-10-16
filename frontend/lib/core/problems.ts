import { plain } from "@/lib/core/utils";
import { CHECK_BY_ID } from "@/lib/conformance/checks/catalog";
import { liveDefects, type DefectView } from "@/lib/conformance/api";
export const OWNER_LABEL: Record<string, string> = { CF: "The control function", OR: "Originator", RV: "Reviewer", OG: "Organization" };

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
    if (family === "SCH") return { label: "Schedule", href: "/actions" };
    return { label: "Settings", href: "/settings" };
  }
  const doc = `/documents/${documentId}`;
  switch (family) {
    case "DOC": return { label: "Edit details", href: `${doc}#metadata` };
    case "REV": case "STO": return { label: "Revisions", href: `${doc}#revisions` };
    case "RVW": return { label: "Reviews & approval", href: `${doc}#reviews` };
    case "PKG": return { label: "Packages", href: `${doc}#relationships` };
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
  SET: "An administrator has to publish or correct a setting before this can be right.",
  DOC: "Open the document and put right what its details say or leave out.",
  REV: "Open the revisions and put right what was recorded about this one.",
  RVW: "Open the review and settle the verdict or the comment it names.",
  STO: "A file or the history changed outside the app: tell whoever looks after the storage, and restore it from the backup.",
  SCH: "Open the schedule and settle the action: a confirmation, a postponement, or the document it is waiting for.",
  PKG: "Open the package and settle what belongs in it.",
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
  return plain(text).replace(/\s*—\s*structural contradiction/gi, "").replace(/\s*▲/g, "").replace(/\s*\/\s*[A-Z]{2,3}-\d{2}/g, "").replace(/\.$/, "") ;
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
