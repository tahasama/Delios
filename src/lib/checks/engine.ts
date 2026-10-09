import type { SessionUser } from "@/lib/auth";
import { checksOf, runAndWait } from "@/lib/api/conformance";

export type CheckOutcome = {
  checkId: string;
  result: "PASS" | "FAIL" | "NEEDS_SETUP" | "BY_HAND" | "OFF" | "NOT_EXECUTABLE";
  failingCount: number;
  ms: number;
  /** What has to be set up, or why it is off, when that is the answer. */
  note?: string | null;
};

/**
 * Run the catalogue against the register. The backend asks every check, keeps
 * the defects it finds (opening, keeping and closing them) and counts the
 * integrity and coverage; this asks for a run and waits for it to finish.
 */
export async function runAllChecks(t: { projectId: string }, _user: SessionUser | null): Promise<{ runId: string; integrity: number; coverage: number; failed: number }> {
  const run = await runAndWait(t);
  return { runId: run.id, integrity: run.integrity, coverage: run.coverage, failed: run.failed };
}

/** Latest result per check for the catalogue view. */
export async function latestResults(t: { projectId: string }): Promise<Map<string, { result: string; failingCount: number; ranAt: Date; note?: string | null }>> {
  const { lastRun } = await checksOf(t.projectId);
  const map = new Map<string, { result: string; failingCount: number; ranAt: Date; note?: string | null }>();
  if (lastRun) {
    const ranAt = new Date(lastRun.finishedAt ?? lastRun.requestedAt);
    for (const item of lastRun.results) {
      map.set(item.checkId, { result: item.result, failingCount: item.failing, ranAt, note: item.note });
    }
  }
  return map;
}
