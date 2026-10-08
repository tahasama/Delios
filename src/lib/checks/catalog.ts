// What this application checks about its own register.
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
 * The checks the backend runs (backend/src/Delios.Host/Checks/Catalog.cs), in
 * its order and its words. The backend asks them and keeps what they found;
 * this list is what the screens say about each one, so it says what the
 * backend asks — a check listed here and never asked would read as never run.
 * Its moment is the backend's decision too.
 */
export const CATALOG: CheckDef[] = [
  c("ID-05", "SETUP", "A deliverable type with no numbering scheme", "Each published deliverable type is routed to a numbering scheme", "Settings", "CRITICAL", "OG"),
  c("RV-01", "SETUP", "No revision scheme for a deliverable type", "Each deliverable type has a revision scheme routed to it, or a default exists", "Settings", "CRITICAL", "OG"),
  c("ST-04", "SETUP", "No list of statuses published", "The statuses a released revision may carry are published", "Settings", "CRITICAL", "OG"),
  c("ST-06", "SETUP", "A status that does not say whether work may proceed on it", "Every published status carries 'executes'", "Settings", "CRITICAL", "OG"),
  c("RO-01", "SETUP", "No list of review verdicts published", "The deciding step's verdicts are published", "Settings", "CRITICAL", "OG"),
  c("RO-03", "SETUP", "A verdict that does not say whether work may proceed", "Every published verdict carries 'proceed'", "Settings", "CRITICAL", "OG"),
  c("CL-06", "SETUP", "A criticality class that decides nothing", "Each criticality class says what follows from it (its retention, at least)", "Settings", "CRITICAL", "OG"),
  c("CL-07", "SETUP", "Confidentiality levels with no default", "A default level is published for documents that state none", "Settings", "MAJOR", "OG"),
  c("RT-01", "SETUP", "No retention classes, or none by default", "Retention classes are published and one is the default", "Settings", "CRITICAL", "OG"),
  c("IS-06", "SETUP", "Nobody receives documents", "At least one function on the project holds RECEIVE in the matrix", "Settings", "MAJOR", "OG"),
  c("IS-09", "SETUP", "A reason for issue that wants an answer but sets no period", "Reasons with 'response' carry 'responseDays'", "Settings", "MAJOR", "OG"),
  c("MD-02", "RUNNING", "A title that says nothing about the document", "Titles made only of the organization's generic words", "Register", "MINOR", "OR"),
  c("MD-03", "RUNNING", "A field its deliverable type requires is empty", "The deliverable type's 'required' list against each document", "Register + settings", "MAJOR", "OR"),
  c("MD-05", "RUNNING", "A document from another organization with no date received", "Documents whose originator is an outside party, with the received date empty", "Register", "MAJOR", "CF"),
  c("MD-06", "RUNNING", "A field holds a value that is not in its list", "Each controlled field against the list it draws from, as published now", "Register + settings", "MAJOR", "CF"),
  c("CL-05", "RUNNING", "Criticality missing", "Where criticality classes are published, documents carrying none", "Register", "MAJOR", "OR"),
  c("RT-03", "RUNNING", "No retention class on the document", "Documents carrying none", "Register", "MAJOR", "OR"),
  c("RV-05", "RUNNING", "Two revisions of one document in motion at once", "Revisions in preparation, in review, received or being corrected, per document", "Register", "MAJOR", "CF"),
  c("RV-08", "RUNNING", "Two current revisions of one document", "Released revisions per document that nothing superseded", "Register", "CRITICAL", "CF", true),
  c("RV-09", "RUNNING", "A document once released with nothing current now", "Documents with a superseded revision and no released one", "Register", "CRITICAL", "CF", true),
  c("ST-03", "RUNNING", "Released with no status", "Released revisions whose status is empty", "Register", "CRITICAL", "CF"),
  c("ST-05", "RUNNING", "Released at a status that is no longer published", "The status of each current revision against the published list", "Register + settings", "MAJOR", "CF"),
  c("AP-01", "RUNNING", "Released with nobody's decision on record", "Released or superseded revisions with no review that released them", "Register", "CRITICAL", "CF", true),
  c("RO-02", "RUNNING", "A verdict that is no longer published", "Verdicts given on decided reviews, against the published list", "Register + settings", "MAJOR", "CF"),
  c("RO-06", "RUNNING", "An open comment whose class is no longer published", "Open comments' classes against the published list", "Register + settings", "MAJOR", "RV"),
  c("FM-01", "RUNNING", "The editable original was not kept", "Current revisions with no native file beside the PDF", "Files", "MAJOR", "OR"),
  c("FM-06", "RUNNING", "A file the register lists is missing from storage", "Asks storage for a sample of current files, 25 a run", "Files", "CRITICAL", "CF"),
  c("FM-07", "RUNNING", "A file changed after it was stored", "Re-reads a sample of current files, 5 a run, against the fingerprint taken on arrival", "Files", "CRITICAL", "CF"),
  c("IS-11", "RUNNING", "Released and never sent", "Current revisions no transmittal has carried, other than for review", "Register + transmittals", "ADVISORY", "CF"),
  c("RG-01", "RUNNING", "The audit trail has a broken link", "Recomputes the hash chain of the organization's audit trail", "History", "CRITICAL", "CF"),
  c("SC-04", "SETUP", "A schedule is followed but no activity decisions are published", "Projects with a schedule document have a list of decisions, each saying whether the activity went ahead", "Settings", "MAJOR", "OG"),
  c("SC-01", "RUNNING", "The released schedule could not be read", "The schedule document's current revision against what was read from it", "Register + schedule", "MAJOR", "CF"),
  c("SC-02", "RUNNING", "An activity started without its documents and nobody decided", "Activities past their start with a document still missing and no decision recorded", "Register + schedule", "MAJOR", "CF"),
  c("SC-03", "RUNNING", "A waived document never came", "Waived needs whose activity has finished (or started, with no finish) and whose document is still not there", "Register + schedule", "MINOR", "OR"),
  c("PK-06", "HANDOVER", "A package not assessed by its completion date", "Open packages past their completion date with no assessment since", "Register", "MAJOR", "CF"),
];

export const CHECK_BY_ID = new Map(CATALOG.map((c) => [c.id, c]));
/** Check families in catalogue order — the letters before the dash (ID, MD, RV…). */
export const FAMILIES = [...new Set(CATALOG.map((c) => c.id.split("-")[0]))];

/** The checks about information that is no longer current but may still be in somebody's hands. */
const OUT_OF_DATE = new Set(["RO-08", "IS-02", "OB-01", "OB-02", "OB-04", "OB-07"]);
for (const c of CATALOG) if (OUT_OF_DATE.has(c.id)) c.outOfDate = true;
