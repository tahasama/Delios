import "server-only";
import { cache } from "react";
import { api } from "@/lib/client";

/**
 * What projects may change (owner, two levels of settings): one switch per setting on the organization's level, Fixed
 * (every project uses the organization's) or Free (a project may take its own copy). Worked out by the backend
 * (`Settings/Liberty.cs`, `GET /api/liberty`); a screen only words it.
 */
export type LibertyItem = {
  key: string; area: string; title: string; why: string; free: boolean; freeByDefault: boolean;
  changedAt: string | null; changedBy: string | null; locked: string | null;
};

export const liberty = cache(async (): Promise<LibertyItem[]> => api<LibertyItem[]>("/api/liberty").catch(() => []));

/** Whether a project may change this setting (`NUMBERING`, `LIST:<key>`…). Unknown: free, as the backend reads it. */
export async function isFree(key: string): Promise<boolean> {
  return (await liberty()).find((one) => one.key === key)?.free ?? true;
}
