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

/**
 * When each check bites.
 *
 * It used to be read off the wording of the condition, which worked until the
 * conditions were written in plainer words and half of them changed moment
 * overnight. A check's moment is a decision, so it is written down.
 *
 * Setting up: something that has to be published once before the register can
 * be trusted. Closing: retention, disposal, archives, packages and the
 * statement itself. Everything else is the work.
 */
const SETUP_CHECKS = new Set([
  "IO-05", "MD-01", "CL-02", "CL-06", "CL-07", "RV-01", "ST-04", "ST-06",
  "AP-02", "RO-01", "RO-03", "RO-04", "IS-06", "IS-09", "RT-01", "RT-02",
  "SC-01", "SC-02", "SC-03",
]);
const HANDOVER_CHECKS = new Set(["FM-05", "PK-06", "PK-07", "PK-08", "RT-04", "RT-05", "RT-08", "CF-02"]);

function phaseOf(id: string): Phase {
  if (SETUP_CHECKS.has(id)) return "SETUP";
  if (HANDOVER_CHECKS.has(id)) return "HANDOVER";
  return "RUNNING";
}

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

const c = (id: string, condition: string, method: string, evidence: string, severity: Severity, owner: OwnerCode, contradiction = false): CheckDef => ({
  id, phase: phaseOf(id), condition, method, evidence, severity, owner, contradiction,
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
  SC: "Project scope",
  CF: "The checks themselves",
};

export const CATALOG: CheckDef[] = [
  // ── Documents and records
  c("IO-01", "A record carries revision numbers", "A record is fixed evidence and is never revised; this finds records with revisions against them", "Register", "MAJOR", "CF"),
  c("IO-02", "Filed as a record, but later ones replace it", "Looks for items filed as records where a later one replaces the earlier - that makes it a document, not a record", "Register + transmittals", "MAJOR", "CF"),
  c("IO-03", "A confirmed record was altered afterwards", "Compares the record as it stands now against its history of changes", "History", "CRITICAL", "CF"),
  c("IO-04", "A correction that does not say what it corrects", "Finds corrections with no link to the record they put right", "Register", "MAJOR", "OR"),
  c("IO-05", "Issue codes not matched to the reasons they stand for", "Checks the published list of issue codes says, for each code, which reason for issue it means", "Settings", "MAJOR", "OG"),
  // ── Numbering
  c("ID-01", "A number whose separator falls inside a field", "Splits each document number by its separator and finds parts that are empty or run together", "Register", "MAJOR", "CF"),
  c("ID-02", "A number holds a value that is not in its list", "Takes each field of the number and checks the value against the list that field draws from", "Register + settings", "MAJOR", "CF"),
  c("ID-03", "A file is not named after its document", "Compares the start of each stored file name with the document number", "History + transmittals", "MAJOR", "CF"),
  c("ID-04", "An outside document arrived before a number existed for it", "Finds documents whose earliest transmittal came from outside, so no number was recorded before it was received", "Settings + register", "MAJOR", "CF"),
  // ── Description
  c("MD-01", "No register has been named as the one that counts", "Checks a register is nominated in settings as the authoritative one", "Settings", "CRITICAL", "OG"),
  c("MD-02", "A title that says nothing about the document", "Finds titles that only repeat the document type, or are otherwise empty of meaning", "Register", "MINOR", "OR"),
  c("MD-03", "A field this deliverable type requires is empty", "Reads the type-to-field matrix and finds documents missing a field their type requires", "Register + settings", "MAJOR", "OR"),
  c("MD-04", "A field that does not apply was filled with a placeholder", "Looks for N/A, dashes and the like in fields the document type says do not apply", "Register + settings", "MINOR", "OR"),
  c("MD-05", "An incoming document with no date of receipt", "Finds documents from outside parties with the date received left empty", "Register", "MAJOR", "CF"),
  c("MD-06", "A field holds a value that is not in its list", "Compares every controlled field on the register against the published list it draws from", "Register + settings", "MAJOR", "CF"),
  // ── Classification
  c("CL-01", "A value from one list used in another", "Cross-checks each classification against its own list - a discipline sitting in the document type field, for instance", "Register", "MAJOR", "CF"),
  c("CL-02", "No matrix saying which fields each deliverable type needs", "Checks the type-to-field matrix has been published", "Settings", "CRITICAL", "OG"),
  c("CL-03", "Document type missing, or not one of ours", "Finds documents with no type, or a type that is not in the published set", "Register", "MAJOR", "OR"),
  c("CL-04", "Discipline missing", "Finds documents with no discipline against them", "Register", "MAJOR", "OR"),
  c("CL-05", "Criticality missing", "Where criticality is in use, finds documents carrying none", "Register", "MAJOR", "OR"),
  c("CL-06", "Criticality decides nothing", "Each class should say what follows from it - who approves, how long it is kept, what format. This finds classes with no consequences published", "Settings", "CRITICAL", "OG", true),
  c("CL-07", "Confidentiality missing, and no default published", "Checks a default is published for documents that state none", "Settings", "MAJOR", "OG"),
  c("CL-08", "Not linked to the equipment it describes", "Finds documents that should name an asset and do not", "Register", "MAJOR", "OR"),
  // ── Revisions
  c("RV-01", "No revision scheme published", "Checks the organization has published how revisions are numbered", "Settings", "CRITICAL", "OG"),
  c("RV-02", "A revision outside the series it should be using", "Compares each revision value with the published series and the point where drafts become issues", "Register", "MAJOR", "CF"),
  c("RV-03", "Revisions going backwards", "Puts a document's revisions in date order and finds any that go down instead of up", "Register", "CRITICAL", "CF", true),
  c("RV-04", "The same revision number twice on one document", "Counts repeated revision values per document", "Register", "CRITICAL", "CF", true),
  c("RV-05", "Two revisions of one document being written at once", "Counts revisions in preparation per document", "Register", "MAJOR", "CF"),
  c("RV-08", "Two current revisions of the same document", "Counts released revisions per document that nothing has superseded", "Register", "CRITICAL", "CF", true),
  c("RV-09", "A document in use with nothing current to use", "Finds documents in use that once had a released revision and now have none", "Register", "CRITICAL", "CF", true),
  // ── States and statuses
  c("ST-02", "An older revision still current after its replacement", "Counts released revisions per document", "Register", "CRITICAL", "CF", true),
  c("ST-03", "Released with no status", "Finds released revisions whose status is empty", "Register", "CRITICAL", "CF"),
  c("ST-04", "No status list published", "Checks the set of statuses has been published", "Settings", "CRITICAL", "OG"),
  c("ST-05", "A status that is not in the published list", "Compares each status used against the published set", "Register + settings", "MAJOR", "CF"),
  c("ST-06", "The list does not say which statuses allow work", "Checks every status says whether work may proceed on it", "Settings", "CRITICAL", "OG"),
  c("ST-07", "Work proceeding on a status that does not allow it", "Compares schedule actions against the status of the documents they run on", "Register", "CRITICAL", "OG", true),
  // ── Approval
  c("AP-01", "Released with nobody's approval recorded", "Finds released revisions with no approval against them", "Register", "CRITICAL", "CF", true),
  c("AP-02", "No matrix saying who may approve what", "Checks the authority matrix has been published", "Settings", "CRITICAL", "OG"),
  c("AP-04", "Approved by somebody without the authority", "Compares each approver against the matrix in force on that date", "Register + settings", "CRITICAL", "CF", true),
  c("AP-05", "Approved under a delegation that had expired", "Compares the approval date with the dates the delegation ran", "Register + settings", "CRITICAL", "CF", true),
  c("AP-06", "A delegation passed on again", "Finds delegations granted by somebody who was themselves standing in", "Settings", "MAJOR", "OG"),
  c("AP-08", "An approval withdrawn with no reason or authority", "Finds withdrawals with either of them missing", "Register", "MAJOR", "CF"),
  c("AP-09", "Approval withdrawn, document still in use", "Compares withdrawals against the document's state", "Register", "CRITICAL", "CF", true),
  // ── Review
  c("RO-01", "No list of review verdicts published", "Checks the set of verdicts has been published", "Settings", "CRITICAL", "OG"),
  c("RO-02", "A verdict that is not in the published list", "Compares each verdict given against the published set", "Register + settings", "MAJOR", "CF"),
  c("RO-03", "A verdict that does not say whether work may proceed", "Checks every verdict carries that consequence", "Settings", "CRITICAL", "OG"),
  c("RO-04", "A verdict that does not say whether it must come back", "Checks every verdict says whether it calls for a new revision", "Settings", "CRITICAL", "OG"),
  c("RO-05", "Told to resubmit, but no revision was authorized", "Compares verdicts asking for resubmission against revision authorizations", "Register", "CRITICAL", "CF", true),
  c("RO-06", "A comment that does not say whether it stops the work", "Counts comments left unclassified", "Register", "MAJOR", "RV"),
  c("RO-07", "A blocking comment closed with no answer", "Finds closures with no recorded response", "Register", "MAJOR", "RV"),
  c("RO-08", "Work proceeding with a blocking comment open", "Compares schedule actions against comments still open on the document", "Register", "CRITICAL", "OG", true),
  // ── Files and formats
  c("FM-01", "The editable original was not kept", "Finds released revisions with no native file", "Files", "MAJOR", "OR"),
  c("FM-02", "No record of what application made the file", "For proprietary formats, finds revisions with the application and version not recorded", "Register", "MINOR", "OG"),
  c("FM-04", "A PDF that needs the authoring application to read", "Compares each rendition's format against the published list", "Files", "MAJOR", "CF"),
  c("FM-05", "Kept for the long term in a format that will not last", "Where retention outlives the project, compares the format against the published preservation formats", "Files", "MAJOR", "OG"),
  c("FM-06", "A file is missing or will not open", "Tries to read a sample of released files and counts the failures", "Files", "CRITICAL", "CF"),
  c("FM-07", "A file changed after it was released", "Compares the file's fingerprint now against the one taken at release", "Files + history", "CRITICAL", "CF"),
  // ── Issue and distribution
  c("IS-01", "A transmittal missing something it must carry", "Counts transmittals with a required element empty", "Register", "MAJOR", "CF"),
  c("IS-02", "A superseded revision issued without being marked as such", "Compares each issue date with the date that revision was superseded", "Register", "MAJOR", "CF"),
  c("IS-03", "Issued to a role rather than to people", "Finds transmittals with no named recipients", "Register", "MAJOR", "CF"),
  c("IS-04", "Received before it was sent", "Compares receipt dates against issue dates", "Register", "MAJOR", "CF"),
  c("IS-06", "No distribution rules published", "Checks who gets what has been published", "Settings", "MAJOR", "OG"),
  c("IS-07", "A rejection with no reason", "Finds rejected transmittals with the reason empty", "Register", "MAJOR", "CF"),
  c("IS-08", "Several documents issued, but reviewed as one", "Counts review cycles against the items the transmittal carried", "Register", "MAJOR", "CF"),
  c("IS-09", "No periods published for checking or answering", "Checks the acceptance and response periods have been published", "Settings", "MAJOR", "OG"),
  c("IS-10", "A transmittal not checked in time", "Compares the date it was accepted against the date it arrived", "Register", "MAJOR", "CF"),
  // ── Superseded and withdrawn
  c("OB-01", "Superseded or withdrawn with no date or authority", "Counts end-state records with either of them missing", "Register", "MAJOR", "CF"),
  c("OB-02", "Work still running on a withdrawn or void document", "Compares schedule actions against the state of the documents they run on", "Register", "CRITICAL", "OG", true),
  c("OB-04", "Not everybody who received it was told", "Compares who was notified against everybody it was ever issued to", "Register", "MAJOR", "CF"),
  c("OB-07", "Declared void, and nothing says what was built from it", "Compares void records against reassessments of the work done from them", "Register", "CRITICAL", "OG", true),
  // ── Retention
  c("RT-01", "No retention schedule published", "Checks how long each class is kept has been published", "Settings", "CRITICAL", "OG"),
  c("RT-02", "A retention class that does not say what it counts from", "Finds classes with no basis - from release, from handover, from the end of the plant's life", "Settings", "MAJOR", "OG"),
  c("RT-03", "No retention class on the document", "Finds documents carrying none", "Register", "MAJOR", "OR"),
  c("RT-04", "Archived material that cannot be fetched back", "Tries to retrieve a sample from the archive and counts the failures", "Files", "CRITICAL", "CF"),
  c("RT-05", "Archived material with no register entry", "Compares the archive against the register", "Register + files", "CRITICAL", "CF", true),
  c("RT-08", "Destroyed while under a legal hold", "Compares disposals against the register of holds", "Register", "CRITICAL", "OG", true),
  // ── What the schedule needs
  c("DB-01", "An action with no code, or a code used twice", "Finds schedule actions with the code empty, and codes used more than once", "Register", "MAJOR", "OG"),
  c("DB-02", "An action that does not come from the schedule", "Compares action codes against the schedule they should come from", "Register", "MAJOR", "OG"),
  c("DB-03", "A schedule need missing something it must carry", "Counts entries with a required field empty", "Register", "MAJOR", "CF"),
  c("DB-04", "A date that was not worked back from the action it serves", "Compares the required-by date against the action date and the lead time", "Register", "MAJOR", "CF"),
  c("DB-05", "The agreed date and the schedule date disagree", "Compares the baseline against the schedule as it stands", "Register", "CRITICAL", "CF", true),
  c("DB-06", "An action went ahead without checking its documents were ready", "Compares action records against readiness verifications", "Register", "CRITICAL", "OG", true),
  // ── Packages
  c("PK-01", "A package that does not say what kind it is", "Finds packages with the type empty", "Register", "MAJOR", "OG"),
  c("PK-02", "A fixed package with no agreed contents", "Finds packages whose membership was never agreed", "Register", "CRITICAL", "OG"),
  c("PK-03", "A growing package with no rule for what joins it", "Finds packages that accumulate with no membership rule stated", "Register", "CRITICAL", "OG"),
  c("PK-04", "Nobody owns what goes into the package", "Finds packages with no composition owner", "Register", "MAJOR", "OG"),
  c("PK-05", "The same person fills the package and accepts it", "Compares the composition owner against the acceptance authority", "Register", "CRITICAL", "OG", true),
  c("PK-06", "A package not assessed when it was due", "Compares assessments against the completion date", "Register", "MAJOR", "CF"),
  c("PK-07", "Closed with a shortfall nobody accepted", "Compares closures against shortfalls and acceptances", "Register", "CRITICAL", "OG", true),
  c("PK-08", "A growing package closed without saying it stopped growing", "Finds closures with no statement that the rule ceased", "Register", "MINOR", "OG"),
  c("PK-09", "No reason for issue on the package", "Finds packages with the reason for issue empty", "Register", "MAJOR", "OG"),
  // ── The register itself
  c("RG-01", "A file in the store with no document behind it", "Compares the file store against the register", "Files", "CRITICAL", "CF", true),
  // ── Project scope
  c("SC-01", "The scope of all this was never stated", "Checks a scope statement is recorded", "Settings", "CRITICAL", "OG"),
  c("SC-02", "The project's own settings are incomplete", "Checks every list, matrix and rule the project runs on has been published", "Settings", "CRITICAL", "OG"),
  c("SC-03", "No date from which the rules apply", "Checks an effective date is recorded", "Settings", "CRITICAL", "OG"),
  // ── The checks themselves
  c("CF-01", "A finding accepted with no date to look at it again", "Finds acceptances with the review date empty", "Register", "MINOR", "OG"),
  c("CF-02", "Nothing was measured before the statement was made", "Compares when the checks last ran against handovers, statements and changes to the settings", "History", "MAJOR", "OG"),
];

export const CHECK_BY_ID = new Map(CATALOG.map((c) => [c.id, c]));
/** Check families in catalogue order — the letters before the dash (ID, MD, RV…). */
export const FAMILIES = [...new Set(CATALOG.map((c) => c.id.split("-")[0]))];

/** The checks about information that is no longer current but may still be in somebody's hands. */
const OUT_OF_DATE = new Set(["RO-08", "IS-02", "OB-01", "OB-02", "OB-04", "OB-07"]);
for (const c of CATALOG) if (OUT_OF_DATE.has(c.id)) c.outOfDate = true;
