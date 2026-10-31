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
  /** The projects this switch, fixed, leaves free (owner: "Fixed, except on these projects"), each with why. */
  except: LibertyException[];
  /** Read for one project: it is free there only by an exception. */
  exceptHere: boolean;
};

export type LibertyException = { projectId: string; projectCode: string; projectName: string; reason: string; at: string; by: string };

/** Where every switch stands; a failed read throws, so the organization's Settings never read it as "nothing". */
export const libertyOrFail = cache(async (): Promise<LibertyItem[]> => api<LibertyItem[]>("/api/liberty", { keep: { areas: [] } }));

/** Every switch as one project reads it: a fixed switch it is an exception to reads free there. */
export const projectLiberty = cache(async (projectId: string): Promise<LibertyItem[]> =>
  api<LibertyItem[]>("/api/liberty", { keep: { areas: [] }, query: { projectId } }).catch(() => []));

/** The same, read as "nothing" when it fails: for pages where a switch only narrows what is offered. */
export const liberty = cache(async (): Promise<LibertyItem[]> => libertyOrFail().catch(() => []));

/** Whether a project may change this setting (`NUMBERING`, `LIST:<key>`…). Unknown: free, as the backend reads it. */
export async function isFree(key: string): Promise<boolean> {
  return (await liberty()).find((one) => one.key === key)?.free ?? true;
}
