import type { When } from "./scene-deck";
import { ROLE_WORK, GENERIC_WORK, flowWords, cap, type RoleWork } from "./role-work";

/**
 * The Control room's steps and flows, the same at both levels (owner: "the same cards"): a project's Control room and
 * the organization's, which sets what every project starts with.
 */

/** Who does something on a step: an act the project decides the carrier of (its key), or one that never changes. */
export type Who = string | { title: string; by: string };

export type Extra = "numbering" | "revisions" | "fields" | "routes" | "distribution" | "parties" | "packages" | "schedule" | "people" | "functions"
  | "assets" | "checks" | "project"
  | "form:DOCUMENT" | "form:REVISION" | "form:REVIEW" | "form:TRANSMITTAL" | "form:PACKAGE" | "form:ASSET" | "form:PARTY" | "form:PROJECT";

export type Stage = {
  key: string;
  title: string;
  /** A few words for the step's card. */
  tagline: string;
  /** One sentence: what happens at this step. */
  text: string;
  rail: string;
  who: Who[];
  /** What the project chose that this step reads: a question's key, or DAYS, ESCALATE, CONFIRM:<act>, TRACKING. */
  answers?: string[];
  /** The lists it reads. */
  sets?: string[];
  /** Where else it is set up. */
  extras?: Extra[];
  /** Its panel opens on the red warning of documents taken as they come. */
  warn?: boolean;
};

/**
 * Every step, once. A step several flows pass through (review, release) is the same step on each, so what it says is
 * the same everywhere.
 */
export const STAGES: Stage[] = [
  // ── Documents ───────────────────────────────────────────────────────────────
  {
    key: "register", title: "Register", tagline: "Numbered and described", rail: "rail-none",
    text: "The document gets its number and its description before anything is written in it.",
    who: [{ title: "Registering it", by: "Whoever creates it" }, "WITHDRAW"],
    sets: ["SUBPROJECTS", "DISCIPLINES", "DOCUMENT_TYPES", "DELIVERABLE_TYPES", "PHASES", "CRITICALITY", "CONFIDENTIALITY", "RETENTION_CLASSES", "GENERIC_TITLE_WORDS"],
    extras: ["numbering", "fields", "form:DOCUMENT", "assets", "form:ASSET"],
  },
  {
    key: "prepare", title: "Prepare", tagline: "Written by its author", rail: "rail-prep",
    text: "The author writes the revision and attaches its files.",
    who: [{ title: "Writing the revision", by: "Its author" }, "AUTHORIZE_REVISION"],
    sets: ["STATUSES", "NATIVE_FORMATS", "RENDITION_FORMATS"],
    extras: ["revisions", "form:REVISION"],
    answers: ["STATE:IN_PREPARATION"],
  },
  {
    key: "review", title: "Review", tagline: "Down its route", rail: "rail-review",
    text: "The route the document matches sends it to its reviewers, and each answers with a verdict or advice.",
    who: ["REVIEW_ISSUE", { title: "Answering", by: "The people on each step of the route" }, "DELEGATE"],
    answers: ["POLICY_MATRIX", "POLICY_MATRIX_DETAIL", "STATE:IN_REVIEW", "ROUTE_VERDICTS"],
    sets: ["REVIEW_OUTCOMES", "REVIEW_ADVICE", "COMMENT_CLASSES"],
    extras: ["routes", "distribution", "form:REVIEW"],
  },
  {
    key: "accepted", title: "Accepted", tagline: "The verdict lets it go on", rail: "rail-accepted",
    text: "The verdict accepts it, as it stands or with comments for the next revision.",
    who: [{ title: "Deciding", by: "The step of the route that decides" }],
    sets: ["REVIEW_OUTCOMES"],
    extras: ["routes"],
    answers: [],
  },
  {
    key: "returned", title: "Returned", tagline: "Back to the author", rail: "rail-rejected",
    text: "The verdict refuses it: it goes back to the author with the comments, and this revision ends.",
    who: ["RETURN_OUTCOME"],
    sets: ["REVIEW_OUTCOMES", "COMMENT_CLASSES"],
    answers: ["THE_STAMP"],
  },
  {
    key: "to-sender", title: "Returned to the sender", tagline: "For correction", rail: "rail-returned",
    text: "The verdict refuses it: it goes back to whoever sent it, for correction. Their next one starts again.",
    who: ["RETURN_OUTCOME"],
    sets: ["REVIEW_OUTCOMES", "COMMENT_CLASSES"],
    extras: ["parties", "form:TRANSMITTAL"],
    answers: [],
  },
  {
    key: "gate", title: "The control function's check", tagline: "Before it is published", rail: "rail-check",
    text: "Decided, it waits until the control function publishes it at the status the review settled on.",
    who: ["CONTROL_PEOPLE", { title: "Publishing it", by: "The control function" }],
    sets: ["STATUSES"],
    answers: ["STATE:NOT_RELEASED"],
  },
  {
    key: "gate-return", title: "Sent back", tagline: "Wrong for the record", rail: "rail-returned",
    text: "The control function refuses to publish it and sends it back with a reason. This revision ends.",
    who: [{ title: "Sending it back", by: "The control function" }],
    sets: ["RETURN_REASONS"],
    answers: ["STATE:RETURNED"],
  },
  {
    key: "approval", title: "Approved outside", tagline: "An outside party approves", rail: "rail-accepted",
    text: "Somebody outside approves it before it is released, when an approval was asked for.",
    who: [{ title: "Approving", by: "The outside party named when it was asked" }],
    extras: ["parties"],
    answers: ["THE_STAMP", "STATE:ON_HOLD"],
  },
  {
    key: "approval-refused", title: "Not approved", tagline: "Back to the author", rail: "rail-rejected",
    text: "The outside party refuses it: it goes back to the author with a reason. This revision ends.",
    who: [{ title: "Sending it back", by: "Whoever asked for the approval" }],
    answers: [],
    extras: ["parties"],
  },
  {
    key: "release", title: "Release", tagline: "In force", rail: "rail-released",
    text: "The revision comes into force, and the one before it is superseded.",
    who: [{ title: "Releasing", by: "The decider, or the control function where it checks first" }],
    answers: ["POLICY_RELEASE", "THE_STAMP", "STATE:RELEASED"],
  },
  {
    key: "released-issued", title: "Released & issued", tagline: "In force, and sent", rail: "rail-released",
    text: "In one act it comes into force and goes to the people named by whoever decided or asked.",
    who: ["ISSUE"],
    answers: ["POLICY_RELEASE", "POLICY_READY", "THE_STAMP", "STATE:RELEASED"],
    sets: ["REASONS_FOR_ISSUE", "ISSUE_CODES"],
    extras: ["distribution", "form:TRANSMITTAL"],
  },
  {
    key: "voided", title: "Voided", tagline: "Released in error", rail: "rail-void",
    text: "A revision released in error, or never reviewed, is voided with why; what was done from it is reassessed.",
    who: ["VOID"],
    answers: ["THE_STAMP", "STATE:VOID"],
  },
  {
    key: "issue", title: "Issue", tagline: "Sent out", rail: "rail-issue",
    text: "The released revision is sent out on a transmittal.",
    who: ["ISSUE"],
    answers: ["POLICY_READY"],
    sets: ["REASONS_FOR_ISSUE", "ISSUE_CODES"],
    extras: ["distribution", "form:TRANSMITTAL"],
  },
  {
    key: "received", title: "Received", tagline: "Arrives on a transmittal", rail: "rail-received",
    text: "What another organization sends is recorded on the transmittal it came on.",
    who: [{ title: "Recording what arrived", by: "Whoever receives it" }],
    sets: ["SUPPLIER_CODES", "PURCHASE_ORDERS", "REASONS_FOR_ISSUE"],
    extras: ["parties", "form:TRANSMITTAL", "form:PARTY"],
  },
  {
    key: "theirs", title: "Registered or matched", tagline: "One of ours, or a new one", rail: "rail-none",
    text: "What came unplanned is matched to one of our documents, chosen from the register (what came becomes its content, their number kept beside ours, and the register finds it under both), or registered as a new document under our numbering, their number kept the same way. Nobody types a number.",
    who: [{ title: "Matching it, or registering it", by: "Whoever checks what arrives" }],
    answers: ["INTAKE"],
    sets: ["SUPPLIER_CODES", "PURCHASE_ORDERS", "DISCIPLINES", "DOCUMENT_TYPES", "DELIVERABLE_TYPES"],
    extras: ["numbering", "form:DOCUMENT"],
  },
  {
    key: "asked", title: "Asked of the supplier", tagline: "Asked on a transmittal", rail: "rail-sent",
    text: "A placeholder from the supplier's package goes to them, due on its planned day. They hold it until they send it.",
    who: [{ title: "Asking for it", by: "The control function (with none, anyone of ours who sends documents), from the supplier's package" }],
    answers: ["INTAKE"],
    sets: ["SUPPLIER_CODES", "PURCHASE_ORDERS"],
    extras: ["packages", "parties", "form:TRANSMITTAL"],
  },
  {
    key: "checked", title: "The control function's check", tagline: "Accepted, or back to them", rail: "rail-check",
    text: "What another organization sent counts only once it is checked: accepted, it becomes the document's revision; returned, with why, they correct it.",
    who: ["CONTROL_PEOPLE", { title: "Checking it", by: "The control function" }],
    sets: ["CONTROL_OUTCOMES"],
  },
  {
    key: "checked-self", title: "Checked by whoever it was for", tagline: "Accepted, or back to them", rail: "rail-check",
    text: "With no control function on the project, whoever the transmittal was for checks it (anyone of ours when it named nobody): accepted, it becomes the document's revision; returned, with why, they correct it.",
    who: [{ title: "Checking it", by: "Whoever the transmittal was for" }],
    sets: ["CONTROL_OUTCOMES"],
  },
  {
    key: "sent-as-is", title: "Sent as it is", tagline: "Their number, their revision", rail: "rail-received",
    text: "This project is an exception: it takes other organizations' documents as they come. Nothing is asked by placeholder; they send each document with its own number and revision, its status and review outcome.",
    who: [{ title: "Sending it", by: "The other organization, on a transmittal" }, { title: "Choosing this way, with what it is filed under", by: "An administrator or the control function, here" }],
    answers: ["INTAKE"],
    extras: ["packages", "form:TRANSMITTAL"],
    warn: true,
  },
  {
    key: "as-came", title: "In the register as it came", tagline: "Not our numbering", rail: "rail-received",
    text: "Once the check accepts it, it is in our register exactly as it came: their number, their revision, their status and review outcome, filed under the deliverable type, document type and discipline chosen here, in its organization's package. Ready for our review; the next revision comes from them. Nothing is matched or registered by hand.",
    who: [{ title: "Putting it there", by: "The app, once the check accepts it" }],
    answers: ["INTAKE"],
    sets: ["DELIVERABLE_TYPES", "DOCUMENT_TYPES", "DISCIPLINES"],
    extras: ["packages"],
    warn: true,
  },
  {
    key: "handed-back", title: "Back with the supplier", tagline: "Theirs again, to update", rail: "rail-rejected",
    text: "Rejected, or released with comments: it goes back to the supplier for the next revision.",
    who: [{ title: "Taking the comments in", by: "The supplier" }],
    sets: ["REVIEW_OUTCOMES"],
  },

  // ── Documents our client asks of us ─────────────────────────────────────────
  {
    key: "client-placeholder", title: "Their placeholder", tagline: "Filled on their project", rail: "rail-sent",
    text: "A client on DELIOS keeps the document on its own project and asks it of us there, from our package: we switch into their project, see only what they asked, and fill in their placeholder: its revision, under their number, in their register.",
    who: [{ title: "Filling it in", by: "Whoever of ours they put on their project" }],
    extras: ["parties"],
  },
  {
    key: "client-asked", title: "Asked of us", tagline: "Recorded here, on a transmittal", rail: "rail-received",
    text: "A client not on DELIOS asks by email or letter: we record it as a transmittal received, with the day it is due, and answer with the document on a transmittal following theirs.",
    who: [{ title: "Recording what they ask", by: "Whoever receives it" }],
    sets: ["REASONS_FOR_ISSUE"],
    extras: ["parties", "form:TRANSMITTAL"],
  },
  {
    key: "client-sent", title: "Sent to them", tagline: "From their project, or a transmittal", rail: "rail-issue",
    text: "Filled on their project, it goes with \"Send to them\" there; asked here, it is released and issued to them on a transmittal following theirs.",
    who: [{ title: "Sending it from their project", by: "Whoever of ours filled it" }, "ISSUE"],
    answers: ["POLICY_RELEASE", "THE_STAMP"],
    sets: ["REASONS_FOR_ISSUE"],
    extras: ["form:TRANSMITTAL"],
  },
  {
    key: "client-check", title: "Their check", tagline: "Before it counts with them", rail: "rail-check",
    text: "On their DELIOS, their control function checks what we sent before it counts: accepted, it goes to their review; returned, with why, we correct it and send it again under the same revision.",
    who: [{ title: "Checking it", by: "Their control function" }],
  },

  // ── Keeping and ending a document ───────────────────────────────────────────
  {
    key: "kept", title: "Kept", tagline: "As long as it must be", rail: "rail-released",
    text: "Every revision and its files are kept, read only by those its confidentiality allows, for as long as its retention class says; what is kept for the long term is kept in a preservation format.",
    who: [{ title: "Keeping it", by: "The app, by itself" }, { title: "Checking the register every day", by: "The app, by itself" }],
    answers: ["TRACKING"],
    sets: ["RETENTION_CLASSES", "CONFIDENTIALITY", "PRESERVATION_FORMATS"],
    extras: ["checks", "functions"],
  },
  {
    key: "held", title: "On legal hold", tagline: "Kept against disposal", rail: "rail-held",
    text: "Held for a legal reason, with why: it cannot be ended and no revision voided until the hold is lifted, with why. New revisions and reviews go on.",
    who: [{ title: "Holding it, and lifting the hold", by: "The control function, or an administrator" }],
    answers: ["THE_STAMP"],
  },
  {
    key: "cancelled", title: "Cancelled", tagline: "Never to be produced", rail: "rail-withdrawn",
    text: "A document that will never be produced is cancelled with why, only while nothing of it was ever released. Reinstated, with why, it counts again.",
    who: [{ title: "Cancelling or reinstating it", by: "The control function, or whoever registered it" }],
  },
  {
    key: "withdrawn", title: "Withdrawn", tagline: "No longer valid", rail: "rail-withdrawn",
    text: "A released document no longer valid is withdrawn with why: everyone sent a revision of it is told to stop using it. Reinstated, with why, they are told it counts again.",
    who: [{ title: "Withdrawing or reinstating it", by: "The control function, or whoever registered it" }],
    extras: ["distribution"],
  },
  {
    key: "archived", title: "Archived", tagline: "With its project", rail: "rail-archived",
    text: "Documents are never archived one by one: they are archived with their project, read only, and come back when it is reopened.",
    who: [{ title: "Archiving or reopening the project, with why", by: "An administrator, on the organization's Projects" }],
    extras: ["project", "form:PROJECT"],
  },

  // ── Packages we deliver ─────────────────────────────────────────────────────
  {
    key: "pkg-made", title: "Put together", tagline: "Its documents gathered", rail: "rail-prep",
    text: "The package is opened with the statuses it is needed at, and its documents are added.",
    who: [{ title: "Adding and taking out documents", by: "Those putting it together" }, { title: "Everything else on it", by: "The control function (with none, those putting it together)" }],
    extras: ["packages", "form:PACKAGE"],
  },
  {
    key: "pkg-checked", title: "Checked", tagline: "Ready or not, each one", rail: "rail-check",
    text: "Each document is read against the status it is needed at; what is not ready is the shortfall.",
    who: ["CONTROL_PEOPLE", { title: "Checking it", by: "The control function (with none, those putting it together)" }],
    sets: ["STATUSES"],
  },
  {
    key: "pkg-short", title: "Going without", tagline: "What is missing is asked", rail: "rail-shortfall",
    text: "Whoever accepts the package is asked whether it may go without what is missing; agreeing delivers it at once.",
    who: [{ title: "Asking", by: "The control function (with none, those putting it together), on a transmittal" }, { title: "Agreeing", by: "Whoever accepts the package" }],
  },
  {
    key: "pkg-delivered", title: "Delivered", tagline: "Sent, then fixed", rail: "rail-delivered",
    text: "One transmittal per organization carries its documents; what the package holds is then fixed.",
    who: [{ title: "Delivering it", by: "The control function (with none, those putting it together)" }],
    sets: ["REASONS_FOR_ISSUE"],
    extras: ["distribution"],
  },
  {
    key: "pkg-accepted", title: "Accepted", tagline: "By whoever receives it", rail: "rail-accepted",
    text: "Whoever accepts the package accepts it, never one of those who put it together.",
    who: [{ title: "Accepting it", by: "Whoever accepts the package" }],
  },

  // ── An action on the schedule ───────────────────────────────────────────────
  {
    key: "act-needs", title: "Needs worked out", tagline: "From the schedule's lists", rail: "rail-schedule",
    text: "The schedule and its lists say which documents each action needs; each document is planned for its earliest action.",
    who: [{ title: "Uploading the schedule and its lists", by: "The control function, or whoever plans" }, "ACTION_LINKS"],
    answers: ["CONFIRM:ACTION_LINKS", "DAYS"],
    extras: ["schedule"],
  },
  {
    key: "act-risk", title: "At risk", tagline: "A document still missing", rail: "rail-risk",
    text: "Inside the risk window with a document still missing, each discipline still short is told, once.",
    who: [{ title: "Telling them", by: "The app, by itself" }],
    answers: ["DAYS"],
  },
  {
    key: "act-confirm", title: "Disciplines confirm", tagline: "Go ahead, with or without", rail: "rail-ready",
    text: "A discipline whose documents are ready is confirmed by itself; one still short confirms by hand, saying why.",
    who: [{ title: "Confirming", by: "Each discipline concerned" }],
    answers: ["POLICY_READY", "ESCALATE"],
  },
  {
    key: "act-ahead", title: "Went ahead", tagline: "On its day", rail: "rail-done",
    text: "The day passes: the action went ahead with its documents, or without some, written down with why.",
    who: ["ACTION_NOTE"],
    sets: ["ACTIVITY_DECISIONS"],
  },
  {
    key: "act-postponed", title: "Postponed", tagline: "Will not go ahead", rail: "rail-withdrawn",
    text: "Recorded with who decided and why; whoever plans confirms it, and a new schedule revision follows.",
    who: [{ title: "Recording it", by: "Anyone concerned" }, { title: "Confirming it", by: "Whoever plans" }],
    sets: ["ACTIVITY_DECISIONS"],
  },

  // ── Someone joins the project ───────────────────────────────────────────────
  {
    key: "join-asked", title: "Asked or added", tagline: "Someone new, or with an account", rail: "rail-people",
    text: "Anyone of ours asks for someone new; someone with an account is added. Either way with a function and a department.",
    who: [{ title: "Asking for someone", by: "Anyone of ours on the project" }, "PROJECT_PEOPLE"],
    extras: ["people", "functions"],
  },
  {
    key: "join-confirmed", title: "Confirmed", tagline: "By whoever holds Manage", rail: "rail-check",
    text: "Where confirmation is asked, nobody is on the project until whoever holds Manage confirms them.",
    who: [{ title: "Confirming", by: "Whoever holds Manage" }],
    answers: ["CONFIRM:PROJECT_PEOPLE"],
  },
  {
    key: "join-refused", title: "Refused", tagline: "With why", rail: "rail-rejected",
    text: "Refused, they stay off the project, with why, shown in People & access.",
    who: [{ title: "Refusing", by: "Whoever holds Manage" }],
  },
  {
    key: "join-on", title: "On the project", tagline: "Told, and in", rail: "rail-done",
    text: "They are put on by themselves and told by notification and email; a new account gets its link to choose a password.",
    who: [{ title: "Telling them", by: "The app, by itself" }],
    answers: ["TRACKING"],
    extras: ["people", "functions"],
  },
];

/**
 * The flows, from the organization's own side. A fork carries one lane on and hangs the one that ends below it; who
 * returns a refused revision follows the project, and without a control function there is no check before release.
 */
export type FlowLane = { scene: string; when?: When; tagline?: string; end?: boolean };
/** Set here: the project's configuration decides (`on` when it is known project-wide). */
export const set = (text: string, on?: boolean): When => ({ kind: "set", text, on });
/** If it happens: an event brings it on, and then it is never skipped. */
export const event = (text: string): When => ({ kind: "event", text });

export type FlowShape = { key: string; title: string; tab: string; from: string; to: string; columns: FlowLane[][] };



export type Shape = { gate: boolean; returner: string; together: boolean; unreviewed: boolean; asCome: boolean; confirmJoin: boolean };

export function flowsFor({ role, ...shape }: Shape & { role: string }): FlowShape[] {
  const work = ROLE_WORK[role] ?? GENERIC_WORK;
  const all = flowsAll({ ...shape, work });
  const flow = (key: string) => {
    const one = all.find((f) => f.key === key)!;
    return { ...one, title: work.titles?.[key] ?? one.title, tab: work.tabs?.[key] ?? one.tab };
  };
  // The flows that matter most for our role come first, in its words; the others follow.
  const lead = work.order.filter((key) => all.some((f) => f.key === key));
  const rest = ["produce", "receive", "supplier", "deliver", "action", "join", "keep"].filter((key) => !lead.includes(key));
  return [...lead, ...rest].map(flow);
}

/**
 * Nothing on a flow is optional (owner): a step either always happens, or happens under a condition, of two kinds.
 * Set here: the project's configuration decides it (drawn on or off as it stands, where it is known for the whole
 * project; else "depends", with what on). If it happens: an event brings it on (released in error, a legal reason),
 * and then it is never skipped. A way the project did not choose (placeholders or as they come) is not drawn at all.
 */
function flowsAll({ gate, returner, together, unreviewed, asCome, confirmJoin, work }: Shape & { work: RoleWork }): FlowShape[] {
  const words = flowWords(work);
  // Released and issued are one act unless the project keeps them apart (POLICY_RELEASE): one step, or two.
  // A released revision may be voided: the road that ends below the release.
  const voided: FlowLane = { scene: "voided", end: true, when: event("it was released in error") };
  const out: FlowLane[][] = together ? [[{ scene: "released-issued" }, voided]] : [[{ scene: "release" }, voided], [{ scene: "issue" }]];
  // Where some document types are not reviewed, review happens only for the others.
  const reviewed = unreviewed ? set("its document type is reviewed (Types & sets, on the type)") : undefined;
  // What we produce: approved outside always when our role answers to someone, else only when asked for.
  const approved: FlowLane[] = work.approver
    ? [{ scene: "approval", tagline: `${work.approver} approves it` }, { scene: "approval-refused", end: true, tagline: `${work.approver} refuses it` }]
    : [{ scene: "approval", when: event("the decider asks for an outside approval") }, { scene: "approval-refused", end: true, when: event("the outside approval is refused") }];
  // What others send us: our verdict is final, or another decides after us.
  const afterUs: FlowLane[][] = work.ours === "final" ? [] : [[
    { scene: "approval", tagline: `${work.decider ?? "Another"} decides` },
    { scene: "approval-refused", end: true, tagline: `${work.decider ?? "Another"} refuses it` },
  ]];
  const ourReview = work.ours === "recommends" ? "We review it and recommend" : work.ours === "passes" ? "We check it before passing it on" : "By us, by them, or both";
  return [
    {
      ...words.produce,
      columns: [
        [{ scene: "register" }],
        [{ scene: "prepare" }],
        [{ scene: "review", tagline: "Our reviewers, and others when the route names them", when: reviewed }],
        [{ scene: "accepted" }, { scene: "returned", end: true, tagline: `${returner} returns it` }],
        ...(gate ? [[{ scene: "gate" }, { scene: "gate-return", end: true }]] : []),
        approved,
        ...out,
      ],
    },
    {
      ...words.receive,
      columns: [
        [{ scene: "received" }],
        [{ scene: gate ? "checked" : "checked-self" }],
        [{ scene: asCome ? "as-came" : "theirs" }],
        [{ scene: "review", tagline: ourReview, when: reviewed }],
        [{ scene: "accepted", tagline: work.ours === "final" ? undefined : work.ours === "recommends" ? "We recommend it" : "We pass it on" }, { scene: "to-sender", end: true }],
        ...afterUs,
        ...out,
      ],
    },
    {
      ...words.supplier,
      columns: [
        // One way or the other (the Control room): asked by placeholder, or sent as it is and taken so.
        [{ scene: asCome ? "sent-as-is" : "asked" }],
        [{ scene: "received", tagline: "They send it, on a transmittal" }],
        [{ scene: gate ? "checked" : "checked-self" }],
        ...(asCome ? [[{ scene: "as-came" }]] : []),
        [{ scene: "review", tagline: "By us, by them, or both" }],
        [{ scene: "accepted", tagline: "We hold it" }, { scene: "handed-back", end: true }],
        ...out,
      ],
    },
    {
      ...words.client,
      columns: [
        // Two ways it is asked: their placeholder, filled on their own DELIOS, or asked outside it and recorded here.
        [{ scene: "client-placeholder", when: set("they work from their own DELIOS (Organizations)") }, { scene: "client-asked", when: set("they are not on DELIOS (Organizations)") }],
        [{ scene: "register", tagline: "Here, when it was asked here", when: set("they are not on DELIOS (Organizations)") }],
        [{ scene: "prepare" }],
        [{ scene: "review", tagline: "Ours, before it goes", when: reviewed }],
        [{ scene: "client-sent" }],
        [{ scene: "client-check", when: set("they work from their own DELIOS (Organizations)") }],
        [{ scene: "accepted", tagline: `${cap(work.client ?? "our client")} accepts it` }, { scene: "returned", end: true, tagline: `${cap(work.client ?? "our client")} returns it` }],
      ],
    },
    {
      ...words.deliver,
      columns: [
        [{ scene: "pkg-made" }],
        [{ scene: "pkg-checked" }],
        [{ scene: "pkg-short", when: event("something it needs is missing") }],
        [{ scene: "pkg-delivered" }],
        [{ scene: "pkg-accepted" }],
      ],
    },
    {
      ...words.action,
      columns: [
        [{ scene: "act-needs" }],
        [{ scene: "act-risk", when: event("a document is still missing inside the risk window") }],
        [{ scene: "act-confirm" }],
        [{ scene: "act-ahead" }, { scene: "act-postponed", end: true }],
      ],
    },
    {
      ...words.join,
      columns: [
        [{ scene: "join-asked" }],
        [{ scene: "join-confirmed", when: set("confirmation by whoever holds Manage is asked", confirmJoin) }, { scene: "join-refused", end: true, when: set("confirmation by whoever holds Manage is asked", confirmJoin) }],
        [{ scene: "join-on" }],
      ],
    },
    {
      ...words.keep,
      columns: [
        // Ended at any time while kept: withdrawn once released, cancelled before.
        [{ scene: "kept" }, { scene: "withdrawn", end: true, when: event("it was released and is no longer valid") }, { scene: "cancelled", end: true, when: event("it will never be produced") }],
        [{ scene: "held", when: event("a legal reason calls for it") }],
        [{ scene: "archived", when: event("the project is archived") }],
      ],
    },
  ];
}

export const EXTRA: Record<Extra, { title: string; href: string }> = {
  numbering: { title: "Numbering", href: "/settings/numbering" },
  revisions: { title: "Revisions", href: "/settings/revisions" },
  fields: { title: "Forms & fields", href: "/settings/fields" },
  routes: { title: "Review routes", href: "/settings/workflow-templates" },
  distribution: { title: "Distribution", href: "/distribution" },
  parties: { title: "Organizations", href: "/settings/parties" },
  packages: { title: "Packages", href: "/packages" },
  schedule: { title: "Schedule", href: "/schedule" },
  people: { title: "People & access", href: "/settings/users" },
  functions: { title: "Functions & permissions", href: "/settings/functions" },
  assets: { title: "Assets & tags", href: "/assets" },
  checks: { title: "The checks switched off", href: "/conformance/checks?result=OFF" },
  project: { title: "This project", href: "/settings/projects" },
  "form:DOCUMENT": { title: "The document form", href: "/settings/fields?form=DOCUMENT" },
  "form:REVISION": { title: "The revision form", href: "/settings/fields?form=REVISION" },
  "form:REVIEW": { title: "The review form", href: "/settings/fields?form=REVIEW" },
  "form:TRANSMITTAL": { title: "The transmittal form", href: "/settings/fields?form=TRANSMITTAL" },
  "form:PACKAGE": { title: "The package form", href: "/settings/fields?form=PACKAGE" },
  "form:ASSET": { title: "The tag form", href: "/settings/fields?form=ASSET" },
  "form:PARTY": { title: "The organization form", href: "/settings/fields?form=PARTY" },
  "form:PROJECT": { title: "The project form", href: "/settings/fields?form=PROJECT" },
};

