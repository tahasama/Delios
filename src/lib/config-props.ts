import "server-only";
import { db } from "./db";

import { SET_PROP_FIELDS } from "./set-props";
export { SET_PROP_FIELDS } from "./set-props";
export type { PropField } from "./set-props";
export { VERDICT_EFFECT, verdictEffect, VERDICT_EFFECT_SHORT } from "./verdict-effect";


/**
 * Build the JSON props blob from submitted form fields for a given set.
 * Properties the form does not show are kept from `existing`, so saving a
 * value never drops what another part of the app relies on (e.g. a
 * deliverable type's numbering scheme).
 */
export function buildProps(setKey: string, formData: FormData, existing?: string | null): string | null {
  const fields = SET_PROP_FIELDS[setKey];
  if (!fields) {
    const raw = String(formData.get("propsJson") ?? "").trim();
    return raw || null;
  }
  const props: Record<string, unknown> = { ...parseProps(existing ?? null) };
  for (const f of fields) {
    if (f.type === "choice") {
      const picked = f.options.find((o) => o.value === String(formData.get(`prop_${f.key}`) ?? ""));
      if (picked) Object.assign(props, picked.sets);
    } else if (f.type === "bool") props[f.key] = formData.get(`prop_${f.key}`) === "on";
    else if (f.type === "int") {
      const v = String(formData.get(`prop_${f.key}`) ?? "").trim();
      props[f.key] = v === "" ? undefined : Number(v);
    } else {
      const v = String(formData.get(`prop_${f.key}`) ?? "").trim();
      props[f.key] = v === "" ? undefined : v;
    }
  }
  return JSON.stringify(props);
}

/** Read a value's props. */
export function parseProps(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

/** The published review outcomes with their proceed/resubmission consequences (§9.3). */
export async function outcomeConsequences(): Promise<Record<string, { proceed: boolean; resubmit: boolean; label: string }>> {
  const rows = await db.configValue.findMany({ where: { setKey: "REVIEW_OUTCOMES", status: "ACTIVE" } });
  const map: Record<string, { proceed: boolean; resubmit: boolean; label: string }> = {};
  for (const r of rows) {
    const p = parseProps(r.props);
    map[r.code] = { proceed: p.proceed === true, resubmit: p.resubmit === true, label: r.label };
  }
  return map;
}

/** The published outcome for "changes requested" — proceed = false, resubmit = true. */
export async function requestChangesOutcomeCode(): Promise<string | null> {
  const map = await outcomeConsequences();
  const code = Object.entries(map).find(([, c]) => !c.proceed && c.resubmit)?.[0];
  return code ?? "REVISE_AND_RESUBMIT";
}
