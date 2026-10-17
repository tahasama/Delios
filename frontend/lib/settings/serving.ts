/**
 * Which set of a list serves each deliverable type, as the backend works it out (`GET /api/values/serving`,
 * `ListRules.Serving`): a form offers a document only the values of that set. A value with no set is the default set's.
 */
export type Serving = Record<string, { defaultId: string | null; many: boolean; byType: Record<string, string | null> }>;

/**
 * The rows of a list offered for a deliverable type: those of the set serving it. A list with one set offers all of
 * them; before a type is chosen, the default set's.
 */
export function forType<T extends { setId?: string | null }>(serving: Serving, list: string, type: string | null | undefined, rows: T[]): T[] {
  const read = serving[list];
  if (!read || !read.many) return rows;
  const served = type ? (read.byType[type] ?? null) : read.defaultId;
  if (!served) return [];
  return rows.filter((row) => (row.setId ?? read.defaultId) === served);
}
