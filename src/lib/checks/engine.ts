import type { Tenant } from "@/lib/tenant";
import { CATALOG, CHECK_BY_ID } from "./catalog";
import { RUNNERS, buildCtx, CONFIG_CHECKS, type Failure, type RunResult } from "./runners";
import type { SessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type CheckOutcome = {
  checkId: string;
  result: "PASS" | "FAIL" | "NOT_CHECKED" | "NOT_EXECUTABLE";
  failingCount: number;
  ms: number;
  failures?: Failure[];
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

  for (const check of CATALOG) {
    const t0 = Date.now();
    let result: RunResult;
    const runner = RUNNERS[check.id] ?? CONFIG_CHECKS[check.id];
    try {
      result = runner ? await runner(ctx) : "NOT_CHECKED";
    } catch (e) {
      // Evidence blocked by an execution problem → Not executable naming the blocker (§17.1)
      result = "NOT_EXECUTABLE";
      console.error(`Check ${check.id} failed to execute:`, e);
    }
    const ms = Date.now() - t0;
    if (Array.isArray(result)) {
      outcomes.push({ checkId: check.id, result: result.length ? "FAIL" : "PASS", failingCount: result.length, ms });
      for (const failure of result) allFailures.push({ checkId: check.id, failure });
    } else {
      outcomes.push({ checkId: check.id, result: result === "NOT_EXECUTABLE" ? "NOT_EXECUTABLE" : "NOT_CHECKED", failingCount: 0, ms });
    }
  }

  const executed = outcomes.filter((o) => o.result === "PASS" || o.result === "FAIL").length;
  const failed = outcomes.filter((o) => o.result === "FAIL").length;
  const notChecked = outcomes.filter((o) => o.result === "NOT_CHECKED").length;
  const notExecutable = outcomes.filter((o) => o.result === "NOT_EXECUTABLE").length;
  const coverage = (executed / outcomes.length) * 100;

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
  // Close defects the re-run no longer returns (§17.6). A defect may only close
  // when its check actually executed and stopped returning it — NOT_CHECKED /
  // NOT_EXECUTABLE can never close anything.
  const executedIds = new Set(outcomes.filter((o) => o.result === "PASS" || o.result === "FAIL").map((o) => o.checkId));
  const openDefects = await db.defect.findMany({ where: { status: { in: ["OPEN", "ACCEPTED"] } } });
  for (const d of openDefects) {
    if (!executedIds.has(d.checkId)) continue;
    if (!seen.has(`${d.checkId}::${d.entityKey}`)) {
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
      items: { create: outcomes.map((o) => ({ projectId, checkId: o.checkId, result: o.result, failingCount: o.failingCount, ms: o.ms })) },
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
export async function latestResults(t: Tenant): Promise<Map<string, { result: string; failingCount: number; ranAt: Date }>> {
  const run = await t.db.checkRun.findFirst({ orderBy: { ranAt: "desc" }, include: { items: true } });
  const map = new Map<string, { result: string; failingCount: number; ranAt: Date }>();
  if (run) {
    for (const item of run.items) {
      map.set(item.checkId, { result: item.result, failingCount: item.failingCount, ranAt: run.ranAt });
    }
  }
  return map;
}
