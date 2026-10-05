import type { Tenant } from "@/lib/tenant";
import { CATALOG, CHECK_BY_ID } from "./catalog";
import { RUNNERS, buildCtx, CONFIG_CHECKS, type Failure, type RunResult } from "./runners";
import type { SessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type CheckOutcome = {
  checkId: string;
  result: "PASS" | "FAIL" | "NEEDS_SETUP" | "BY_HAND" | "OFF" | "NOT_EXECUTABLE";
  failingCount: number;
  ms: number;
  failures?: Failure[];
  /** What has to be set up, when that is the answer. */
  needs?: string;
  /** Why the organization switched it off, when it did. */
  why?: string;
};

/**
 * Apply the Annex H catalogue against the evidence, record results, and
 * maintain the defect register (§17.1–17.6). A check result is a count of
 * failing items — no interview, no opinion.
 */
export async function runAllChecks(t: Tenant, user: SessionUser | null): Promise<{ runId: string; integrity: number; coverage: number; failed: number }> {
  const { db, projectId } = t;
  const started = Date.now();
  const ctx = await buildCtx(t);
  const outcomes: CheckOutcome[] = [];
  const allFailures: { checkId: string; failure: Failure }[] = [];

  // What this organization has switched off, and why.
  const optOuts = new Map(
    (await db.checkOptOut.findMany({ where: { projectId } })).map((one) => [one.checkId, one.reason] as const),
  );

  for (const check of CATALOG) {
    const t0 = Date.now();
    const off = optOuts.get(check.id);
    if (off !== undefined) {
      outcomes.push({ checkId: check.id, result: "OFF", failingCount: 0, ms: 0, why: off });
      continue;
    }
    const runner = RUNNERS[check.id] ?? CONFIG_CHECKS[check.id];
    if (!runner) {
      // Nothing in the register can answer it, so it is somebody's to check.
      outcomes.push({ checkId: check.id, result: "BY_HAND", failingCount: 0, ms: 0 });
      continue;
    }
    let result: RunResult;
    try {
      result = await runner(ctx);
    } catch (e) {
      result = "NOT_EXECUTABLE";
      console.error(`Check ${check.id} failed to execute:`, e);
    }
    const ms = Date.now() - t0;
    if (Array.isArray(result)) {
      outcomes.push({ checkId: check.id, result: result.length ? "FAIL" : "PASS", failingCount: result.length, ms });
      for (const failure of result) allFailures.push({ checkId: check.id, failure });
    } else if (result === "NOT_EXECUTABLE") {
      outcomes.push({ checkId: check.id, result: "NOT_EXECUTABLE", failingCount: 0, ms });
    } else if (result === "NOT_CHECKED") {
      outcomes.push({ checkId: check.id, result: "BY_HAND", failingCount: 0, ms });
    } else {
      outcomes.push({ checkId: check.id, result: "NEEDS_SETUP", failingCount: 0, ms, needs: result.needs });
    }
  }

  const executed = outcomes.filter((o) => o.result === "PASS" || o.result === "FAIL").length;
  const failed = outcomes.filter((o) => o.result === "FAIL").length;
  const notChecked = outcomes.filter((o) => o.result === "BY_HAND" || o.result === "NEEDS_SETUP").length;
  const notExecutable = outcomes.filter((o) => o.result === "NOT_EXECUTABLE").length;
  // Of what was actually asked, how much the register answered — switched-off
  // checks are not a gap, so they are not in the denominator.
  const asked = outcomes.filter((o) => o.result !== "OFF").length || 1;
  const coverage = (executed / asked) * 100;

  // ── Defect register maintenance (§17.5, §17.6) ────────────────────────────
  const seen = new Set<string>();
  for (const { checkId, failure } of allFailures) {
    const meta = CHECK_BY_ID.get(checkId)!;
    seen.add(`${checkId}::${failure.entityKey}`);
    const existing = await db.defect.findUnique({ where: { projectId_checkId_entityKey: { projectId, checkId, entityKey: failure.entityKey } } });
    if (existing) {
      if (existing.status === "CLOSED") {
        // The check still returns it — closure was premature; reopen (CF-11 guard)
        await db.defect.update({ where: { id: existing.id }, data: { status: "OPEN", lastSeenAt: new Date(), closedAt: null } });
      } else {
        await db.defect.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), description: failure.description ?? existing.description } });
      }
    } else {
      await db.defect.create({
        data: {
          projectId,
          checkId,
          severity: meta.severity,
          entityKey: failure.entityKey,
          entityType: failure.entityType,
          entityId: failure.entityId,
          documentId: failure.documentId ?? null,
          entityLabel: failure.entityLabel,
          description: failure.description ?? meta.condition,
          ownerRole: meta.owner,
          status: "OPEN",
        },
      });
    }
  }
  // Close what this run no longer returns. A finding may close for two
  // reasons: the check ran and stopped returning it, or the check is no longer
  // being asked — switched off, or now somebody's to check by hand. A finding
  // left open by a question nobody asks any more can never be cleared.
  const executedIds = new Set(outcomes.filter((o) => o.result === "PASS" || o.result === "FAIL").map((o) => o.checkId));
  const retiredIds = new Set(outcomes.filter((o) => o.result === "OFF" || o.result === "BY_HAND").map((o) => o.checkId));
  // A check dropped from the catalogue produces no outcome at all, so its
  // findings would sit open for ever with nothing left to clear them.
  const known = new Set(CATALOG.map((c) => c.id));
  const openDefects = await db.defect.findMany({ where: { status: { in: ["OPEN", "ACCEPTED"] } } });
  for (const d of openDefects) {
    const stale = retiredIds.has(d.checkId) || !known.has(d.checkId);
    if (!stale && !executedIds.has(d.checkId)) continue;
    if (stale || !seen.has(`${d.checkId}::${d.entityKey}`)) {
      await db.defect.update({ where: { id: d.id }, data: { status: "CLOSED", closedAt: new Date() } });
    }
  }

  // ── Integrity (§17.4) — documents free of Critical and Major defects ÷ documents ──
  const [totalDocs, defectiveDocs, openCritical] = await Promise.all([
    db.document.count(),
    db.document.count({ where: { defects: { some: { severity: { in: ["CRITICAL", "MAJOR"] }, status: { in: ["OPEN", "ACCEPTED"] } } } } }),
    db.defect.count({ where: { severity: "CRITICAL", status: { in: ["OPEN", "ACCEPTED"] } } }), // accepted criticals keep the warrant up (CF-12)
  ]);
  const integrity = totalDocs === 0 ? 100 : ((totalDocs - defectiveDocs) / totalDocs) * 100;

  const run = await db.checkRun.create({
    data: {
      projectId,
      ranByName: user?.name ?? "system",
      totalChecks: outcomes.length,
      executed,
      passed: outcomes.filter((o) => o.result === "PASS").length,
      failed,
      notChecked,
      notExecutable,
      integrity: Math.round(integrity * 10) / 10,
      coverage: Math.round(coverage * 10) / 10,
      openCritical,
      durationMs: Date.now() - started,
      items: { create: outcomes.map((o) => ({ projectId, checkId: o.checkId, result: o.result, failingCount: o.failingCount, ms: o.ms, note: o.needs ?? o.why ?? null })) },
    },
  });
  await audit({
    tenant: t,
    actor: user,
    action: "CHECK_RUN",
    entityType: "CheckRun",
    entityId: run.id,
    entityLabel: `Run ${new Date().toLocaleString("en-GB")}`,
 detail: `${outcomes.length} checks · integrity ${run.integrity}% · coverage ${run.coverage}% · ${openCritical} open Critical.`,
  });
  return { runId: run.id, integrity: run.integrity, coverage: run.coverage, failed };
}

/** Latest result per check for the catalogue view. */
export async function latestResults(t: Tenant): Promise<Map<string, { result: string; failingCount: number; ranAt: Date; note?: string | null }>> {
  const run = await t.db.checkRun.findFirst({ orderBy: { ranAt: "desc" }, include: { items: true } });
  const map = new Map<string, { result: string; failingCount: number; ranAt: Date; note?: string | null }>();
  if (run) {
    for (const item of run.items) {
      map.set(item.checkId, { result: item.result, failingCount: item.failingCount, ranAt: run.ranAt, note: item.note });
    }
  }
  return map;
}
