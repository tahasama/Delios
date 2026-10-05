/**
 * Conditions this application does not let happen.
 *
 * These are not checks. A check asks a question of the register and can come
 * back with an answer nobody likes; a rule here is enforced at the moment
 * somebody tries, so the condition never reaches the register to be found. They
 * are listed because an auditor asking "how do you know numbers are not made
 * up" deserves an answer better than a check that has never once failed.
 *
 * Every entry names the act that refuses, so the claim can be read in the code
 * and tested. Nothing here is counted in the measured result: a condition that
 * cannot arise has no documents to carry it, and folding it into a percentage
 * would flatter the number instead of informing it.
 */

export type PreventedRule = {
  /** What would be wrong, in the same words a check would use. */
  condition: string;
  /** What refuses it, and when. */
  prevented: string;
  /** Where in the application the refusal lives. */
  where: string;
};

export const PREVENTED: PreventedRule[] = [
  {
    condition: "A document number typed by hand, or invented outside the register",
    prevented: "No screen accepts a document number. Registering a document allocates one from the scheme routed to its deliverable type, taking the next counter, so no two documents can hold the same number and none can fall outside the published range.",
    where: "Registering a document",
  },
  {
    condition: "A document registered with no entry in the audit trail",
    prevented: "Registering writes the register entry and its audit record in the same act. There is no path that creates one without the other.",
    where: "Registering a document",
  },
  {
    condition: "A revision started that nobody authorised",
    prevented: "Starting a revision records who authorised it and why, and moves the document into use. A revision cannot exist without that record.",
    where: "Starting a revision",
  },
  {
    condition: "A revision released with no reason for revision, or no description of what changed",
    prevented: "Release is refused until both are recorded. The description may not simply repeat the reason.",
    where: "Releasing a revision",
  },
  {
    condition: "A revision released with no approval recorded",
    prevented: "Release is refused unless an approval exists — except for document types the organization has published as not reviewed, which have no approval to record.",
    where: "Releasing a revision",
  },
  {
    condition: "A revision released with no fixed, viewable copy",
    prevented: "Release is refused without a rendition, and the rendition is stamped with the number, revision, status and date as it is released.",
    where: "Releasing a revision",
  },
  {
    condition: "A revision released while its document is still only planned",
    prevented: "The document moves into use when its first revision is started, so a released revision cannot sit under a document that is not in use.",
    where: "Starting a revision",
  },
  {
    condition: "A revision released with core description missing",
    prevented: "Release is refused until the title, document type, discipline, retention class, criticality and confidentiality are all recorded.",
    where: "Releasing a revision",
  },
  {
    condition: "A document received from outside with no supplier, order or date of receipt",
    prevented: "Registering an external deliverable type is refused until the fields its type requires are filled.",
    where: "Registering a document",
  },
  {
    condition: "An approval given by somebody who holds no authority for that class",
    prevented: "Approval is refused unless the distribution matrix grants Approve for that document, or a delegation in force lets somebody act in another's place.",
    where: "Recording an approval",
  },
  {
    condition: "Information destroyed with no authority or no stated basis",
    prevented: "Disposal is refused without a retention basis, and records who authorised it. The register entry is kept and marked disposed.",
    where: "Disposing of a document",
  },
  {
    condition: "Information destroyed while a legal hold is on it",
    prevented: "Disposal is refused outright while the hold stands.",
    where: "Disposing of a document",
  },
  {
    condition: "A review step answered by somebody the project never put on it",
    prevented: "A step is answered by the person it was given to. Handing one over is its own act, recorded with who took it and until when.",
    where: "Reviewing",
  },
  {
    condition: "A verdict given by somebody who holds no say over that kind of document",
    prevented: "Who may be put on a review, and who may give the binding verdict, is read from the distribution matrix for that discipline and document type.",
    where: "Reviewing",
  },
  {
    condition: "A revision released while a progression-preventing comment is unanswered",
    prevented: "A comment that stops the work holds the revision until it is answered, whatever the verdict said.",
    where: "Releasing a revision",
  },
  {
    condition: "A transmittal that says it carries a revision it does not",
    prevented: "A transmittal is raised from released revisions; its contents are recorded as it is issued, and nothing is added to it afterwards.",
    where: "Issuing",
  },
  {
    condition: "A document issued at a status the organization has not published",
    prevented: "The status comes from the published list; there is no free-text status field anywhere.",
    where: "Releasing a revision",
  },
  {
    condition: "A classification invented on the spot",
    prevented: "Discipline, document type, criticality, confidentiality and retention are chosen from the published lists. Adding a value is a change to the list, which is itself controlled.",
    where: "Registering a document",
  },
  {
    condition: "A superseded revision left as the current one",
    prevented: "Releasing a new revision supersedes the one it replaces in the same act, and the register's copy of what is current is rewritten with it.",
    where: "Releasing a revision",
  },
  {
    condition: "Another organization reading what does not concern it",
    prevented: "Every query is bound to the project and, for an outside party, to what was issued to them. There is no screen that can return another organization's rows.",
    where: "Every page",
  },
];
