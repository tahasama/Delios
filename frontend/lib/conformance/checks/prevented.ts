/**
 * What this application refuses at the moment somebody tries, on every project.
 *
 * These are not checks: the act that would create the condition does not complete, so there is nothing in the
 * register to find. Each entry names the refusal the backend answers with, so the claim can be read in the code and
 * tried. Keep this list to what the backend really refuses; nothing aspirational belongs here.
 */

type PreventedRule = {
  /** What would be wrong, in the app's own words. */
  condition: string;
  /** What happens instead. */
  prevented: string;
  /** The act that refuses it. */
  where: string;
  /** The refusal the backend answers with, when it has one of its own. */
  code?: string;
};

export const PREVENTED: PreventedRule[] = [
  // Registering
  { where: "Registering a document", condition: "A document number typed by hand, or used twice",
    prevented: "No screen takes a number: registering allocates the next one from the scheme its deliverable type uses.", code: "NO_NUMBERING_SCHEME" },
  { where: "Registering a document", condition: "A discipline, type, criticality or other value made up on the spot",
    prevented: "Every such field is chosen from the published lists; anything else is refused.", code: "VALUE_NOT_PUBLISHED" },
  { where: "Registering a document", condition: "A field its deliverable type requires left empty",
    prevented: "Registering is refused until it is filled; a form outlines what is missing.", code: "FIELDS_REQUIRED" },
  { where: "Registering a document", condition: "Received from another organization with no date received",
    prevented: "Never typed: the day is filled when its first submission comes in, or asked when Document Control records what arrived." },
  { where: "Registering a document", condition: "A title that only repeats the document type",
    prevented: "Refused on create and on edit: the title has to say which one it is.", code: "TITLE_GENERIC" },

  // Revisions
  { where: "Revisions", condition: "Two revisions of one document being worked on at once",
    prevented: "A new revision is refused while another of the same document is being prepared, reviewed or checked.", code: "REVISION_IN_MOTION" },
  { where: "Revisions", condition: "A document's details changed outside a revision",
    prevented: "Once out of preparation, a change of details takes a new revision.", },
  { where: "Revisions", condition: "A revision voided, or a document retired, while on legal hold",
    prevented: "Refused while the hold stands; new revisions and reviews go on.", code: "ON_LEGAL_HOLD" },

  // Reviews
  { where: "Reviews", condition: "A revision in two reviews at once",
    prevented: "A review is only started for a revision being prepared; one already in review is not.", code: "REVISION_NOT_IN_PREPARATION" },
  { where: "Reviews", condition: "A route step nobody answers",
    prevented: "Every step names who answers it: people, a function or an outside organization.", code: "STEP_HAS_NO_HOLDER" },
  { where: "Reviews", condition: "A review withdrawn by somebody with no say over it",
    prevented: "Only whoever started it, or Document Control (and above), withdraws it, with a reason; the author alone does not.", code: "STARTER_OR_CONTROL" },
  { where: "Reviews", condition: "A decision with no status",
    prevented: "The decider grants the status the revision is released at; a decision without it is refused.", code: "STATUS_REQUIRED" },
  { where: "Reviews", condition: "Advice with comments that says no comment",
    prevented: "Advice that carries comments is refused without them; advice below what the comments say is refused too.", code: "COMMENT_REQUIRED / ADVICE_BELOW_COMMENTS" },

  // Releasing
  { where: "Releasing a revision", condition: "Released at a status the decider did not grant",
    prevented: "The release carries the status of the decision, not one chosen at release.", code: "STATUS_NOT_GRANTED" },
  { where: "Releasing a revision", condition: "Released with nobody's decision",
    prevented: "Every release comes from a review, the \"not reviewed\" one included; Document Control approves nothing." },
  { where: "Releasing a revision", condition: "Released while a blocking comment is unanswered",
    prevented: "A blocking comment holds the release until it is settled.", code: "BLOCKING_COMMENTS_OPEN" },
  { where: "Releasing a revision", condition: "Two released revisions of one document",
    prevented: "Releasing a revision supersedes the one before it in the same act." },
  { where: "Releasing a revision", condition: "Released and issued to nobody",
    prevented: "Where releasing and issuing are one act, a release needs someone to send to.", code: "ISSUE_REQUIRED" },

  // Transmittals
  { where: "Transmittals", condition: "An answer asked for with no day",
    prevented: "A transmittal asking for an answer says by when, so a late answer can be seen; a reason's period only suggests the day.", code: "ANSWER_DATE_REQUIRED" },
  { where: "Transmittals", condition: "A data transmittal carrying nothing",
    prevented: "Sent or received, a data transmittal carries a document of the register or the file that came; words alone are an information transmittal.", code: "FILE_REQUIRED" },
  { where: "Assets & tags", condition: "A tag typed by hand, or used twice",
    prevented: "Each tag is numbered by itself from its scheme (P1001-TAG-0001), as a package is, and never changes." },
  { where: "Transmittals", condition: "A transmittal changed after it was issued",
    prevented: "What it carries and who it went to are recorded as it is issued; a correction is a new transmittal following it." },

  // Suppliers
  { where: "Suppliers", condition: "A placeholder asked of its supplier twice",
    prevented: "Each is asked once; after that it is handed back and forth.", code: "ALREADY_REQUESTED" },
  { where: "Suppliers", condition: "A supplier's document changed by the side that does not hold it",
    prevented: "Only the holder changes it; the other side asks for it back.", code: "HELD_BY_US / ASKED_OF_SUPPLIER" },
  { where: "Suppliers", condition: "A document sent to the supplier taken out of its package",
    prevented: "Once sent on a transmittal it stays in the package.", code: "SENT_TO_SUPPLIER" },
  { where: "Suppliers", condition: "A package renumbered, or renamed once shared",
    prevented: "Its number never changes; once shared with its supplier, its name and rule are fixed.", code: "NUMBER_FIXED / PACKAGE_SHARED" },

  // Schedule
  { where: "Schedule", condition: "A discipline going ahead without a document and saying nothing",
    prevented: "Confirming with any of the discipline's documents missing needs why.", code: "NOTE_REQUIRED" },

  // Access
  { where: "Who sees what", condition: "Another organization reading what does not concern it",
    prevented: "Every read is bound to the project and, for another organization, to what is theirs or was shared with them." },
  { where: "Who sees what", condition: "A document read above someone's clearance",
    prevented: "\"Who may see it\" and the function's clearance decide what each person reads." },
];
