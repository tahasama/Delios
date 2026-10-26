import "server-only";
import { apiFetch, problemOf, projectPath } from "@/lib/client";
import { backendDocuments } from "@/lib/documents/api";
import { listSources, type ListSourceKind } from "@/lib/actions/list-sources";

/** A list read from its register document: which list, which released revision, and how it reads. */
export type ListFrom = { kind: ListSourceKind; revisionId: string; label: string };

/**
 * The spreadsheet of a list's register document as released (owner: a list comes from its register document's released
 * revision, or from a file uploaded; the latest stands): the newest released revision's file of the kind the import
 * reads, opened through the backend like any download.
 */
export async function releasedFile(ctx: { projectId: string }, kind: ListSourceKind, format: RegExp): Promise<{ file: File; from: ListFrom } | { error: string }> {
  const source = (await listSources(ctx)).find((one) => one.kind === kind);
  const doc = source?.document;
  if (!doc || doc.chosenByApp) return { error: "No register document is chosen for this list yet: choose it first." };
  if (!doc.releasedRevisionId) return { error: `${doc.number} has no released revision to bring in.` };
  const [view] = await backendDocuments(ctx, [doc.id]).catch(() => []);
  const revision = view?.revisions.find((r) => r.id === doc.releasedRevisionId);
  const file = revision?.files.filter((f) => f.submission === revision.submission && f.status === "CLEAN" && format.test(f.name)).at(-1);
  if (!revision || !file) return { error: `${doc.number} rev ${doc.releasedValue} carries no ${format.source.includes("xlsx") ? "workbook (.xlsx)" : "CSV"} to read the list from.` };
  const stored = await apiFetch(projectPath(ctx, `/files/${file.id}/download`));
  if (!stored.ok) return { error: (await problemOf(stored)).message };
  const bytes = await stored.arrayBuffer();
  return { file: new File([bytes], file.name), from: { kind, revisionId: revision.id, label: `${doc.number} rev ${revision.value}` } };
}

