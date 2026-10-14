// What this application checks about its own register: the same list as the backend's (backend/app/Checks/Catalog.cs),
// worded the same; keep the two in step.
//
// Every entry here is something the app can actually look at and answer from
// the records it holds. Conditions it prevents by construction are not listed —
// a document number cannot be typed, so there is no check that one was — and
// neither are conditions no record can settle, such as whether an unmarked copy
// was circulated. A check that cannot fail, and a check that can only fail, are
// both worse than no check: they teach people to ignore the page.
//
// Who fixes it: CF = document control · OR = whoever produced it · RV = the
// reviewer · OG = the organization.

export type Severity = "CRITICAL" | "MAJOR" | "MINOR" | "ADVISORY";
export type OwnerCode = "CF" | "OR" | "RV" | "OG";

/**
 * When a check bites.
 *
 * Three moments, because that is how a project is lived: what has to be in
 * place before anyone starts, what has to hold while the work runs, and what
 * has to be settled before it can be handed over. Grouping by these says more
 * to the person reading than the families the conditions were gathered under.
 */
export type Phase = "SETUP" | "RUNNING" | "HANDOVER";

export const PHASE_LABEL: Record<Phase, string> = {
  SETUP: "Setting the project up",
  RUNNING: "While the work runs",
  HANDOVER: "Closing and handing over",
};

export const PHASE_BLURB: Record<Phase, string> = {
  SETUP: "Lists, matrices and rules that have to be published before the register can be trusted. Each one is an administrator's to settle, once.",
  RUNNING: "The register against itself, every day: numbering, revisions, approvals, what was issued and to whom.",
  HANDOVER: "What has to be settled before anything is handed over or closed — retention, disposal, archives and packages.",
};

export type CheckDef = {
  id: string;
  /** Which of the three moments it belongs to. */
  phase: Phase;
  condition: string;
  /** How the application detects it. */
  method: string;
  /** What it reads to answer. */
  evidence: string;
  severity: Severity;
  owner: OwnerCode;
  /** A condition that cannot be true of a register that holds together. */
  contradiction?: boolean;
  /**
   * Information that was right when it was issued and may still be in use.
   * The same findings the out-of-date risks screen acts on, marked here so
   * they can be narrowed to from the catalogue like anything else.
   */
  outOfDate?: boolean;
};

const c = (id: string, phase: Phase, condition: string, method: string, evidence: string, severity: Severity, owner: OwnerCode, contradiction = false): CheckDef => ({
  id, phase, condition, method, evidence, severity, owner, contradiction,
});

/** What each group of checks is about, in the words of the work. */
export const FAMILY_TITLES: Record<string, string> = {
  IO: "Documents and records",
  ID: "Numbering",
  MD: "Description",
  CL: "Classification",
  RV: "Revisions",
  ST: "States and statuses",
  AP: "Approval",
  RO: "Review",
  FM: "Files and formats",
  IS: "Issue and distribution",
  OB: "Superseded and withdrawn",
  RT: "Retention",
  DB: "What the schedule needs",
  PK: "Packages",
  RG: "The register itself",
  SC: "The schedule",
  CF: "The checks themselves",
};

/**
 * The checks the backend runs (backend/app/Checks/Catalog.cs), in
 * its order and its words. The backend asks them and keeps what they found;
 * this list is what the screens say about each one, so it says what the
 * backend asks — a check listed here and never asked would read as never run.
 * Its moment is the backend's decision too.
 */
export const CATALOG: CheckDef[] = [
  c("ID-05", "SETUP", "A deliverable type no numbering scheme serves", "Each published deliverable type is routed to a numbering scheme (Settings → Numbering); otherwise nothing of that type can be registered", "Settings", "CRITICAL", "OG"),
  c("ST-04", "SETUP", "No status is published", "The statuses a revision is released at are published (Settings → Published lists); a status retired there leaves none", "Settings", "CRITICAL", "OG"),
  c("ST-06", "SETUP", "A status that does not say whether work may go ahead on it", "Every published status says whether work may go ahead on it (Settings → Published lists, Statuses: \"Allows work on site or in the shop\")", "Settings", "CRITICAL", "OG"),
  c("RO-01", "SETUP", "No verdict is published", "The verdicts the decider chooses from are published; a list emptied by retiring its verdicts leaves the decider nothing", "Settings", "CRITICAL", "OG"),
  c("RO-03", "SETUP", "A verdict that does not say which of the four meanings it has", "Every published verdict says accepted, accepted with comments, rejected or for information (a list uploaded from a spreadsheet may leave it out)", "Settings", "CRITICAL", "OG"),
  c("CL-06", "SETUP", "A criticality level with no meaning", "Each criticality level says what it means and decides (its retention period, at least); a list uploaded from a spreadsheet may leave it out", "Settings", "CRITICAL", "OG"),
  c("CL-07", "SETUP", "\"Who may see it\" has no level used when none is chosen", "One level of \"Who may see it\" is the default; unticked or retired, a new document starts with none", "Settings", "MAJOR", "OG"),
  c("RT-01", "SETUP", "No retention period used by default", "One retention period is the default, for a document whose criticality says none; retired, documents are left without one", "Settings", "CRITICAL", "OG"),
  c("IS-06", "SETUP", "Nobody on the project receives documents", "At least one function on the project holds Receive in the distribution matrix; otherwise a release proposes nobody", "Settings", "MAJOR", "OG"),
  c("IS-09", "SETUP", "A reason for issue that asks an answer but sets no period", "A reason that asks an answer gives its period in working days (Settings → Published lists, Reasons for issue), so a transmittal asking it is given a day", "Settings", "MAJOR", "OG"),
  c("MD-02", "RUNNING", "A title that became generic", "Titles made only of words added to the organization's generic list after the document was registered (new titles of that kind are refused)", "Register", "MINOR", "OR"),
  c("MD-03", "RUNNING", "A field its deliverable type requires is empty", "Each document against the fields its deliverable type requires now (the type may have been given more since, or a field cleared on a revision)", "Register + settings", "MAJOR", "OR"),
  c("MD-05", "RUNNING", "Received from another organization with no date received", "Documents of an outside organization of which something came in, with no date received (a placeholder not received yet is not counted)", "Register", "MAJOR", "CF"),
  c("MD-06", "RUNNING", "A field holds a value since retired", "Each document's discipline, type, criticality, \"who may see it\" and retention against the lists as published now (a value retired after use)", "Register + settings", "MAJOR", "CF"),
  c("RT-03", "RUNNING", "No retention period on the document", "Documents with no retention period: none chosen, and neither its criticality nor a default gives one", "Register", "MAJOR", "OR"),
  c("RV-09", "RUNNING", "A void left the document with no released revision", "Documents with a superseded revision and none released: the newest released one was voided and nothing replaced it", "Register", "CRITICAL", "CF", true),
  c("ST-05", "RUNNING", "Released at a status since retired", "The status of each released revision against the statuses as published now", "Register + settings", "MAJOR", "CF"),
  c("RO-02", "RUNNING", "Decided with a verdict since retired", "Reviews decided and not yet released, whose verdict was retired since", "Register + settings", "MAJOR", "CF"),
  c("RO-06", "RUNNING", "An open comment whose weight was retired", "Open comments whose weight (comment, blocking comment…) is no longer published", "Register + settings", "MAJOR", "RV"),
  c("FM-01", "RUNNING", "Released with no native file", "Released revisions with no native file beside the PDF (it is optional; the editable original helps the next revision)", "Files", "ADVISORY", "OR"),
  c("FM-06", "RUNNING", "A file the register lists is missing from storage (outside the app)", "Asks storage for a sample of current files, 25 a run", "Files", "CRITICAL", "CF"),
  c("FM-07", "RUNNING", "A file changed in storage after it was kept (outside the app)", "Re-reads a sample of current files, 5 a run, against the fingerprint taken on arrival", "Files", "CRITICAL", "CF"),
  c("IS-11", "RUNNING", "Released and never sent", "Released revisions no transmittal carried (other than for review): only when the project releases and issues separately, or a type released with no review", "Register + transmittals", "ADVISORY", "CF"),
  c("RG-01", "RUNNING", "The history has a broken link (outside the app)", "Recomputes the hash chain of the organization's audit trail", "History", "CRITICAL", "CF"),
  c("SC-04", "SETUP", "A schedule is followed but no \"Went ahead?\" answers are published", "With a schedule, the answers to \"Went ahead?\" (went ahead, postponed…) are published, each saying whether the action went ahead", "Settings", "MAJOR", "OG"),
  c("SC-01", "RUNNING", "The released schedule could not be read", "The schedule document's released revision against what was read from it (also on Home)", "Register + schedule", "MAJOR", "CF"),
  c("SC-02", "RUNNING", "An action past its day that a concerned discipline has not confirmed", "Actions past their day, not postponed, with a document still missing, where a concerned discipline has not confirmed going ahead (by hand or automatically)", "Register + schedule", "MAJOR", "CF"),
  c("PK-06", "HANDOVER", "A delivery package not checked for readiness by its date", "Open delivery packages past their date whose readiness was never checked (a supplier's package has no single date)", "Register", "MAJOR", "CF"),
];

export const CHECK_BY_ID = new Map(CATALOG.map((c) => [c.id, c]));
/** The checks about information that is no longer current but may still be in somebody's hands. */
const OUT_OF_DATE = new Set(["RO-08", "IS-02", "OB-01", "OB-02", "OB-04", "OB-07"]);
for (const c of CATALOG) if (OUT_OF_DATE.has(c.id)) c.outOfDate = true;
