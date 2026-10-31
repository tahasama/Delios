// Plain words only: the full download's form runs in the browser (never import lib/client.ts here).

/** The levels the folders may be made of, in the backend's codes (FullDownloadLevels), in plain words. */
export const LEVELS: { code: string; label: string }[] = [
  { code: "PROJECT", label: "Project" },
  { code: "DELIVERABLE", label: "Deliverable type" },
  { code: "DISCIPLINE", label: "Discipline" },
  { code: "DOCTYPE", label: "Document type" },
  { code: "PHASE", label: "Phase" },
  { code: "ORIGINATOR", label: "Originator" },
];
