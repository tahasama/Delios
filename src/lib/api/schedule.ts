import "server-only";
import { cache } from "react";
import { api, ApiProblem, projectPath } from "./client";
import { backendDocument, backendRevision } from "./legacy";
import type { ActivitySummary, DocumentView } from "./types";

/**
 * The schedule as the old screens read it. The backend keeps activities read
 * from the project's schedule document, what each needs (a document, for a
 * purpose, by a day) and what was decided when documents were missing. These
 * rebuild the old "action" shape from it — departments as "CI,EL", entries with
 * their document, notes — so a screen changes only the line that loads its data.
 *
 * How the backend's records map:
 *   an activity           → an action (its start is the action's date)
 *   a need                → an entry on the action's list
 *   a decision            → a note (CARRIED, STOPPED)
 *   a schedule import     → a schedule version
 *
 * Whether a need is met is the backend's answer (its released revision serves
 * the purpose). A waived need is still a missing document on these screens:
 * they have no place for a waiver.
 * The screens address an activity by its code; the backend by its id.
 */

type Scope = { projectId: string };

export type NeedView = {
  id: string; documentId: string; documentNumber: string; title: string; currentRevision: string | null; currentStatus: string | null;
  purpose: string; requiredStatuses: string[]; anchor: string; offsetDays: number; fixedDate: string | null; neededBy: string | null;
  department: string | null; state: "MISSING" | "MET" | "WAIVED"; metAt: string | null; waiverNote: string | null; waivedBy: string | null; waivedAt: string | null;
};

export type DecisionView = {
  id: string; decision: string; plannedStart: string | null; responsibleName: string; reason: string;
  delayOwedBy: string | null; delayReason: string | null; recordedBy: string; recordedAt: string;
};

export type ActivityDetail = { activity: ActivitySummary; needs: NeedView[]; decisions: DecisionView[] };

export type CheckpointView = { name: string; deadline: string; due: string | null; at: string | null; late: boolean; owedBy: string };
export type NeedLateness = { requirementId: string; documentNumber: string; state: string; checkpoints: CheckpointView[]; cause: CheckpointView | null };

/** A NodaTime date as the backend sends it inside stored records: an ISO day, or the object with its parts. */
type LocalDateJson = string | { year: number; month: number; day: number } | null;

export type ScheduleImportView = {
  id: string; revisionId: string; revisionValue: string; fileId: string | null; status: "DONE" | "FAILED"; error: string | null;
  added: number; moved: number; changed: number; removed: number; unchanged: number; unmatchedDepartments: string[];
  changes: { code: string; name: string; type: "NEW" | "MOVED" | "CHANGED" | "REMOVED"; oldStart: LocalDateJson; newStart: LocalDateJson; oldFinish: LocalDateJson; newFinish: LocalDateJson }[];
};

export type ScheduleSourceView = { id: string; documentId: string; defaultLeadDays: number; riskWindowDays: number };

const date = (iso: string | null | undefined) => (iso ? new Date(iso) : null);

/** A day from the backend, at midnight UTC as the old dates were kept. */
export function dayOf(value: LocalDateJson | undefined): Date | null {
  if (!value) return null;
  if (typeof value === "string") return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return new Date(Date.UTC(value.year, value.month - 1, value.day));
}

/** Another organization's people do not read the schedule: for them it is empty. */
function orNothing<T>(fallback: T) {
  return (e: unknown): T => {
    if (e instanceof ApiProblem && (e.status === 403 || e.status === 404)) return fallback;
    throw e;
  };
}

/** The project's schedule document and its latest reads, newest first. */
export const scheduleSource = cache(async (scope: Scope) =>
  api<{ source: ScheduleSourceView | null; imports: ScheduleImportView[] }>(projectPath(scope, "/schedule"))
    .catch(orNothing({ source: null as ScheduleSourceView | null, imports: [] as ScheduleImportView[] })));

/** The schedule's activities in force, by start date. */
export const activityList = cache(async (scope: Scope): Promise<ActivitySummary[]> =>
  api<ActivitySummary[]>(projectPath(scope, "/activities")).catch(orNothing([] as ActivitySummary[])));

/** One activity with its needs and decisions, or null. */
export const activityDetail = cache(async (scope: Scope, id: string): Promise<ActivityDetail | null> =>
  api<ActivityDetail>(projectPath(scope, `/activities/${id}`)).catch(orNothing(null)));

/** For each need of an activity, the checkpoints its document went through and the first that slipped. */
export const activityLateness = cache(async (scope: Scope, id: string): Promise<NeedLateness[]> =>
  api<NeedLateness[]>(projectPath(scope, `/activities/${id}/lateness`)).catch(orNothing([] as NeedLateness[])));

/** The activity with this code, also one the schedule has since dropped; null when there is none. */
export const activityByCode = cache(async (scope: Scope, code: string): Promise<ActivitySummary | null> => {
  const found = await api<ActivitySummary[]>(projectPath(scope, "/activities"), { query: { q: code, includeRemoved: true } })
    .catch(orNothing([] as ActivitySummary[]));
  return found.find((one) => one.code === code) ?? null;
});

// ── The old shapes ───────────────────────────────────────────────────────────

export type LegacyEntry = {
  id: string; actionId: string; documentId: string; department: string | null;
  /** What the need asks for: the statuses it names, or its purpose. */
  requiredStatus: string;
  requiredBy: Date; manualDate: boolean; leadBusinessDays: number | null;
  submittedBy: string | null; approvedBy: string | null; createdAt: Date | null; updatedAt: Date | null;
  document: {
    id: string; docNumber: string; title: string; discipline: string; docType: string; originator: string | null; isPlaceholder: boolean;
    /** The released revision, carrying the backend's answer on whether it serves this need. */
    revisions: { value: string; state: string; statusCode: string | null; meets: boolean }[];
    /** Its newest revision, whatever its state: where it stands when it is not released yet. */
    latest?: { value: string; state: string; statusCode: string | null; held: boolean } | null;
  };
  state: NeedView["state"];
};

export type LegacyNote = {
  id: string; decision: string; plannedDate: Date | null; responsibleName: string; reason: string;
  delayResponsible: string | null; delayReason: string | null; recordedByName: string; createdAt: Date;
};

export type LegacyAction = {
  id: string; code: string; name: string; description: string | null; ownerName: string | null;
  /** Departments (disciplines) as "CI,EL". */
  departments: string | null; scheduledDate: Date | null; finishDate: Date | null;
  createdAt: Date | null; riskNotifiedAt: Date | null; lastMetAt: Date | null; scheduleRef: string | null;
  needCount: number; state: string;
  /** The backend's readiness label (NONE, READY, READY_WITH_WAIVERS, AT_RISK, PENDING). */
  readiness: string;
  entries: LegacyEntry[];
  /** Departments confirming their documents are there: not kept by the backend. */
  confirmations: { department: string; available: boolean; note: string | null; confirmedByName: string; confirmedAt: Date | null }[];
  notes: LegacyNote[];
  scheduleActivities: { scheduleVersion: { versionLabel: string } }[];
};

/** Every document a list of needs names, read once each. */
async function documentsOf(scope: Scope, needs: NeedView[]): Promise<Map<string, DocumentView | null>> {
  const ids = [...new Set(needs.map((one) => one.documentId))];
  const found = await inBatches(ids, (id) => backendDocument(scope, id));
  return new Map(ids.map((id, index) => [id, found[index]]));
}

/** Runs `load` over the items a few at a time, so a long schedule does not open a thousand requests at once. */
async function inBatches<T, R>(items: T[], load: (item: T) => Promise<R>, size = 8): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(load))));
  return out;
}

type Confirmation = LegacyAction["confirmations"][number] & { activityId: string };

/** Each department's readiness answers, by activity. */
async function confirmationsOf(scope: Scope): Promise<Confirmation[]> {
  const { readinessAnswers } = await import("./records");
  return (await readinessAnswers(scope)).map((one) => ({
    activityId: one.activityId, department: one.department, available: one.available, note: one.note,
    confirmedByName: one.confirmedByName, confirmedAt: new Date(one.confirmedAt),
  }));
}

function legacyAction(detail: ActivityDetail, documents: Map<string, DocumentView | null>, versionLabel: string | null, confirmations: Confirmation[] = []): LegacyAction {
  const { activity, needs, decisions } = detail;
  const scheduledDate = dayOf(activity.start);
  // By department, then by the day each is needed, as the action's list was kept.
  const entries = [...needs].sort((a, b) => (a.department ?? "").localeCompare(b.department ?? "") || (a.neededBy ?? "").localeCompare(b.neededBy ?? "")).map((need): LegacyEntry => {
    const document = documents.get(need.documentId) ?? null;
    const released = document?.revisions.find((one) => one.state === "RELEASED") ?? null;
    return {
      id: need.id,
      actionId: activity.id,
      documentId: need.documentId,
      department: need.department,
      requiredStatus: need.requiredStatuses.length ? need.requiredStatuses.join("/") : need.purpose,
      requiredBy: dayOf(need.neededBy) ?? scheduledDate ?? new Date(),
      manualDate: !!need.fixedDate,
      leadBusinessDays: need.anchor === "START" && need.offsetDays <= 0 ? -need.offsetDays : null,
      submittedBy: null,
      approvedBy: null,
      createdAt: null,
      updatedAt: null,
      document: {
        id: need.documentId,
        docNumber: need.documentNumber,
        title: need.title,
        discipline: document?.discipline ?? "",
        docType: document?.docType ?? "",
        originator: document?.originator ?? null,
        isPlaceholder: document?.isPlaceholder ?? false,
        revisions: need.currentRevision
          ? [{ value: need.currentRevision, state: released?.state ?? "RELEASED", statusCode: need.currentStatus, meets: need.state === "MET" }]
          : [],
        latest: (() => {
          const newest = document?.revisions.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
          return newest ? { value: newest.value, state: newest.state, statusCode: newest.statusCode, held: !!newest.heldAt } : null;
        })(),
      },
      state: need.state,
    };
  });
  // The last of them to arrive, once nothing is missing: what says whether they were there in time.
  const covered = needs.length > 0 && needs.every((one) => one.state === "MET");
  const arrivals = needs.map((one) => date(one.metAt)).filter((one): one is Date => !!one).sort((a, b) => b.getTime() - a.getTime());
  return {
    id: activity.id,
    code: activity.code,
    name: activity.name,
    description: null,
    ownerName: activity.responsible,
    departments: activity.departments.length ? activity.departments.join(",") : null,
    scheduledDate,
    finishDate: dayOf(activity.finish),
    createdAt: null,
    riskNotifiedAt: null,
    lastMetAt: covered ? arrivals[0] ?? null : null,
    // The planner's own ID for it, kept beside our number.
    scheduleRef: activity.externalId ?? null,
    needCount: activity.needs,
    state: activity.state,
    readiness: activity.readiness,
    entries,
    confirmations: confirmations.filter((one) => one.activityId === activity.id),
    notes: [...decisions].reverse().map((one) => ({
      id: one.id,
      decision: one.decision,
      plannedDate: dayOf(one.plannedStart),
      responsibleName: one.responsibleName,
      reason: one.reason,
      delayResponsible: one.delayOwedBy,
      delayReason: one.delayReason,
      recordedByName: one.recordedBy,
      createdAt: new Date(one.recordedAt),
    })),
    scheduleActivities: versionLabel ? [{ scheduleVersion: { versionLabel } }] : [],
  };
}

/** The label of the schedule read in force, e.g. "rev B", or null when none has been read. */
export const versionInForce = cache(async (scope: Scope): Promise<string | null> => {
  const latest = (await scheduleSource(scope)).imports.find((one) => one.status === "DONE");
  return latest ? `rev ${latest.revisionValue}` : null;
});

/** One activity in the old shape, by its code; null when there is none. */
export const legacyActionByCode = cache(async (scope: Scope, code: string): Promise<LegacyAction | null> => {
  const summary = await activityByCode(scope, code);
  const detail = summary ? await activityDetail(scope, summary.id) : null;
  if (!detail) return null;
  return legacyAction(detail, await documentsOf(scope, detail.needs), await versionInForce(scope), await confirmationsOf(scope));
});

/**
 * Every activity in force, in the old shape, with its needs and decisions.
 * The backend's list carries counts only, so each activity is read on its own.
 */
export const legacyActions = cache(async (scope: Scope): Promise<LegacyAction[]> => {
  const list = await activityList(scope);
  const details = (await inBatches(list, (one) => activityDetail(scope, one.id))).filter((one): one is ActivityDetail => !!one);
  const [documents, label, confirmations] = await Promise.all([
    documentsOf(scope, details.flatMap((one) => one.needs)), versionInForce(scope), confirmationsOf(scope),
  ]);
  return details.map((one) => legacyAction(one, documents, label, confirmations));
});

// ── Schedule versions ────────────────────────────────────────────────────────

export type LegacyScheduleVersion = {
  id: string; versionLabel: string; /** PUBLISHED (in force), SUPERSEDED or FAILED. */
  status: string; sourceName: string; notes: string | null;
  importedAt: Date | null; importedByName: string; publishedAt: Date | null; publishedByName: string | null;
  _count: { activities: number };
  /** The read as the backend keeps it. */
  view: ScheduleImportView;
  /** The schedule document's revision that was read. */
  revision: { id: string; value: string; state: string; statusCode: string | null; releasedAt: Date | null; document: { id: string; docNumber: string; title: string } } | null;
};

/**
 * Every read of the schedule document, newest first, as schedule versions. A
 * revision is read when it is released, so the day of its release is the day
 * the read came into force; the latest good read is the one in force.
 */
export const scheduleVersions = cache(async (scope: Scope): Promise<LegacyScheduleVersion[]> => {
  const { imports } = await scheduleSource(scope);
  const inForce = imports.find((one) => one.status === "DONE") ?? null;
  // The project may have named another schedule document since: each read says which revision it was.
  const documents = await inBatches(imports, async (one) => {
    const revision = await backendRevision(scope, one.revisionId).catch(orNothing(null));
    return revision ? backendDocument(scope, revision.documentId) : null;
  });
  return imports.map((one, index) => {
    const document = documents[index];
    const revision = document?.revisions.find((r) => r.id === one.revisionId) ?? null;
    const releasedAt = date(revision?.releasedAt);
    return {
      id: one.id,
      versionLabel: `rev ${one.revisionValue}`,
      status: one.status === "FAILED" ? "FAILED" : one === inForce ? "PUBLISHED" : "SUPERSEDED",
      sourceName: document?.number ?? "Schedule",
      notes: one.error,
      importedAt: releasedAt,
      importedByName: revision?.releasedByName ?? "the system",
      publishedAt: one.status === "DONE" ? releasedAt : null,
      publishedByName: one.status === "DONE" ? revision?.releasedByName ?? "the system" : null,
      _count: { activities: one.added + one.moved + one.changed + one.unchanged },
      view: one,
      revision: revision && document
        ? { id: revision.id, value: revision.value, state: revision.state, statusCode: revision.statusCode, releasedAt, document: { id: document.id, docNumber: document.number, title: document.title } }
        : null,
    };
  });
});
