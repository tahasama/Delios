import { plain } from "./utils";
import { CHECK_BY_ID, type Phase } from "./checks/catalog";
import { liveDefects, type DefectView } from "./api/conformance";

/**
 * The check results turned into a work list: which documents have problems,
 * what each problem is in plain words, who fixes it, and where.
 */
export type Problem = { id: string; checkId: string; severity: string; text: string; todo: string; owner: string; status: string; fix: { label: string; href: string } };
export type ProblemDocument = { id: string; docNumber: string; title: string; worst: string; problems: Problem[] };

export const OWNER_LABEL: Record<string, string> = { CF: "Document Control", OR: "Originator", RV: "Reviewer", OG: "Organization" };
const RANK: Record<string, number> = { CRITICAL: 0, MAJOR: 1, MINOR: 2, ADVISORY: 3 };

/** Where a problem of this family is fixed on the document page. */
function fixFor(checkId: string, documentId: string | null): { label: string; href: string } {
  const family = checkId.split("-")[0];
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
export function plainProblem(text: string): string {
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

export async function problemDocuments(t: { projectId: string }, owner?: string) {
  const defects = (await defectsOf(t, owner)).map((d) => ({ ...d, ownerRole: d.owner, documentRef: documentOf(d) }));
  const byDoc = new Map<string, ProblemDocument>();
  const general: Problem[] = [];
  for (const d of defects) {
    const p: Problem = {
      id: d.id, checkId: d.checkId, severity: d.severity, owner: OWNER_LABEL[d.ownerRole] ?? d.ownerRole,
      text: plainProblem(d.description),
      todo: todoOf(d.checkId),
      status: d.status,
      fix: fixFor(d.checkId, d.documentId),
    };
    if (!d.documentRef) { general.push(p); continue; }
    const row = byDoc.get(d.documentRef.id) ?? { id: d.documentRef.id, docNumber: d.documentRef.docNumber, title: d.documentRef.title, worst: d.severity, problems: [] };
    row.problems.push(p);
    if (RANK[d.severity] < RANK[row.worst]) row.worst = d.severity;
    byDoc.set(d.documentRef.id, row);
  }
  const documents = [...byDoc.values()]
    .map((r) => ({ ...r, problems: r.problems.sort((a, b) => RANK[a.severity] - RANK[b.severity]) }))
    .sort((a, b) => RANK[a.worst] - RANK[b.worst] || b.problems.length - a.problems.length || a.docNumber.localeCompare(b.docNumber));
  return { documents, general: general.sort((a, b) => RANK[a.severity] - RANK[b.severity]) };
}

/**
 * The same findings counted by what is wrong, not by which document has it.
 *
 * A register of ten thousand documents produces a list of documents nobody can
 * read. Twenty-five kinds of problem, each with a count, is a page you can act
 * on: you fix a kind of problem, not a document at a time.
 */
export type ProblemType = {
  checkId: string;
  phase: Phase;
  severity: string;
  /** What is wrong, in the words of the check. */
  what: string;
  /** What to do about it. */
  todo: string;
  owner: string;
  documents: number;
  findings: number;
  accepted: number;
};

export async function problemTypes(t: { projectId: string }, owner?: string): Promise<ProblemType[]> {
  const defects = (await defectsOf(t, owner)).map((d) => ({ checkId: d.checkId, severity: d.severity, ownerRole: d.owner, documentId: d.documentId, status: d.status }));
  const byCheck = new Map<string, { severity: string; owner: string; docs: Set<string>; findings: number; accepted: number }>();
  for (const d of defects) {
    const row = byCheck.get(d.checkId) ?? { severity: d.severity, owner: OWNER_LABEL[d.ownerRole] ?? d.ownerRole, docs: new Set<string>(), findings: 0, accepted: 0 };
    row.findings++;
    if (d.status === "ACCEPTED") row.accepted++;
    if (d.documentId) row.docs.add(d.documentId);
    byCheck.set(d.checkId, row);
  }
  const out: ProblemType[] = [];
  for (const [checkId, row] of byCheck) {
    const meta = CHECK_BY_ID.get(checkId);
    out.push({
      checkId,
      phase: meta?.phase ?? "RUNNING",
      severity: row.severity,
      what: plainProblem(meta?.condition ?? checkId),
      todo: todoOf(checkId),
      owner: row.owner,
      documents: row.docs.size,
      findings: row.findings,
      accepted: row.accepted,
    });
  }
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.findings - a.findings);
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
    fix: fixFor(d.checkId, d.documentId),
  }));
}
