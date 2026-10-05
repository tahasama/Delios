import { cache } from "react";
import { requireScope } from "./scope";

export type ValueRow = { code: string; label: string; status: string; props: Record<string, unknown> };

function parse(row: { code: string; label: string; status: string; props: string | null }): ValueRow {
  let props: Record<string, unknown> = {};
  if (row.props) {
    try { props = JSON.parse(row.props); } catch { /* ignore */ }
  }
  return { ...row, props };
}

// Value sets are published at organization level (Annex C — the configuration
// gateway) and are the same for every project the organization runs. The scoped
// client applies orgId; nothing here needs to name it.
async function cdb() {
  return (await requireScope()).db;
}

/** All values of a published set, active first. */
export const getSet = cache(async (setKey: string): Promise<ValueRow[]> => {
  const db = await cdb();
  const rows = await db.configValue.findMany({ where: { setKey }, orderBy: [{ sort: "asc" }, { code: "asc" }] });
  return rows.map(parse);
});

/** Active values only — what new records may use (retired stay on existing records §4.7). */
export const getActiveSet = cache(async (setKey: string): Promise<ValueRow[]> => {
  const db = await cdb();
  const rows = await db.configValue.findMany({ where: { setKey, status: "ACTIVE" }, orderBy: [{ sort: "asc" }, { code: "asc" }] });
  return rows.map(parse);
});

export const getValue = cache(async (setKey: string, code: string | null | undefined): Promise<ValueRow | null> => {
  if (!code) return null;
  const db = await cdb();
  const row = await db.configValue.findFirst({ where: { setKey, code } });
  return row ? parse(row) : null;
});

/** Friendly label with code, e.g. "CI — Civil". Falls back to the raw code. */
export function fmtValue(row: ValueRow | null | undefined, code?: string | null): string {
  if (row) return `${row.code} — ${row.label}`;
  return code ?? "—";
}

export const getSets = cache(async (): Promise<{ key: string; title: string; description: string | null; group: string | null; version: number }[]> => {
  const db = await cdb();
  return db.configSet.findMany({ orderBy: { key: "asc" } });
});

export async function isSetConfigured(setKey: string): Promise<boolean> {
  const db = await cdb();
  const count = await db.configValue.count({ where: { setKey } });
  return count > 0;
}
