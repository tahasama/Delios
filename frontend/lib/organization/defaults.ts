import "server-only";
import { orgSettings, orgSettingsOrFail, projectSettings, setProjectSetting } from "@/lib/settings/api";
import { roomItemOf } from "@/lib/settings/control-activities";

/**
 * The configuration a new project of ours starts with (docs/ORGANIZATIONS.md, "Defaults"): who does what and how
 * the project works, taken from one project the administrator chose. Copied into each project opened afterwards;
 * the project then changes it freely. Changing the defaults never changes a project already open, and a project of
 * another organization's follows its owner.
 */
export const DEFAULTS_KEY = "PROJECT_DEFAULTS";

/** Taken from one project (`fromProject`), and possibly changed by hand since (`edited`). */
export type ProjectDefaults = { fromProject: string | null; edited?: boolean; at: string; by: string; values: Record<string, string> };

/** What belongs to one project only, never a default: what it is, and checks ticked off on it. */
export const isProjectOwn = (key: string) => key === "PROJECT_INFO" || key.startsWith("CHECK_OFF:");

/** Null: none set. With `orFail`, a failed read throws instead of reading as "none set". */
export async function projectDefaults({ orFail = false } = {}): Promise<ProjectDefaults | null> {
  const raw = (await (orFail ? orgSettingsOrFail() : orgSettings())).get(DEFAULTS_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as ProjectDefaults; } catch { return null; }
}

/**
 * What the defaults hold: the answers their page shows (who carries each act out, its confirmations and acts left out,
 * how a project works, the days before a silent discipline is notified again), nothing else. Never the stamp (its own
 * card), how other organizations' documents come in (a project's exception, never put on by itself), who answers for
 * an organization, or anything else only a project knows.
 */
export function isDefaultsAnswer(key: string): boolean {
  if (isProjectOwn(key)) return false;
  const item = roomItemOf(key);
  return item !== null && item !== "POLICY_PDF_STAMP";
}

/** A project's own choices, as defaults would hold them: only the answers the defaults show. */
export async function defaultsFrom(projectId: string): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const [key, value] of await projectSettings(projectId)) if (isDefaultsAnswer(key) && value) values[key] = value;
  return values;
}

/** Copies the defaults into a project just opened. Returns how many answers it carried. */
export async function applyDefaults(projectId: string): Promise<number> {
  const defaults = await projectDefaults();
  if (!defaults) return 0;
  // Only the answers the defaults show, even from defaults taken from a project before they were narrowed to them.
  const values = Object.entries(defaults.values).filter(([key]) => isDefaultsAnswer(key));
  for (const [key, value] of values) await setProjectSetting(projectId, key, value);
  return values.length;
}
