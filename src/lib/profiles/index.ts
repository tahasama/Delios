import type { PrismaClient } from "@prisma/client";
import type { Tenant } from "../tenant";
import { handlerFor, summariseDiff } from "../controlled/registry";
import "../controlled/handlers";
import reference from "./reference.json";
import industrial from "./industrial.json";
import energy from "./energy.json";
import construction from "./construction.json";

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
export type ProfileValue = { code: string; label: string; sort?: number; props?: Record<string, unknown> };
export type ProfileSet = { key: string; title?: string; description?: string; values: ProfileValue[] };
export type Profile = { id: string; projectKind?: string; name: string; description: string; sets: ProfileSet[] };

export const REFERENCE = reference as Profile;
export const PROFILES = [industrial, energy, construction] as Profile[];

export { PROJECT_KINDS } from "./kinds";

export function profileForKind(kind: string | null | undefined): Profile | null {
  return PROFILES.find((p) => p.projectKind === kind) ?? null;
}

/**
 * Publish a profile's sets into a new organization, at birth, before anyone
 * else exists to approve a change. The reference sets upsert (they are the
 * definition); a project-type profile only creates values that are missing.
 */
export async function publishProfile(db: PrismaClient, orgId: string, profile: Profile, mode: "define" | "add") {
  for (const set of profile.sets) {
    const existing = await db.configSet.findUnique({ where: { orgId_key: { orgId, key: set.key } } });
    if (!existing) {
      await db.configSet.create({ data: { orgId, key: set.key, title: set.title ?? set.key, description: set.description ?? null, version: 1 } });
    } else if (mode === "define" && set.title) {
      await db.configSet.update({ where: { id: existing.id }, data: { title: set.title, description: set.description ?? null } });
    }
    const count = await db.configValue.count({ where: { orgId, setKey: set.key } });
    for (let i = 0; i < set.values.length; i++) {
      const v = set.values[i];
      const props = v.props ? JSON.stringify(v.props) : null;
      const where = { orgId_setKey_code: { orgId, setKey: set.key, code: v.code } };
      if (mode === "define") {
        await db.configValue.upsert({ where, update: { label: v.label, sort: v.sort ?? i, props }, create: { orgId, setKey: set.key, code: v.code, label: v.label, sort: v.sort ?? i, props } });
      } else if (!(await db.configValue.findUnique({ where }))) {
        await db.configValue.create({ data: { orgId, setKey: set.key, code: v.code, label: v.label, sort: count + i, props } });
      }
    }
  }
}

/** What a profile would still add to this organization's published sets. */
export async function missingFromProfile(_t: unknown, profile: Profile): Promise<{ key: string; values: ProfileValue[] }[]> {
  const { getSet } = await import("../config");
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
