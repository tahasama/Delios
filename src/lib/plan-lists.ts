import "server-only";
import { api, projectPath } from "@/lib/api/client";
import { getActiveSet } from "@/lib/config";
import { scheduleSource } from "@/lib/api/schedule";
import { backendDocument } from "@/lib/api/legacy";
import { controlledSets } from "@/lib/api/admin";

/**
 * The three lists the schedule rests on, each a document in the register: the
 * dates, the disciplines per action, the documents each discipline needs. Its
 * revisions are made and released on the document's page; on the schedule the
 * spreadsheet of the revision in force is uploaded and read.
 */
export type PlanListKind = "SCHEDULE" | "DEPARTMENTS" | "REQUIREMENTS";

export type PlanListDocument = {
  id: string; number: string; title: string; latestRevisionValue: string | null; latestRevisionState: string | null;
  /** The revision in force: the one whose spreadsheet is uploaded here. */
  released: { id: string; value: string } | null;
  /** Whether that revision's list has been read already: another file for it then needs a reason. */
  read: boolean;
  /** A later revision on its way, not in force yet. */
  pending: { value: string; state: string } | null;
};

export type PlanList = {
  kind: PlanListKind;
  title: string;
  /** Who fills it, and what it carries, in one line. */
  says: string;
  /** The document types that hold it, as the organization names them. */
  types: { code: string; label: string }[];
  /** The documents that hold it on this project; the schedule has one. */
  documents: PlanListDocument[];
  /** The sheet to fill, with the headings the reader looks for. */
  template: string;
  /** What is in force was uploaded here without a document, after any document's read: when. */
  direct: Date | null;
};

type Summary = { id: string; number: string; title: string; latestRevision: string | null; latestRevisionState: string | null };

const flagged = (props: Record<string, unknown>, flag: string) => props[flag] === true;

export async function planLists(scope: { projectId: string }): Promise<PlanList[]> {
  const [types, source, uploaded] = await Promise.all([getActiveSet("DOCUMENT_TYPES"), scheduleSource(scope), controlledSets(scope).catch(() => [])]);
  const ofTypes = async (codes: string[]): Promise<PlanListDocument[]> => {
    const pages = await Promise.all(codes.map((docType) =>
      api<{ items: Summary[] }>(projectPath(scope, "/documents"), { query: { docType, limit: 50 } }).then((page) => page.items).catch(() => [] as Summary[])));
    return Promise.all(pages.flat().map(async (one) => {
      const view = await backendDocument(scope, one.id);
      const revisions = view?.revisions ?? [];
      const released = [...revisions].reverse().find((r) => r.state === "RELEASED") ?? null;
      const last = revisions.at(-1) ?? null;
      return {
        id: one.id, number: one.number, title: one.title, latestRevisionValue: one.latestRevision, latestRevisionState: one.latestRevisionState,
        released: released ? { id: released.id, value: released.value } : null,
        read: false,
        pending: last && last !== released && !["SUPERSEDED", "VOID"].includes(last.state) ? { value: last.value, state: last.state } : null,
      };
    }));
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
  // Which released revisions have had their list read: the schedule's reads, and the other lists' records.
  const readLabels = new Set(uploaded.flatMap((set) => set.versions).filter((v) => v.state === "APPROVED" && v.sourceName).map((v) => v.sourceName!));
  for (const doc of schedules) if (doc.released) doc.read = source.imports.some((one) => one.revisionId === doc.released!.id && one.status === "DONE");
  for (const doc of [...departments, ...requirements]) if (doc.released) doc.read = readLabels.has(`${doc.number} rev ${doc.released.value}`);
  // Whether what is in force came from an upload with no document, later than any document's read.
  const versionsOf = (kind: string) => uploaded.filter((set) => set.kind === kind).flatMap((set) => set.versions).filter((v) => v.state === "APPROVED");
  const newest = (dates: Date[]) => dates.reduce<Date | null>((top, one) => (!top || one > top ? one : top), null);
  const direct = (kind: string, documentRead: Date | null) => {
    const versions = versionsOf(kind);
    const loose = newest(versions.filter((v) => v.versionLabel.startsWith("upload")).map((v) => v.createdAt));
    const read = documentRead ?? newest(versions.filter((v) => !v.versionLabel.startsWith("upload")).map((v) => v.createdAt));
    return loose && (!read || loose > read) ? loose : null;
  };
  const scheduleRead = newest(source.imports.filter((one) => one.status === "DONE").map((one) => new Date(one.importedAt)));
  // The schedule is the project's one schedule document, once it is named.
  const named = source.source ? schedules.filter((one) => one.id === source.source!.documentId) : [];

  return [
    {
      kind: "SCHEDULE",
      title: "Schedule",
      says: "The planner's export (.xlsx or .csv): every action and its date.",
      types: scheduleTypes,
      documents: named.length ? named : schedules,
      template: "/api/plan-template/SCHEDULE",
      direct: direct("SCHEDULE", scheduleRead),
    },
    {
      kind: "DEPARTMENTS",
      title: "Disciplines per action",
      says: "Which disciplines each action concerns.",
      types: departmentTypes,
      documents: departments,
      template: "/api/plan-template/DEPARTMENTS",
      direct: direct("ACTION_DEPARTMENTS", null),
    },
    {
      kind: "REQUIREMENTS",
      title: "Document requirements",
      says: "What each discipline needs for each action, from whom, by when.",
      types: requirementTypes,
      documents: requirements,
      template: "/api/plan-template/REQUIREMENTS",
      direct: direct("DOCUMENT_REQUIREMENTS", null),
    },
  ];
}
