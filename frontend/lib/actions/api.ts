import "server-only";
import type { ActionState } from "@/lib/actions/action-state";
import { cache } from "react";
import { api, ApiProblem, projectPath } from "@/lib/client";
import type { ActivitySummary } from "@/lib/types";

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
  /** This document's own risk window from the requirements list, in days before the action's day; null uses the project's. */
  riskDays?: number | null;
};

export type DecisionView = {
  id: string; decision: string; plannedStart: string | null; responsibleName: string; reason: string;
  delayOwedBy: string | null; delayReason: string | null; recordedBy: string; recordedAt: string;
  confirmedBy?: string | null; confirmedAt?: string | null; confirmNote?: string | null;
  reversedBy?: string | null; reversedAt?: string | null; reversedReason?: string | null;
};

export type ActivityDetail = { activity: ActivitySummary; needs: NeedView[]; decisions: DecisionView[] };

type CheckpointView = { name: string; deadline: string; due: string | null; at: string | null; late: boolean; owedBy: string };
type NeedLateness = { requirementId: string; documentNumber: string; state: string; checkpoints: CheckpointView[]; cause: CheckpointView | null };

/** A NodaTime date as the backend sends it inside stored records: an ISO day, or the object with its parts. */
type LocalDateJson = string | { year: number; month: number; day: number } | null;

type ScheduleImportView = {
  id: string; revisionId: string; revisionValue: string; fileId: string | null; status: "DONE" | "FAILED"; error: string | null; importedAt: string;
  added: number; moved: number; changed: number; removed: number; unchanged: number; unmatchedDepartments: string[];
  changes: { code: string; name: string; type: "NEW" | "MOVED" | "CHANGED" | "REMOVED"; oldStart: LocalDateJson; newStart: LocalDateJson; oldFinish: LocalDateJson; newFinish: LocalDateJson }[];
};

type ScheduleSourceView = { id: string; documentId: string; defaultLeadDays: number; riskWindowDays: number };

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
// ── The plan, as the schedule screens show it ─────────────────────────────────

/** One thing an action needs: a document, for what (the statuses it names, or its purpose), by when, and where it stands. */
export type PlanNeed = {
  id: string; documentId: string; department: string | null;
  requiredStatus: string;
  neededBy: Date;
  /** The date was set by hand rather than counted from the action's day. */
  manualDate: boolean;
  /** Working days before the action's day, when counted from it. */
  leadDays: number | null;
  /** This document's own risk window, in days before the action's day; null uses the project's. */
  riskDays: number | null;
  /** The backend's answer: MET when its released revision serves the need. */
  state: "MISSING" | "MET" | "WAIVED";
  document: {
    id: string; number: string; title: string; discipline: string; docType: string; originator: string | null; isPlaceholder: boolean;
    /** The revision in force, and whether it serves this need. */
    released: { value: string; statusCode: string | null; meets: boolean } | null;
    /** Its newest revision, whatever its state: where it stands when it is not released yet. */
    latest: { value: string; state: string; statusCode: string | null; held: boolean } | null;
  };
};

export type PlanDecision = {
  id: string; decision: string; plannedStart: Date | null; responsibleName: string; reason: string;
  delayOwedBy: string | null; delayReason: string | null; recordedBy: string; recordedAt: Date;
  /** A postponement confirmed by whoever plans, with what changes. */
  confirmedBy: string | null; confirmedAt: Date | null; confirmNote: string | null;
  /** Taken back by the control function, with why: it no longer counts. */
  reversedBy: string | null; reversedAt: Date | null; reversedReason: string | null;
};

/** An action in force with everything its row and its page show, as the backend sends it (GET /plan). */
export type PlanAction = {
  id: string; code: string; name: string; responsible: string | null;
  /** The planner's own ID for it, kept beside our number. */
  externalId: string | null;
  departments: string[]; start: Date | null; finish: Date | null;
  /** When the last of its documents arrived, once none is missing. */
  lastMetAt: Date | null;
  needCount: number;
  /** The latest schedule read moved its dates: what they were, and which read moved them. */
  moved: { wasStart: Date | null; wasFinish: Date | null; in: string } | null;
  /** By department, then by the day each is needed. */
  needs: PlanNeed[];
  /** Each discipline's answer on going ahead; one taken back by the control function is kept, marked. */
  confirmations: {
    department: string; available: boolean; note: string | null; confirmedByName: string; confirmedAt: Date | null;
    /** Written by the system when the day passed with every document released. */
    automatic: boolean;
    revokedAt: Date | null; revokedByName: string | null; revokedReason: string | null;
  }[];
  /** Newest first. */
  decisions: PlanDecision[];
  /** The backend's answers, the same on every screen: its day is over (in the project's time zone)… */
  passed: boolean;
  /** …where it stands… */
  state: ActionState;
  /** …and the day it is at risk from: overall, and for each discipline (null when nothing is missing or there is no day). */
  riskFrom: Date | null;
  disciplineRiskFrom: Record<string, Date | null>;
};

type Plan = { versionInForce: string | null; actions: PlanAction[] };

/** The backend sends days and moments as text; the screens count with dates. Nothing else changes. */
function datesOf(raw: Plan): Plan {
  const at = (iso: string | null | undefined) => (iso ? new Date(iso) : null);
  const day = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00.000Z`) : null);
  type Raw = Record<string, unknown> & { [key: string]: never };
  return {
    versionInForce: raw.versionInForce,
    actions: raw.actions.map((a) => {
      const r = a as unknown as Raw & PlanAction;
      return {
        ...r,
        start: day(r.start as unknown as string), finish: day(r.finish as unknown as string), lastMetAt: at(r.lastMetAt as unknown as string),
        riskFrom: day(r.riskFrom as unknown as string),
        disciplineRiskFrom: Object.fromEntries(Object.entries(r.disciplineRiskFrom).map(([k, v]) => [k, day(v as unknown as string)])),
        moved: r.moved ? { ...r.moved, wasStart: day(r.moved.wasStart as unknown as string), wasFinish: day(r.moved.wasFinish as unknown as string) } : null,
        needs: r.needs.map((n) => ({ ...n, neededBy: day(n.neededBy as unknown as string)! })),
        confirmations: r.confirmations.map((c) => ({ ...c, confirmedAt: at(c.confirmedAt as unknown as string), revokedAt: at(c.revokedAt as unknown as string) })),
        decisions: r.decisions.map((d) => ({
          ...d, plannedStart: day(d.plannedStart as unknown as string), recordedAt: at(d.recordedAt as unknown as string)!,
          confirmedAt: at(d.confirmedAt as unknown as string), reversedAt: at(d.reversedAt as unknown as string),
        })),
      };
    }),
  };
}

/** Every action in force, in one answer from the backend; another organization's people get none. */
const plan = cache(async (scope: Scope): Promise<Plan> =>
  datesOf(await api<Plan>(projectPath(scope, "/plan")).catch(orNothing({ versionInForce: null, actions: [] } as Plan))));

/** Every action in force, with its needs, decisions and confirmations. */
export const planActions = cache(async (scope: Scope): Promise<PlanAction[]> => (await plan(scope)).actions);

/** The schedule read in force, e.g. "rev B", or null when none has been read. */
export const planVersion = cache(async (scope: Scope): Promise<string | null> => (await plan(scope)).versionInForce);

/** One action by its code, also one the schedule has since dropped; null when there is none. */
export const planActionByCode = cache(async (scope: Scope, code: string): Promise<PlanAction | null> => {
  const one = await api<Plan>(projectPath(scope, `/plan/${encodeURIComponent(code)}`)).catch(orNothing(null as Plan | null));
  return one ? datesOf(one).actions[0] ?? null : null;
});

// ── Schedule versions ────────────────────────────────────────────────────────
// ── Notices ──────────────────────────────────────────────────────────────────

type NoticeView = { id: string; subject: string; automatic: boolean; title: string; body: string | null; recipients: string[]; sentBy: string; sentAt: string };

/** Every notice whose subject starts with this, oldest first: what the notify panels count from. */
export const noticesAbout = cache(async (scope: Scope, subject: string): Promise<NoticeView[]> =>
  api<NoticeView[]>(projectPath(scope, "/notices"), { query: { subject } }).catch(() => [] as NoticeView[]));

/** What a notify panel says about the notices already sent on one matter. */
export function noticeHistory(notices: NoticeView[], now = new Date()): { count: number; daysSinceFirst: number | null; lastTo: string[] } {
  if (!notices.length) return { count: 0, daysSinceFirst: null, lastTo: [] };
  const first = new Date(notices[0].sentAt);
  return {
    count: notices.length,
    daysSinceFirst: Math.max(0, Math.floor((now.getTime() - first.getTime()) / 86_400_000)),
    lastTo: notices[notices.length - 1].recipients,
  };
}

/**
 * What on the schedule waits for the person asking (GET /activities-work): their discipline's confirmations,
 * a postponement to confirm, a request to add a document to an action, the schedule's upkeep.
 */
type ActionWork = {
  kind: "CONFIRM_DOCUMENTS" | "CONFIRM_POSTPONEMENT" | "ADD_TO_ACTION" | "CONFIRM_ACTION_REQUEST" | "CONFIRM_PERSON" | "UNTAGGED" | "SCHEDULE_READ_FAILED";
  activityId: string | null; code: string | null; name: string | null; day: string | null; department: string | null;
  count: number; since: string | null; transmittalId: string | null; number: string | null; from: string | null;
  /** On a request about an action: a document to add, or a missing discipline to tag. */
  ask: "DOCUMENT" | "DISCIPLINE" | null;
};

export const actionWork = cache(async (scope: Scope): Promise<ActionWork[]> =>
  api<ActionWork[]>(projectPath(scope, "/activities-work")).catch(() => []));

/** What a request will change once it is confirmed, as the control function checked it. */
export type ActivityProposal = { documentIds: string[] | null; department: string | null; departments: string[] | null; purpose: string | null; statuses: string[] | null };

/** A request about an action not yet answered (GET /activities/{id}/requests). */
export type ActivityRequest = {
  id: string; number: string; from: string; at: string; kind: "DOCUMENT" | "DISCIPLINE"; subject: string; message: string | null;
  /** Confirmed by whoever holds Manage: the control function checks it first, then whoever is asked confirms or refuses. */
  confirm: boolean; checkedAt: string | null; checkedBy: string | null; confirmerId: string | null; confirmerName: string | null;
  proposal: ActivityProposal | null; documentIds: string[];
};

export const activityRequests = cache(async (scope: Scope, activityId: string): Promise<ActivityRequest[]> =>
  api<ActivityRequest[]>(projectPath(scope, `/activities/${activityId}/requests`)).catch(() => []));
