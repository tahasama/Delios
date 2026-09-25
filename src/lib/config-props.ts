import "server-only";
import { db } from "./db";

// Which properties each published value set carries, and how to edit them in
// plain controls. Behavior across the app reads these props — never code constants.

export type PropField =
  | { key: string; label: string; type: "bool"; hint?: string }
  | { key: string; label: string; type: "int"; hint?: string }
  | { key: string; label: string; type: "text"; hint?: string }
  | { key: string; label: string; type: "select"; options: string[]; hint?: string }
  /** One plain question whose answer sets several stored properties at once. */
  | { key: string; label: string; type: "choice"; options: ChoiceOption[]; read: (props: Record<string, unknown>) => string; hint?: string };

import type { ChoiceOption } from "./verdict-effect";

import { VERDICT_EFFECT, verdictEffect } from "./verdict-effect";
export { VERDICT_EFFECT, verdictEffect, VERDICT_EFFECT_SHORT } from "./verdict-effect";

export const SET_PROP_FIELDS: Record<string, PropField[]> = {
  DOCUMENT_TYPES: [
    { key: "appliesTo", label: "Who produces it", type: "select", options: ["Supplier", "Non-supplier", "Unclassified"], hint: "supplier documents carry the supplier fields in their number" },
 { key: "describesAsset", label: "Describes equipment — link it to an asset", type: "bool", hint: "" },
  ],
  STATUSES: [
 { key: "executionFlag", label: "Allows work on site or in the shop", type: "bool", hint: "building, fabricating, installing or ordering from it" },
    { key: "may", label: "May be used for", type: "text" },
    { key: "mayNot", label: "May NOT be used for", type: "text" },
  ],
  REVIEW_OUTCOMES: [
 { key: "effect", label: "What this verdict does", type: "choice", options: VERDICT_EFFECT, read: verdictEffect, hint: "" },
  ],
  SUBPROJECTS: [
    { key: "project", label: "Belongs to project", type: "text", hint: "the project code; leave it empty to offer this sub-project on every project" },
  ],
  // Advice is read off the comments, never chosen, so only its wording is an
  // organization's business.
  REVIEW_ADVICE: [
    { key: "meaning", label: "What it means, in one line", type: "text" },
  ],
  REASONS_FOR_ISSUE: [
 { key: "maturity", label: "Required maturity", type: "text", hint: "what state the revision must be in" },
 { key: "reviewCycle", label: "Needs a review", type: "bool", hint: "received documents go down a review route once accepted" },
    { key: "response", label: "Needs a reply", type: "bool", hint: "the recipient must answer within the reply period" },
 { key: "acceptancePeriodDays", label: "Acceptance period (days)", type: "int", hint: "" },
 { key: "responsePeriodDays", label: "Response period (days)", type: "int", hint: "runs from acceptance" },
  ],
  COMMENT_CLASSES: [
 { key: "progressionPreventing", label: "Blocks the work until it is closed", type: "bool", hint: "" },
  ],
  CONFIDENTIALITY: [
 { key: "default", label: "Used when none is chosen", type: "bool", hint: "" },
  ],
  ISSUE_CODES: [
    { key: "reason", label: "Maps to reason for issue", type: "select", options: ["INFORMATION", "REVIEW", "APPROVAL", "PRICING", "EXECUTION", "RECORD"] },
  ],
  CRITICALITY: [
 { key: "approval", label: "Minimum approval role", type: "select", options: ["REVIEWER", "APPROVER", "CONTROLLER", "ADMIN"], hint: "" },
    { key: "retention", label: "Suggested retention class", type: "text" },
 { key: "format", label: "Format obligation", type: "text", hint: "" },
  ],
  RETENTION_CLASSES: [
 { key: "basis", label: "Kept because", type: "text", hint: "" },
 { key: "startsFrom", label: "Period runs from", type: "text", hint: "" },
  ],
};

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
