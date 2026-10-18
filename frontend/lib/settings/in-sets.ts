import { api, projectPath } from "@/lib/client";
import { getSet } from "@/lib/settings/config";

type Sets = { id: string | null; name: string; isDefault: boolean; deliverableTypes: string[] }[];

/**
 * A filter's choices from a list of several sets (owner: every set's values, said whose): each value carries the name of
 * its set and whom that set serves, which the filter shows as its group. A list of one set reads as before. Another
 * organization's reader, who does not read our lists' sets, gets the values without groups.
 */
export async function setGrouping(scope: { projectId: string }) {
  const [lists, deliverables] = await Promise.all([
    api<{ lists: { key: string; sets: Sets }[] }>(projectPath(scope, "/lists")).catch(() => ({ lists: [] })),
    getSet("DELIVERABLE_TYPES"),
  ]);
  const listSets = new Map(lists.lists.map((l) => [l.key, l.sets]));
  const typeName = (code: string) => deliverables.find((d) => d.code === code)?.label ?? code;
  return <T extends { code: string; setId?: string | null }>(key: string, rows: T[], label: (row: T) => string) => {
    const sets = listSets.get(key) ?? [];
    const defaultId = sets.find((one) => one.isDefault)?.id ?? null;
    return rows.map((row) => {
      const set = sets.length > 1 ? sets.find((one) => one.id === (row.setId ?? defaultId)) : null;
      return {
        code: row.code, label: label(row),
        ...(set ? { group: `${set.name} · ${set.deliverableTypes.length ? `for ${set.deliverableTypes.map(typeName).join(", ")}` : set.isDefault ? "for the other types" : "for no type yet"}` } : {}),
      };
    });
  };
}
