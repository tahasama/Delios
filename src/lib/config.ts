import { cache } from "react";
import { api } from "./api/client";

export type ValueRow = { code: string; label: string; status: string; props: Record<string, unknown> };

// Value sets are published at organization level (Annex C — the configuration
// gateway) and are the same for every project the organization runs. They are
// read from the backend, which applies the organization.
const readSet = cache(async (setKey: string): Promise<ValueRow[]> => {
  const sets = await api<Record<string, { code: string; label: string; status: string; props: Record<string, unknown> | null }[]>>("/api/values", { query: { sets: setKey } });
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

/** The published sets, as the backend keeps them. */
export const getSets = cache(async (): Promise<{ key: string; title: string; description: string | null; group: string | null; version: number }[]> =>
  api<{ key: string; title: string; description: string | null; group: string | null; version: number }[]>("/api/value-sets").catch(() => []));

export async function isSetConfigured(setKey: string): Promise<boolean> {
  return (await readSet(setKey)).length > 0;
}
