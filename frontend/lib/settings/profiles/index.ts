import type { Tenant } from "@/lib/core/tenant";
import "@/lib/settings/controlled/handlers";
import industrial from "@/lib/settings/profiles/industrial.json";
import energy from "@/lib/settings/profiles/energy.json";
import construction from "@/lib/settings/profiles/construction.json";

/**
 * Starting configuration as data, not code (Annex C — the configuration
 * gateway). `reference.json` holds the Annex D reference sets every
 * organization starts from; each project-type profile only adds values to
 * them. A profile never removes or relabels a value: what an organization has
 * published is its own.
 *
 * To change a starting list, edit the JSON. To add a project type, add a file
 * and list it below.
 */
type ProfileValue = { code: string; label: string; sort?: number; props?: Record<string, unknown> };
export type ProfileSet = { key: string; title?: string; description?: string; values: ProfileValue[] };
export type Profile = { id: string; projectKind?: string; name: string; description: string; sets: ProfileSet[] };
export const PROFILES = [industrial, energy, construction] as Profile[];

export { PROJECT_KINDS } from "@/lib/settings/profiles/kinds";

export function profileForKind(kind: string | null | undefined): Profile | null {
  return PROFILES.find((p) => p.projectKind === kind) ?? null;
}

/** What a profile would still add to this organization's published sets. */
export async function missingFromProfile(_t: unknown, profile: Profile): Promise<{ key: string; values: ProfileValue[] }[]> {
  const { getSet } = await import("@/lib/settings/config");
  const out: { key: string; values: ProfileValue[] }[] = [];
  for (const set of profile.sets) {
    const have = new Set((await getSet(set.key)).map((v) => v.code));
    const missing = set.values.filter((v) => !have.has(v.code));
    if (missing.length) out.push({ key: set.key, values: missing });
  }
  return out;
}

/**
 * For an organization that already exists, a profile is a controlled change
 * like any other (§4.7). Controlled changes are not kept by the backend yet, so
 * nothing is drafted: every set the profile would extend is reported skipped.
 */
export async function draftProfile(t: Tenant, profile: Profile): Promise<{ drafted: string[]; skipped: string[] }> {
  return { drafted: [], skipped: (await missingFromProfile(t, profile)).map((one) => one.key) };
}
