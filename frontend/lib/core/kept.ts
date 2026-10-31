/**
 * What the screens keep of the backend's answers, and under which labels (owner: "whatever and whenever an activity
 * happens, it triggers whatever needed to be updated, partially"). A kept answer is read again only when a change names
 * one of its labels: the backend names them for every save (`Platform/ScreenChanges.cs`, the same names), on the
 * answer to a screen's own act or posted to `/api/screens/changed`. Keyed by the person's session (Next.js keys a kept
 * fetch by its headers), so nobody ever reads another's kept answer.
 */

/** The areas an answer depends on, as the backend names them. */
export type Area = "plan" | "docs" | "reviews" | "transmittals" | "packages" | "assets" | "checks" | "reports";

/** What a kept read says it depends on: its areas, and a document when it is one document's. */
export type Keep = {
  areas: Area[];
  doc?: string;
  /** Areas cleared only by a change the backend could not place on a project (a document page: a review step answered). */
  fallback?: Area[];
};

/**
 * The areas whose answers the backend works out against today (an action at risk, a review step late, an answer
 * overdue): their kept answers are kept per day of the project, so a new day is a new question (owner: "the same old
 * image unless something changed"; what is worded from a date on the page itself needs no day). Nothing else expires:
 * a kept answer stands until a change names one of its labels.
 */
const BY_DAY: Area[] = ["plan", "reviews", "transmittals"];

/** Each project's time zone, as the signed-in person's projects say it (lib/core/scope.ts): its day turns at its midnight. */
const zones = new Map<string, string>();
export function rememberZone(projectId: string, timeZone: string | null | undefined) {
  if (timeZone) zones.set(projectId, timeZone);
}

/** The project's day today (yyyy-MM-dd) when this answer depends on it; null otherwise. */
export function dayOf(path: string, keep: Keep): string | null {
  if (!keep.areas.some((area) => BY_DAY.includes(area))) return null;
  const project = /\/api\/projects\/([0-9a-fA-F-]{36})\//.exec(path)?.[1];
  const zone = (project && zones.get(project)) || "UTC";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** The labels of a kept read: each area on its project and on every project, its document, and everything. */
export function labelsOf(path: string, keep: Keep): string[] {
  const project = /\/api\/projects\/([0-9a-fA-F-]{36})\//.exec(path)?.[1] ?? null;
  const tags = new Set<string>(["all"]);
  for (const area of keep.areas) {
    tags.add(`area:${area}`);
    if (project) tags.add(`p:${project}:${area}`);
  }
  for (const area of keep.fallback ?? []) tags.add(`area:${area}`);
  if (keep.doc) tags.add(`doc:${keep.doc}`);
  return [...tags];
}
