import "server-only";
import { api, projectPath } from "./client";
import { holders } from "./settings";

type Scope = { projectId: string };

/** The people named to read a closed document, as the readers panel lists them. */
export async function documentReaders(scope: Scope, documentId: string) {
  const rows = await api<{ id: string; userId: string; name: string; addedByName: string | null; reason: string | null; createdAt: string }[]>(
    projectPath(scope, `/documents/${documentId}/readers`)).catch(() => []);
  return rows.map((row) => ({
    id: row.id, userId: row.userId, user: { name: row.name }, addedByName: row.addedByName ?? "", reason: row.reason, createdAt: new Date(row.createdAt),
  }));
}

/** Everybody on the project who may read documents at all: who a reader can be chosen from. */
export async function projectReaders(scope: Scope) {
  const rows = await holders(scope.projectId, "READ").catch(() => []);
  return rows.map((one) => ({ user: { id: one.id, name: one.name }, function: one.functionName ? { name: one.functionName } : null }));
}

/** Voided revisions nobody has reassessed yet, as the exposures page lists them. */
export async function unresolvedVoids(scope: Scope) {
  const rows = await api<{ revisionId: string; documentId: string; number: string; value: string; voidReason: string | null }[]>(
    projectPath(scope, "/exposures/void")).catch(() => []);
  return rows.map((row) => ({ id: row.revisionId, documentId: row.documentId, value: row.value, voidReason: row.voidReason, document: { docNumber: row.number } }));
}
