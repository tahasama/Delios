import { cache } from "react";
import { api, apiShortLived } from "./api/client";

export type ValueRow = { code: string; label: string; status: string; props: Record<string, unknown> };

// Value sets are published at organization level (Annex C — the configuration
// gateway) and are the same for every project the organization runs. They are
// read from the backend, which applies the organization.
// The lists a page asks for in the same moment are fetched in one request, and
// the answer is kept for a few seconds: a page reads a dozen lists, many twice.
type RawRow = { code: string; label: string; status: string; props: Record<string, unknown> | null };
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
  return (sets[setKey] ?? []).map((row) => ({ code: row.code, label: row.label, status: row.status, props: row.props ?? {} }));
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

/** Friendly label with code, e.g. "CI — Civil". Falls back to the raw code. */
export function fmtValue(row: ValueRow | null | undefined, code?: string | null): string {
  if (row) return `${row.code} — ${row.label}`;
  return code ?? "—";
}

/** Where a set's title, description and group are kept: the organization's settings, one key per set. */
export const SET_KEY = "SET:";
export type SetInfo = { key: string; title: string; description: string | null; group: string | null; version: number };

/**
 * The published sets: every list that holds values, and every list an
 * administrator named before giving it values. A list's name and description
 * are the organization's settings; its values are the backend's.
 */
export const getSets = cache(async (): Promise<SetInfo[]> => {
  const { orgSettings } = await import("./api/settings");
  const [counted, named] = await Promise.all([
    api<{ key: string; active: number; retired: number }[]>("/api/admin/value-sets").catch(() => []),
    orgSettings().catch(() => new Map<string, string>()),
  ]);
  const keys = new Set([...counted.map((one) => one.key), ...[...named.keys()].filter((k) => k.startsWith(SET_KEY)).map((k) => k.slice(SET_KEY.length))]);
  return [...keys].sort().map((key) => {
    let info: { title?: string; description?: string | null; group?: string | null; version?: number } = {};
    try { info = JSON.parse(named.get(SET_KEY + key) ?? "{}"); } catch { info = {}; }
    const humane = key.replaceAll("_", " ").toLowerCase();
    return { key, title: info.title ?? humane.charAt(0).toUpperCase() + humane.slice(1), description: info.description ?? null, group: info.group ?? null, version: info.version ?? 1 };
  });
});

export async function isSetConfigured(setKey: string): Promise<boolean> {
  return (await readSet(setKey)).length > 0;
}
