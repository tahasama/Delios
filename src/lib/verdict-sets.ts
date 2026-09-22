import type { Tenant } from "./tenant";
import { verdictEffect, VERDICT_EFFECT_SHORT } from "./verdict-effect";

export type VerdictSetView = { key: string; title: string; values: { code: string; label: string; effect: string; effectLabel: string }[] };

/** The verdict sets a route can use, as people see them: title, codes and what each does. */
export async function verdictSets(t: Pick<Tenant, "db">, keys: string[]): Promise<Map<string, VerdictSetView>> {
  const unique = [...new Set(keys)];
  const [sets, values] = await Promise.all([
    t.db.configSet.findMany({ where: { key: { in: unique } }, select: { key: true, title: true } }),
    t.db.configValue.findMany({ where: { setKey: { in: unique }, status: "ACTIVE" }, orderBy: [{ sort: "asc" }, { code: "asc" }] }),
  ]);
  const out = new Map<string, VerdictSetView>();
  for (const key of unique) {
    out.set(key, {
      key,
      title: sets.find((s) => s.key === key)?.title ?? key.replaceAll("_", " ").toLowerCase(),
      values: values.filter((v) => v.setKey === key).map((v) => {
        let props: Record<string, unknown> = {};
        try { props = v.props ? JSON.parse(v.props) : {}; } catch { props = {}; }
        const effect = verdictEffect(props);
        return { code: v.code, label: v.label, effect, effectLabel: VERDICT_EFFECT_SHORT[effect] };
      }),
    });
  }
  return out;
}
