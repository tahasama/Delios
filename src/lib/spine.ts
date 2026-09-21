import { createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";
import type { Tenant } from "./tenant";
import { CATALOG, CHECK_BY_ID, type CheckDef } from "./checks/catalog";
import { RULES, RULE_BY_ID } from "./checks/rules";
import { ROUTES } from "./routes";

/**
 * Annex F — the Traceability Spine.
 *
 * The Standard itself says which Check verifies which Rule (Annex H's clause
 * column) and which Route step applies it (Annex G's clause column). Those
 * cross-references are the reference links. What the organization stores is
 * its review of each link: the state it decided and the versions it looked at.
 *
 * States are then derived, never guessed (F.4, F.6):
 *   - a stored link whose Rule or linked item changed since review → Review required
 *   - a reference link never reviewed → Review required
 *   - a stored link the Standard no longer makes → Withdrawn (history kept)
 *   - a Rule with neither a Check nor a recorded "no requirement — no Check
 *     required", or with neither a Route step nor a recorded "no Route
 *     applies" → Gap (F.3)
 *
 * Automation reports; it does not decide conformance (F.6).
 */

export type Alignment = "ALIGNED" | "REVIEW_REQUIRED" | "GAP" | "NOT_APPLICABLE" | "WITHDRAWN";
export type LinkKind = "CHECK" | "ROUTE";

export const ALIGNMENT_LABEL: Record<Alignment, string> = {
  ALIGNED: "Aligned",
  REVIEW_REQUIRED: "Review required",
  GAP: "Gap",
  NOT_APPLICABLE: "Not applicable",
  WITHDRAWN: "Withdrawn",
};

const fp = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 10);

export function checkVersion(c: CheckDef): string {
  return fp([c.condition, c.method, c.evidence, c.clause, c.severity, c.owner, c.contradiction ? "▲" : ""].join("|"));
}

type RouteStepRef = { id: string; routeTitle: string; text: string; clause: string; version: string };

export function routeSteps(): RouteStepRef[] {
  return Object.values(ROUTES).flatMap((r) =>
    r.steps.map((s) => ({ id: `${r.id}/${s.id}`, routeTitle: r.title, text: s.text, clause: s.clause, version: fp(`${s.text}|${s.clause}`) })),
  );
}

/** The Rule IDs a clause column cites: "§3.1 · §3.2", "F.3 · F.5". */
export function citedRules(clause: string): string[] {
  const ids = [...clause.matchAll(/§(\d+\.\d+)/g)].map((m) => `§${m[1]}`);
  ids.push(...[...clause.matchAll(/\b(F\.\d)\b/g)].map((m) => m[1]));
  return [...new Set(ids)].filter((id) => RULE_BY_ID.has(id));
}

export type RefLink = { ruleId: string; kind: LinkKind; target: string; targetVersion: string; owner: string };

/** Every relationship the Standard's own cross-references make. */
export function referenceLinks(): RefLink[] {
  const links: RefLink[] = [];
  for (const c of CATALOG) {
    for (const ruleId of citedRules(c.clause)) links.push({ ruleId, kind: "CHECK", target: c.id, targetVersion: checkVersion(c), owner: c.owner });
  }
  for (const s of routeSteps()) {
    for (const ruleId of citedRules(s.clause)) links.push({ ruleId, kind: "ROUTE", target: s.id, targetVersion: s.version, owner: "CF" });
  }
  return links;
}

export const NO_ROUTE_REASON = "No Annex G route sequences this Rule; it is applied where its Part requires.";
export const NO_CHECK_REASON = "Defines scope, terms or relationships and contains no requirement; no Check required (F.3).";

/**
 * Clauses the Standard gives no Check because they state no requirement —
 * the publisher's reading under F.3, recorded with that reason when the
 * reference spine is adopted and reviewable like any other decision.
 */
export const DEFINITIONAL_RULES = ["§1.1", "§2.5"];

export type SpineRow = {
  key: string;
  ruleId: string;
  ruleTitle: string;
  kind: LinkKind;
  target: string;
  targetLabel: string;
  state: Alignment;
  stored: Alignment | null;
  /** Why the state is what it is, when the spine derived it. */
  why: string | null;
  reason: string | null;
  owner: string | null;
  reviewedAt: Date | null;
  reviewedByName: string | null;
  changeRef: string | null;
};

export const spineKey = (ruleId: string, kind: string, target: string) => `${ruleId}|${kind}|${target}`;

function targetLabel(kind: LinkKind, target: string, steps: Map<string, RouteStepRef>): string {
  if (!target) return kind === "ROUTE" ? "No Route applies" : "No Check — the clause states no requirement";
  if (kind === "CHECK") return `DEF-${target} · ${CHECK_BY_ID.get(target)?.condition ?? "no longer in Annex H"}`;
  const s = steps.get(target);
  return s ? `${target} · ${s.text}` : `${target} · no longer in Annex G`;
}

/** The spine as it stands: stored reviews laid over the Standard's reference links. */
export async function effectiveSpine(t: Pick<Tenant, "db">) {
  const stored = await t.db.spineLink.findMany();
  const byKey = new Map(stored.map((s) => [spineKey(s.ruleId, s.kind, s.target), s]));
  const refs = referenceLinks();
  const refKeys = new Set(refs.map((r) => spineKey(r.ruleId, r.kind, r.target)));
  const steps = new Map(routeSteps().map((s) => [s.id, s]));
  const rows: SpineRow[] = [];

  const row = (ruleId: string, kind: LinkKind, target: string, state: Alignment, why: string | null, s?: (typeof stored)[number], owner?: string): SpineRow => ({
    key: spineKey(ruleId, kind, target), ruleId, ruleTitle: RULE_BY_ID.get(ruleId)?.title ?? "no longer in the Standard",
    kind, target, targetLabel: targetLabel(kind, target, steps), state, stored: (s?.alignment as Alignment) ?? null, why,
    reason: s?.reason ?? null, owner: s?.owner ?? owner ?? null, reviewedAt: s?.reviewedAt ?? null, reviewedByName: s?.reviewedByName ?? null, changeRef: s?.changeRef ?? null,
  });

  for (const ref of refs) {
    const s = byKey.get(spineKey(ref.ruleId, ref.kind, ref.target));
    const rule = RULE_BY_ID.get(ref.ruleId)!;
    if (!s) { rows.push(row(ref.ruleId, ref.kind, ref.target, "REVIEW_REQUIRED", "New relationship — not reviewed yet", undefined, ref.owner)); continue; }
    const stale = [s.ruleVersion !== rule.fp ? `${ref.ruleId} changed` : "", s.targetVersion !== ref.targetVersion ? `${ref.kind === "CHECK" ? `DEF-${ref.target}` : ref.target} changed` : ""].filter(Boolean);
    const settled = s.alignment === "ALIGNED" || s.alignment === "NOT_APPLICABLE";
    rows.push(settled && stale.length
      ? row(ref.ruleId, ref.kind, ref.target, "REVIEW_REQUIRED", `${stale.join(" and ")} since review`, s)
      : row(ref.ruleId, ref.kind, ref.target, s.alignment as Alignment, null, s));
  }
  for (const s of stored) {
    const key = spineKey(s.ruleId, s.kind, s.target);
    if (refKeys.has(key)) continue;
    const rule = RULE_BY_ID.get(s.ruleId);
    if (!s.target && rule) {
      // A recorded "no Route applies" or "no Check required": stands until the Rule itself changes.
      const stale = s.alignment === "NOT_APPLICABLE" && s.ruleVersion !== rule.fp;
      rows.push(row(s.ruleId, s.kind as LinkKind, "", stale ? "REVIEW_REQUIRED" : (s.alignment as Alignment), stale ? `${s.ruleId} changed since review` : null, s));
    } else {
      rows.push(row(s.ruleId, s.kind as LinkKind, s.target, "WITHDRAWN", s.alignment === "WITHDRAWN" ? null : "The Standard no longer makes this link", s));
    }
  }

  // Gaps: F.3 — a blank relationship is a Gap, not evidence that none is required.
  const live = (r: SpineRow) => r.state !== "WITHDRAWN";
  for (const rule of RULES) {
    const mine = rows.filter((r) => r.ruleId === rule.id && live(r));
    // F.3: a Check, or a recorded reason that the clause contains no requirement.
    const verified = mine.some((r) => r.kind === "CHECK" && (r.target ? r.state !== "NOT_APPLICABLE" : true));
    if (!verified) rows.push(row(rule.id, "CHECK", "", "GAP", "No Check linked, and not recorded as a clause with no requirement (F.3)"));
    if (!mine.some((r) => r.kind === "ROUTE")) rows.push(row(rule.id, "ROUTE", "", "GAP", "No Route step linked and no reason recorded (F.5 rule 2)"));
  }

  const order = (id: string) => { const [a, b] = id.replace("§", "").replace("F.", "99.").split(".").map(Number); return a * 100 + b; };
  rows.sort((a, b) => order(a.ruleId) - order(b.ruleId) || a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target));
  const counts = Object.fromEntries((Object.keys(ALIGNMENT_LABEL) as Alignment[]).map((k) => [k, rows.filter((r) => r.state === k).length])) as Record<Alignment, number>;
  return { rows, counts, releasable: counts.GAP === 0 && counts.REVIEW_REQUIRED === 0 };
}

/** The current versions a reviewed link is recorded against. */
export function currentVersions(ruleId: string, kind: string, target: string): { ruleVersion: string | null; targetVersion: string | null } {
  const ruleVersion = RULE_BY_ID.get(ruleId)?.fp ?? null;
  if (!target) return { ruleVersion, targetVersion: null };
  if (kind === "CHECK") { const c = CHECK_BY_ID.get(target); return { ruleVersion, targetVersion: c ? checkVersion(c) : null }; }
  return { ruleVersion, targetVersion: routeSteps().find((s) => s.id === target)?.version ?? null };
}

/**
 * The spine as the Standard publishes it, adopted by a new organization: the
 * reference links Aligned at the current versions, "no Route applies" recorded
 * for Rules no Annex G route sequences, and "no Check required" for the
 * clauses that state no requirement (F.3). The organization reviews it like
 * any other decision.
 */
export async function adoptReferenceSpine(db: PrismaClient, orgId: string, reviewer = "Standard v2 reference") {
  const now = new Date();
  const refs = referenceLinks();
  const data = refs.map((r) => ({
    orgId, ruleId: r.ruleId, kind: r.kind, target: r.target, alignment: "ALIGNED", owner: r.owner,
    ruleVersion: RULE_BY_ID.get(r.ruleId)!.fp, targetVersion: r.targetVersion, reviewedAt: now, reviewedByName: reviewer,
  }));
  const routed = new Set(refs.filter((r) => r.kind === "ROUTE").map((r) => r.ruleId));
  for (const rule of RULES.filter((x) => !routed.has(x.id))) {
    data.push({ orgId, ruleId: rule.id, kind: "ROUTE", target: "", alignment: "NOT_APPLICABLE", owner: "CF", ruleVersion: rule.fp, targetVersion: null as unknown as string, reviewedAt: now, reviewedByName: reviewer });
  }
  for (const id of DEFINITIONAL_RULES.filter((x) => RULE_BY_ID.has(x))) {
    data.push({ orgId, ruleId: id, kind: "CHECK", target: "", alignment: "NOT_APPLICABLE", owner: "CF", ruleVersion: RULE_BY_ID.get(id)!.fp, targetVersion: null as unknown as string, reviewedAt: now, reviewedByName: reviewer });
  }
  for (const d of data) {
    await db.spineLink.upsert({
      where: { orgId_ruleId_kind_target: { orgId, ruleId: d.ruleId, kind: d.kind, target: d.target } },
      update: {},
      create: { ...d, reason: d.alignment !== "NOT_APPLICABLE" ? null : d.kind === "CHECK" ? NO_CHECK_REASON : NO_ROUTE_REASON },
    });
  }
  return data.length;
}
