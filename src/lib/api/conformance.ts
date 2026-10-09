import "server-only";
import { cache } from "react";
import { api, ApiProblem, apiFetch, problemOf, projectPath } from "./client";
import { projectSettings } from "./settings";
import { scopeConfig, type ScopeConfig } from "./admin";
import type { RegisterPage } from "./types";

/**
 * The checks, their runs and the defects they found, as the backend keeps them
 * (`backend/src/Delios.Host/Checks`). The backend runs the checks; the screens
 * read what it found.
 */

/** GET /checks (CheckEndpoints.cs CheckView): one check, its last result, and why it is off when it is. */
export type CheckView = {
  id: string; phase: string; condition: string; method: string; severity: string; owner: string;
  result: string | null; failing: number | null; note: string | null; offBecause: string | null;
};

/** One run (CheckEndpoints.cs RunView). */
export type RunView = {
  id: string; status: "QUEUED" | "RUNNING" | "DONE" | "FAILED"; requestedBy: string; requestedAt: string; finishedAt: string | null;
  executed: number; passed: number; failed: number; needsSetup: number; off: number; integrity: number; coverage: number;
  openCritical: number; error: string | null;
  results: { checkId: string; result: string; failing: number; milliseconds: number; note: string | null }[];
};

/** GET /defects (CheckEndpoints.cs DefectView). */
export type DefectView = {
  id: string; checkId: string; severity: string; owner: string; entityType: string; entityId: string | null; documentId: string | null;
  label: string; description: string; status: "OPEN" | "ACCEPTED" | "CLOSED"; firstSeenAt: string; lastSeenAt: string;
  closedAt: string | null; acceptedReason: string | null; acceptedBy: string | null;
};

export type ChecksAnswer = { lastRun: RunView | null; checks: CheckView[] };

/** The checks are the project's own people's to read; anybody else is shown none. */
async function orNothing<T>(load: () => Promise<T>, nothing: T): Promise<T> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof ApiProblem && e.status === 403) return nothing;
    throw e;
  }
}

/** Every check, its result in the last finished run, and what is switched off. Read once a request. */
export const checksOf = cache(async (projectId: string): Promise<ChecksAnswer> =>
  orNothing(() => api<ChecksAnswer>(projectPath({ projectId }, "/checks")), { lastRun: null, checks: [] }));

/** The defects not closed (open and accepted), most serious first. Read once a request. */
export const liveDefects = cache(async (projectId: string): Promise<DefectView[]> =>
  orNothing(() => api<DefectView[]>(projectPath({ projectId }, "/defects")), []));

/** One run, as it stands now. */
export async function runOf(scope: { projectId: string }, runId: string): Promise<RunView> {
  return api<RunView>(projectPath(scope, `/checks/runs/${runId}`));
}

/**
 * Asks the backend for a run and waits for its worker to finish it, so the page
 * that asked shows the new results. Gives up waiting after `seconds`; the run
 * still finishes, and the next read shows it.
 */
export async function runAndWait(scope: { projectId: string }, seconds = 25): Promise<RunView> {
  let run = await api<RunView>(projectPath(scope, "/checks/run"), { method: "POST" });
  const until = Date.now() + seconds * 1000;
  while ((run.status === "QUEUED" || run.status === "RUNNING") && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    run = await runOf(scope, run.id);
  }
  return run;
}

/** How many documents the project holds, in every state. */
export const documentCount = cache(async (projectId: string): Promise<number> =>
  (await api<RegisterPage>(projectPath({ projectId }, "/register"), { query: { view: "all", per: 25 } })).total);

/** Documents carrying an open or accepted Critical or Major defect: those not clear. */
export function flawedDocuments(defects: DefectView[]): number {
  return new Set(defects.filter((d) => d.documentId && (d.severity === "CRITICAL" || d.severity === "MAJOR")).map((d) => d.documentId)).size;
}

// ── What the backend has no table for, kept in the project's settings ────────

/** The settings key under which who switched a check off, and when, is kept: `CHECK_OFF:<checkId>`. */
export const CHECK_OFF_KEY = "CHECK_OFF:";

/** A switched-off check, with who decided and when where this application recorded it. */
export type OptOut = { id: string; checkId: string; reason: string; setByName: string; setAt: Date | null };

/** The checks the project switched off: the backend's reason, and who and when from the settings. */
export async function optOutsOf(projectId: string): Promise<OptOut[]> {
  const [answer, settings] = await Promise.all([checksOf(projectId), projectSettings(projectId)]);
  return answer.checks.filter((c) => c.offBecause !== null).map((c) => {
    let said: { by?: string; at?: string } = {};
    try { said = JSON.parse(settings.get(CHECK_OFF_KEY + c.id) ?? "{}"); } catch { said = {}; }
    return { id: c.id, checkId: c.id, reason: c.offBecause ?? "", setByName: said.by ?? "—", setAt: said.at ? new Date(said.at) : null };
  });
}

/**
 * The scope statement and integrity target the conformance screens measure
 * against: the organization's SCOPE setting, with the project's own scope
 * statement winning (see `scopeConfig` in ./admin). Null when none is stated.
 */
export async function scopeOf(projectId: string): Promise<ScopeConfig | null> {
  return scopeConfig(projectId);
}

/** A file the backend builds (a report's export), passed on to the browser under the backend's name. */
export async function passOnFile(path: string, query: Record<string, string | undefined>): Promise<Response> {
  const answer = await apiFetch(path, { query });
  if (!answer.ok || !answer.body) {
    const problem = await problemOf(answer);
    return Response.json({ error: problem.message }, { status: answer.status });
  }
  const headers: Record<string, string> = {
    "Content-Type": answer.headers.get("content-type") || "application/octet-stream",
    "Cache-Control": "private, no-store",
  };
  const disposition = answer.headers.get("content-disposition");
  if (disposition) headers["Content-Disposition"] = disposition;
  return new Response(answer.body, { headers });
}
