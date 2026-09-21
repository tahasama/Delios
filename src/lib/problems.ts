import type { Tenant } from "./tenant";
import { plain } from "./utils";

/**
 * The check results turned into a work list: which documents have problems,
 * what each problem is in plain words, who fixes it, and where.
 */
export type Problem = { id: string; checkId: string; severity: string; text: string; owner: string; fix: { label: string; href: string } };
export type ProblemDocument = { id: string; docNumber: string; title: string; worst: string; problems: Problem[] };

export const OWNER_LABEL: Record<string, string> = { CF: "Document Control", OR: "Originator", RV: "Reviewer", OG: "Organization" };
const RANK: Record<string, number> = { CRITICAL: 0, MAJOR: 1, MINOR: 2, ADVISORY: 3 };

/** Where a problem of this family is fixed on the document page. */
function fixFor(checkId: string, documentId: string | null): { label: string; href: string } {
  const family = checkId.split("-")[0];
  if (!documentId) {
    if (family === "SC" || family === "CF") return { label: "Scope & readiness", href: "/admin/dmp" };
    return { label: "Settings", href: "/admin" };
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

/** The finding's own sentence, without clause references and Standard jargon. */
export function plainProblem(text: string): string {
  return plain(text).replace(/\s*—\s*structural contradiction/gi, "").replace(/\s*▲/g, "").replace(/\s*\/\s*[A-Z]{2}-\d{2}/g, "").replace(/\.$/, "") ;
}

export async function problemDocuments(t: Tenant, owner?: string) {
  const defects = await t.db.defect.findMany({
    where: { status: { in: ["OPEN", "ACCEPTED"] }, ...(owner ? { ownerRole: owner } : {}) },
    include: { documentRef: { select: { id: true, docNumber: true, title: true } } },
  });
  const byDoc = new Map<string, ProblemDocument>();
  const general: Problem[] = [];
  for (const d of defects) {
    const p: Problem = {
      id: d.id, checkId: d.checkId, severity: d.severity, owner: OWNER_LABEL[d.ownerRole] ?? d.ownerRole,
      text: plainProblem(d.description) + (d.status === "ACCEPTED" ? " (accepted, still counted)" : ""),
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
