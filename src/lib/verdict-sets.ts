import { getSet } from "./config";
import { verdictEffect, VERDICT_EFFECT_SHORT } from "./verdict-effect";

export type VerdictSetView = { key: string; title: string; values: { code: string; label: string; effect: string; effectLabel: string }[] };

/** The verdict sets a route can use, as people see them: title, codes and what each does. */
export async function verdictSets(_t: unknown, keys: string[]): Promise<Map<string, VerdictSetView>> {
  const unique = [...new Set(keys)];
  const out = new Map<string, VerdictSetView>();
  for (const key of unique) {
    const values = (await getSet(key)).filter((v) => v.status === "ACTIVE");
    out.set(key, {
      key,
      title: key.replaceAll("_", " ").toLowerCase(),
      values: values.map((v) => {
        const effect = verdictEffect(v.props);
        return { code: v.code, label: v.label, effect, effectLabel: VERDICT_EFFECT_SHORT[effect] };
      }),
    });
  }
  return out;
}
