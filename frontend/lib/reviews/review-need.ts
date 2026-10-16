import { getValue } from "@/lib/settings/config";

/**
 * Whether a document type is reviewed before it is released. The organization
 * says so when it publishes the type; a type that says nothing is reviewed.
 * One that is not goes from preparation straight to release — its status, its
 * recipients, an outside approval and The control function's gate all still apply.
 */
export async function typeSkipsReview(_t: unknown, docType: string | null | undefined): Promise<boolean> {
  if (!docType) return false;
  return (await getValue("DOCUMENT_TYPES", docType))?.props.review === false;
}
