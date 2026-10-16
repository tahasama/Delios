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
 * Adds what a profile would still add: each missing value is published as it is in the profile (the backend audits
 * every value it publishes). A profile never removes or relabels a value already there.
 */
export async function draftProfile(t: Tenant, profile: Profile): Promise<{ drafted: string[]; skipped: string[] }> {
  const { api, forgetShortLived } = await import("@/lib/client");
  const drafted: string[] = [];
  for (const set of await missingFromProfile(t, profile)) {
    for (const value of set.values) {
      await api("/api/admin/values", { method: "PUT", body: { setKey: set.key, code: value.code, label: value.label, sort: value.sort, props: value.props } });
    }
    drafted.push(set.key);
  }
  await forgetShortLived();
  return { drafted, skipped: [] };
}
