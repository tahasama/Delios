import "server-only";
import { db } from "./db";

// Which properties each published value set carries, and how to edit them in
// plain controls. Behavior across the app reads these props — never code constants.

export type PropField =
  | { key: string; label: string; type: "bool"; hint?: string }
  | { key: string; label: string; type: "int"; hint?: string }
  | { key: string; label: string; type: "text"; hint?: string }
  | { key: string; label: string; type: "select"; options: string[]; hint?: string };

export const SET_PROP_FIELDS: Record<string, PropField[]> = {
  STATUSES: [
    { key: "executionFlag", label: "Permits physical execution", type: "bool", hint: "§7.8 — construction, fabrication, installation, procurement commitment" },
    { key: "may", label: "May be used for", type: "text" },
    { key: "mayNot", label: "May NOT be used for", type: "text" },
  ],
  REVIEW_OUTCOMES: [
    { key: "proceed", label: "Work may proceed", type: "bool", hint: "§9.3" },
    { key: "resubmit", label: "Resubmission required", type: "bool", hint: "§9.3 — this outcome authorizes the next revision (§6.5)" },
  ],
  REASONS_FOR_ISSUE: [
    { key: "maturity", label: "Required maturity", type: "text", hint: "§2.6 — what state the revision must be in" },
    { key: "reviewCycle", label: "Opens a review cycle", type: "bool", hint: "§11.11" },
    { key: "response", label: "Response required", type: "bool" },
    { key: "acceptancePeriodDays", label: "Acceptance period (days)", type: "int", hint: "§11.12" },
    { key: "responsePeriodDays", label: "Response period (days)", type: "int", hint: "§11.12 — runs from acceptance" },
  ],
  COMMENT_CLASSES: [
    { key: "progressionPreventing", label: "Prevents progression", type: "bool", hint: "§9.6 — work shall not proceed while open" },
  ],
  CONFIDENTIALITY: [
    { key: "default", label: "Default classification", type: "bool", hint: "§5.7 — applied where unset" },
  ],
  ISSUE_CODES: [
    { key: "reason", label: "Maps to reason for issue", type: "select", options: ["INFORMATION", "REVIEW", "APPROVAL", "PRICING", "EXECUTION", "RECORD"] },
  ],
  CRITICALITY: [
    { key: "approval", label: "Minimum approval role", type: "select", options: ["REVIEWER", "APPROVER", "CONTROLLER", "ADMIN"], hint: "§8.6" },
    { key: "retention", label: "Suggested retention class", type: "text" },
    { key: "format", label: "Format obligation", type: "text", hint: "§10.4" },
  ],
  RETENTION_CLASSES: [
    { key: "basis", label: "Kept because", type: "text", hint: "§13.1" },
    { key: "startsFrom", label: "Period runs from", type: "text", hint: "§13.3" },
  ],
};

/** Build the JSON props blob from submitted form fields for a given set. */
export function buildProps(setKey: string, formData: FormData): string | null {
  const fields = SET_PROP_FIELDS[setKey];
  if (!fields) {
    const raw = String(formData.get("propsJson") ?? "").trim();
    return raw || null;
  }
  const props: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === "bool") props[f.key] = formData.get(`prop_${f.key}`) === "on";
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
