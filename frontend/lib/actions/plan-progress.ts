import "server-only";
import { scheduleSource } from "@/lib/actions/api";
import { api, projectPath } from "@/lib/client";

export const PLAN_STAGES = ["Schedule", "Disciplines", "Requirements", "Documents ready"];

/**
 * How far the project is from knowing what every action needs: the stage it has reached, and the one count that says
 * why for each stage. Counted by the backend from the actions and their needs alone (`GET /plan/progress`), kept until
 * the schedule changes; never the whole schedule read here.
 */
export async function planProgress(scope: { projectId: string }, window?: { from: Date | null; to: Date | null }) {
  const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  type Counts = { at: number; actions: number; untagged: number; answered: number; asked: number; complete: number; listed: number; from: string; to: string };
  const [counts, { source, imports }] = await Promise.all([
    api<Counts>(projectPath(scope, "/plan/progress"), { query: { from: iso(window?.from), to: iso(window?.to) }, keep: { areas: ["plan", "docs", "reviews", "transmittals"] } }),
    scheduleSource(scope),
  ]);
  const inForce = imports.find((one) => one.status === "DONE") ?? null;
  return {
    at: counts.at,
    schedule: source && counts.actions ? { documentId: source.documentId, revision: inForce?.revisionValue ?? null, actions: counts.actions } : null,
    tagged: counts.actions - counts.untagged,
    untagged: counts.untagged,
    actions: counts.actions,
    answered: counts.answered,
    asked: counts.asked,
    complete: counts.complete,
    listed: counts.listed,
    window: { from: new Date(`${counts.from}T00:00:00.000Z`), to: new Date(`${counts.to}T00:00:00.000Z`), chosen: !!(window?.from || window?.to) },
  };
}
