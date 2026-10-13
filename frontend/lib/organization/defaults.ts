import "server-only";
import { orgSettings, projectSettings, setProjectSetting } from "@/lib/settings/api";

/**
 * The configuration a new project of ours starts with (docs/ORGANIZATIONS.md, "Defaults"): who does what and how
 * the project works, taken from one project the administrator chose. Copied into each project opened afterwards;
 * the project then changes it freely. Changing the defaults never changes a project already open, and a project of
 * another organization's follows its owner.
 */
export const DEFAULTS_KEY = "PROJECT_DEFAULTS";

export type ProjectDefaults = { fromProject: string; at: string; by: string; values: Record<string, string> };

/** What belongs to one project only, never a default: what it is, and checks ticked off on it. */
const OWN = (key: string) => key === "PROJECT_INFO" || key.startsWith("CHECK_OFF:");

export async function projectDefaults(): Promise<ProjectDefaults | null> {
  const raw = (await orgSettings()).get(DEFAULTS_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as ProjectDefaults; } catch { return null; }
}

/** A project's own choices, as defaults would hold them. */
export async function defaultsFrom(projectId: string): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const [key, value] of await projectSettings(projectId)) if (!OWN(key) && value) values[key] = value;
  return values;
}

/** Copies the defaults into a project just opened. Returns how many answers it carried. */
export async function applyDefaults(projectId: string): Promise<number> {
  const defaults = await projectDefaults();
  if (!defaults) return 0;
  for (const [key, value] of Object.entries(defaults.values)) await setProjectSetting(projectId, key, value);
  return Object.keys(defaults.values).length;
}
