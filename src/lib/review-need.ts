import type { Tenant } from "./tenant";
import { getValue } from "./config";
import { backendRevision, legacyDocument } from "./api/legacy";

/**
 * Whether a document type is reviewed before it is released. The organization
 * says so when it publishes the type; a type that says nothing is reviewed.
 * One that is not goes from preparation straight to release — its status, its
 * recipients, an outside approval and Document Control's gate all still apply.
 */
export async function typeSkipsReview(_t: unknown, docType: string | null | undefined): Promise<boolean> {
  if (!docType) return false;
  return (await getValue("DOCUMENT_TYPES", docType))?.props.review === false;
}

/**
 * A revision that reaches release with no approval to show because its type is
 * not reviewed — and that was never sent down a route after all. The type's
 * rule stands in for the approval; a revision that was reviewed needs its own.
 */
export async function releasedWithoutReview(t: Tenant, revisionId: string): Promise<{ docType: string } | null> {
  const revision = await backendRevision(t, revisionId);
  const doc = await legacyDocument(t, revision.documentId);
  if (!doc || doc.revisions.find((r) => r.id === revisionId)?.cycles.length) return null;
  return (await typeSkipsReview(t, doc.docType)) ? { docType: doc.docType } : null;
}
