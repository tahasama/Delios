import { cache } from "react";
import { api, apiShortLived } from "@/lib/client";

/** A value of a list; `setId` is the set of its list it is in (none: the list's default set). */
type ValueRow = { code: string; label: string; status: string; props: Record<string, unknown>; setId: string | null };

// Value sets are published at organization level (Annex C — the configuration
// gateway) and are the same for every project the organization runs. They are
// read from the backend, which applies the organization.
// The lists a page asks for in the same moment are fetched in one request, and
// the answer is kept for a few seconds: a page reads a dozen lists, many twice.
type RawRow = { code: string; label: string; status: string; props: Record<string, unknown> | null; setId?: string | null };
let pending: { keys: Set<string>; answer: Promise<Record<string, RawRow[]>> } | null = null;

function batched(setKey: string): Promise<Record<string, RawRow[]>> {
  if (!pending) {
    const keys = new Set<string>();
    const answer = new Promise<Record<string, RawRow[]>>((resolve, reject) => {
      queueMicrotask(() => {
        pending = null;
        apiShortLived<Record<string, RawRow[]>>("/api/values", 10_000, { query: { sets: [...keys].sort().join(",") } }).then(resolve, reject);
      });
    });
    pending = { keys, answer };
  }
  pending.keys.add(setKey);
  return pending.answer;
}

const readSet = cache(async (setKey: string): Promise<ValueRow[]> => {
  const sets = await batched(setKey);
  return (sets[setKey] ?? []).map((row) => ({ code: row.code, label: row.label, status: row.status, props: row.props ?? {}, setId: row.setId ?? null }));
});

/** All values of a published set, active first. */
export const getSet = cache(async (setKey: string): Promise<ValueRow[]> => readSet(setKey));

/** Active values only — what new records may use (retired stay on existing records §4.7). */
export const getActiveSet = cache(async (setKey: string): Promise<ValueRow[]> =>
  (await readSet(setKey)).filter((row) => row.status === "ACTIVE"));

export const getValue = cache(async (setKey: string, code: string | null | undefined): Promise<ValueRow | null> => {
  if (!code) return null;
  return (await readSet(setKey)).find((row) => row.code === code) ?? null;
});
/** Where a set's title, description and group are kept: the organization's settings, one key per set. */
export const SET_KEY = "SET:";
/** Lists the app reads by their key, shown in Settings even while empty. */
const READ_BY_THE_APP = ["PHASES", "PROJECT_KINDS"];
/** Their names until the organization renames them. */
const APP_TITLES: Record<string, { title: string; description: string }> = {
  PROJECT_KINDS: { title: "Project types", description: "What a project's Type is chosen from (This project, Open a new project). It describes the project only." },
};
type SetInfo = { key: string; title: string; description: string | null; group: string | null; version: number;
  /** What the list is, when it says: VERDICTS (a review decides with it). */
  kind: string | null };

/**
 * The published sets: every list that holds values, and every list an
 * administrator named before giving it values. A list's name and description
 * are the organization's settings; its values are the backend's.
 */
export const getSets = cache(async (): Promise<SetInfo[]> => readSets("project"));

/** The organization's lists and their names, as its Settings show them (an administrator's). */
export const organizationSets = cache(async (): Promise<SetInfo[]> => readSets("organization"));

/** The organization's values of a list, as its Settings show them (not the project's copy). */
export const organizationSet = cache(async (setKey: string): Promise<ValueRow[]> =>
  (await api<RawRow[]>(`/api/admin/lists/${encodeURIComponent(setKey)}/values`, { keep: { areas: [] } }).catch(() => [] as RawRow[]))
    .map((row) => ({ code: row.code, label: row.label, status: row.status, props: row.props ?? {}, setId: row.setId ?? null })));

async function readSets(level: "project" | "organization"): Promise<SetInfo[]> {
  const { orgSettings, projectSettings } = await import("@/lib/settings/api");
  const { getScope } = await import("@/lib/core/scope");
  const scope = level === "project" ? await getScope() : null;
  // The project's lists (its own, else the organization's) and their names: the project's over the organization's.
  const [counted, org, own] = await Promise.all([
    scope
      ? api<{ sets: { key: string; active: number; retired: number }[] }>(`/api/projects/${scope.projectId}/lists`, { keep: { areas: [] } }).then((r) => r.sets).catch(() => [])
      : level === "organization"
        ? api<{ sets: { key: string; active: number; retired: number }[] }>("/api/admin/lists", { keep: { areas: [] } }).then((r) => r.sets).catch(() => [])
        : api<{ key: string; active: number; retired: number }[]>("/api/admin/value-sets", { keep: { areas: [] } }).catch(() => []),
    orgSettings().catch(() => new Map<string, string>()),
    scope ? projectSettings(scope.projectId).catch(() => new Map<string, string>()) : Promise.resolve(new Map<string, string>()),
  ]);
  const named = new Map(org);
  for (const [key, value] of own) if (key.startsWith(SET_KEY)) named.set(key, value);
  // Lists the app reads by name are offered even before they hold a value, so they can be filled.
  const keys = new Set([...READ_BY_THE_APP, ...counted.map((one) => one.key), ...[...named.keys()].filter((k) => k.startsWith(SET_KEY)).map((k) => k.slice(SET_KEY.length))]);
  return [...keys].sort().map((key) => {
    let info: { title?: string; description?: string | null; group?: string | null; version?: number; kind?: string | null } = {};
    try { info = JSON.parse(named.get(SET_KEY + key) ?? "{}"); } catch { info = {}; }
    const humane = key.replaceAll("_", " ").toLowerCase();
    return { key, title: info.title ?? APP_TITLES[key]?.title ?? humane.charAt(0).toUpperCase() + humane.slice(1), description: info.description ?? APP_TITLES[key]?.description ?? null, group: info.group ?? null, version: info.version ?? 1, kind: info.kind ?? null };
  });
}
