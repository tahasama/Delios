import "server-only";
import { api, projectPath } from "@/lib/client";

/** A list read from a register document or from a file uploaded: the schedule's three, and Import & export's four. */
export type ListSourceKind = "SCHEDULE" | "ACTION_DEPARTMENTS" | "DOCUMENT_REQUIREMENTS" | "DELIVERABLES" | "TEAM" | "MATRIX" | "LISTS";

export type ListSource = {
  kind: ListSourceKind;
  title: string;
  /** The page it is brought in on. */
  where: "SCHEDULE" | "IMPORT";
  /** The register document it is read from: chosen by the control function, or (chosenByApp) found by the old rule. */
  document: { id: string; number: string; title: string; releasedRevisionId: string | null; releasedValue: string | null; releasedAt: string | null; chosenByApp: boolean } | null;
  /** What it was read from last: its register document's released revision, or a file uploaded. */
  last: { from: "DOCUMENT" | "UPLOAD"; label: string | null; byName: string | null; at: string | null; revisionId: string | null } | null;
  /** Whether the person reading may choose its register document (the control function). */
  mayChoose: boolean;
};

/** The schedule's lists by the names its screens use. */
export const SCHEDULE_KIND: Record<string, ListSourceKind> = { SCHEDULE: "SCHEDULE", DEPARTMENTS: "ACTION_DEPARTMENTS", REQUIREMENTS: "DOCUMENT_REQUIREMENTS" };

/** Every list's register document and what it was read from last (our own people only; anyone else reads none). */
export async function listSources(scope: { projectId: string }): Promise<ListSource[]> {
  return api<ListSource[]>(projectPath(scope, "/lists/sources"), { keep: { areas: ["plan", "docs"] } }).catch(() => []);
}

/** Where the register is opened to choose a list's document, and where it comes back to. */
export const chooseHref = (kind: ListSourceKind, where: "SCHEDULE" | "IMPORT") =>
  `/documents?pick=${encodeURIComponent(`src:${kind}`)}${where === "IMPORT" ? "&back=import" : ""}`;
