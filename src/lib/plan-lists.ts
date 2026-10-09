import "server-only";
import { api, projectPath } from "@/lib/api/client";
import { getActiveSet } from "@/lib/config";
import { scheduleSource } from "@/lib/api/schedule";

/**
 * The three lists the schedule rests on, each a controlled document: uploading
 * one is a new revision of it, and releasing that revision is the approval that
 * puts it in force — the dates, the disciplines per action, the documents each
 * action needs.
 */
export type PlanListKind = "SCHEDULE" | "DEPARTMENTS" | "REQUIREMENTS";

export type PlanListDocument = { id: string; number: string; title: string; latestRevisionValue: string | null; latestRevisionState: string | null };

export type PlanList = {
  kind: PlanListKind;
  title: string;
  /** Who fills it, and what it carries, in one line. */
  says: string;
  /** The document types that hold it, as the organization names them. */
  types: { code: string; label: string }[];
  /** The documents that hold it on this project; the schedule has one. */
  documents: PlanListDocument[];
  /** A sheet to fill, where the system can give one. */
  template: string | null;
};

type Summary = { id: string; number: string; title: string; latestRevision: string | null; latestRevisionState: string | null };

const flagged = (props: Record<string, unknown>, flag: string) => props[flag] === true;

export async function planLists(scope: { projectId: string }): Promise<PlanList[]> {
  const [types, source] = await Promise.all([getActiveSet("DOCUMENT_TYPES"), scheduleSource(scope)]);
  const ofTypes = async (codes: string[]): Promise<PlanListDocument[]> => {
    const pages = await Promise.all(codes.map((docType) =>
      api<{ items: Summary[] }>(projectPath(scope, "/documents"), { query: { docType, limit: 50 } }).then((page) => page.items).catch(() => [] as Summary[])));
    return pages.flat().map((one) => ({ id: one.id, number: one.number, title: one.title, latestRevisionValue: one.latestRevision, latestRevisionState: one.latestRevisionState }));
  };
  const pick = (flag: string | null, code: string) => types
    .filter((one) => (flag ? flagged(one.props, flag) : one.code === code))
    .map((one) => ({ code: one.code, label: one.label }));

  const scheduleTypes = pick(null, "SCH");
  const departmentTypes = pick("readsDepartments", "DPA");
  const requirementTypes = pick("readsRequirements", "RQL");
  const [schedules, departments, requirements] = await Promise.all([
    ofTypes(scheduleTypes.map((one) => one.code)),
    ofTypes(departmentTypes.map((one) => one.code)),
    ofTypes(requirementTypes.map((one) => one.code)),
  ]);
  // The schedule is the project's one schedule document, once it is named.
  const named = source.source ? schedules.filter((one) => one.id === source.source!.documentId) : [];

  return [
    {
      kind: "SCHEDULE",
      title: "Schedule",
      says: "The planner's export (.xlsx or .csv): every action and its date.",
      types: scheduleTypes,
      documents: named.length ? named : schedules,
      template: null,
    },
    {
      kind: "DEPARTMENTS",
      title: "Disciplines per action",
      says: "The project manager's list: which disciplines each action concerns.",
      types: departmentTypes,
      documents: departments,
      template: "/api/controlled/current/ACTION_DEPARTMENTS",
    },
    {
      kind: "REQUIREMENTS",
      title: "Document requirements",
      says: "What each discipline needs for each action, from whom, by when.",
      types: requirementTypes,
      documents: requirements,
      template: null,
    },
  ];
}
