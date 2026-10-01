import type { Tenant } from "./tenant";

/**
 * Whether a document type is reviewed before it is released. The organization
 * says so when it publishes the type; a type that says nothing is reviewed.
 * One that is not goes from preparation straight to release — its status, its
 * recipients, an outside approval and Document Control's gate all still apply.
 */
export async function typeSkipsReview(t: Pick<Tenant, "db">, docType: string | null | undefined): Promise<boolean> {
  if (!docType) return false;
  const row = await t.db.configValue.findFirst({ where: { setKey: "DOCUMENT_TYPES", code: docType }, select: { props: true } });
  if (!row?.props) return false;
  try {
    return (JSON.parse(row.props) as { review?: unknown }).review === false;
  } catch {
    return false;
  }
}

/**
 * A revision that reaches release with no approval to show because its type is
 * not reviewed — and that was never sent down a route after all. The type's
 * rule stands in for the approval; a revision that was reviewed needs its own.
 */
export async function releasedWithoutReview(t: Pick<Tenant, "db">, revisionId: string): Promise<{ docType: string } | null> {
  const rev = await t.db.revision.findUnique({ where: { id: revisionId }, select: { document: { select: { docType: true } }, _count: { select: { cycles: true } } } });
  if (!rev || rev._count.cycles) return null;
  return (await typeSkipsReview(t, rev.document.docType)) ? { docType: rev.document.docType } : null;
}
