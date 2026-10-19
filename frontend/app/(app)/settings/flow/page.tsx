import Link from "next/link";
import { SETUP_PAGES, maySetup, mayChangeControlRoom } from "../setup-pages";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath } from "@/lib/client";
import { projectSettings, orgSettings } from "@/lib/settings/api";
import { optOutsOf } from "@/lib/conformance/api";
import { isAdmin } from "@/lib/core/auth";
import { controlSettings, CONTROL_ACTIVITIES, effectiveAnswer, POLICIES, SKIPPABLE, CONFIRMABLE, PEOPLE_KEY, PEOPLE_MODE_LABEL, STAMP_KINDS, STAMP_COMMENTS_KEY, roomItemOf } from "@/lib/settings/control-activities";
import { stateNames } from "@/lib/core/state-names";
import { holdersOf } from "@/lib/core/permissions";
import { scheduleSource } from "@/lib/actions/api";
import { DEFAULT_LEAD_DAYS } from "@/lib/actions/schedule";
import { DEFAULT_RISK_DAYS } from "@/lib/actions/action-state";
import { ESCALATE_AFTER_KEY, DEFAULT_ESCALATE_AFTER } from "@/lib/actions/escalation";
import { SceneDeck, type Flow, type Scene } from "./scene-deck";
import { Choice } from "./choice";
import { liberty } from "@/lib/organization/liberty";
import { setRoomAnswerAction, setScheduleDaysAction } from "@/lib/settings/forms-how-it-works";
import { setRouteVerdictsAction } from "@/lib/reviews/forms";
import { cn } from "@/lib/core/utils";
import { adminFunctions, projectNumbering, partiesWithAnswers, routesForEditor } from "@/lib/settings/api-admin";
import { getSet, getSets } from "@/lib/settings/config";
import { NoAccess } from "../no-access";
import { contractRoleOptions } from "@/lib/settings/contract-roles";
import { roleLabel } from "@/lib/settings/profiles/roles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Control room" };

/**
 * The Control room: how the project works, step by step, and where it is changed. The flows a document, a package,
 * an action and a person go through on a band; the chosen step's panel under it says what happens, who does it and
 * how it works here (each answer changed right there, asked first), and opens the lists and pages it reads. Every
 * answer is also on one page, How this project works.
 */

/** Who does something on a step: an act the project decides the carrier of (its key), or one that never changes. */
type Who = string | { title: string; by: string };

type Extra = "numbering" | "revisions" | "fields" | "routes" | "distribution" | "parties" | "packages" | "schedule" | "people" | "functions"
  | "assets" | "checks" | "project"
  | "form:DOCUMENT" | "form:REVISION" | "form:REVIEW" | "form:TRANSMITTAL" | "form:PACKAGE" | "form:ASSET" | "form:PARTY" | "form:PROJECT";

type Stage = {
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
};

/**
 * Every step, once. A step several flows pass through (review, release) is the same step on each, so what it says is
 * the same everywhere.
 */
const STAGES: Stage[] = [
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
    answers: ["POLICY_PDF_STAMP", "STAMP_COMMENTS"],
  },
  {
    key: "returned", title: "Returned", tagline: "Back to the author", rail: "rail-rejected",
    text: "The verdict refuses it: it goes back to the author with the comments, and this revision ends.",
    who: ["RETURN_OUTCOME"],
    sets: ["REVIEW_OUTCOMES", "COMMENT_CLASSES"],
    answers: ["STAMP:RETURNED", "POLICY_PDF_STAMP", "STAMP_COMMENTS"],
  },
  {
    key: "to-sender", title: "Returned to the sender", tagline: "For correction", rail: "rail-returned",
    text: "The verdict refuses it: it goes back to whoever sent it, for correction. Their next one starts again.",
    who: ["RETURN_OUTCOME"],
    sets: ["REVIEW_OUTCOMES", "COMMENT_CLASSES"],
    extras: ["parties", "form:TRANSMITTAL"],
    answers: ["STAMP:RETURNED", "POLICY_PDF_STAMP", "STAMP_COMMENTS"],
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
    answers: ["STAMP:HELD", "STATE:ON_HOLD"],
  },
  {
    key: "approval-refused", title: "Not approved", tagline: "Back to the author", rail: "rail-rejected",
    text: "The outside party refuses it: it goes back to the author with a reason. This revision ends.",
    who: [{ title: "Sending it back", by: "Whoever asked for the approval" }],
    answers: ["STAMP:HELD"],
    extras: ["parties"],
  },
  {
    key: "release", title: "Release", tagline: "In force", rail: "rail-released",
    text: "The revision comes into force, and the one before it is superseded.",
    who: [{ title: "Releasing", by: "The decider, or the control function where it checks first" }],
    answers: ["POLICY_RELEASE", "POLICY_PDF_STAMP", "STAMP:RELEASED", "STAMP:SUPERSEDED", "STAMP_COMMENTS", "STATE:RELEASED"],
  },
  {
    key: "released-issued", title: "Released & issued", tagline: "In force, and sent", rail: "rail-released",
    text: "In one act it comes into force and goes to the people named by whoever decided or asked.",
    who: ["ISSUE"],
    answers: ["POLICY_RELEASE", "POLICY_PDF_STAMP", "POLICY_READY", "STAMP:RELEASED", "STAMP:SUPERSEDED", "STAMP_COMMENTS", "STATE:RELEASED"],
    sets: ["REASONS_FOR_ISSUE", "ISSUE_CODES"],
    extras: ["distribution", "form:TRANSMITTAL"],
  },
  {
    key: "voided", title: "Voided", tagline: "Released in error", rail: "rail-void",
    text: "A revision released in error, or never reviewed, is voided with why; what was done from it is reassessed.",
    who: ["VOID"],
    answers: ["STAMP:VOID", "STATE:VOID"],
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
    key: "theirs", title: "Registered", tagline: "Put in our register", rail: "rail-none",
    text: "It becomes a document of the register, under the sender's code and the order it answers.",
    who: [{ title: "Registering it", by: "Whoever recorded it" }],
    sets: ["SUPPLIER_CODES", "PURCHASE_ORDERS", "DISCIPLINES", "DOCUMENT_TYPES", "DELIVERABLE_TYPES"],
    extras: ["numbering", "form:DOCUMENT"],
  },
  {
    key: "asked", title: "Asked of the supplier", tagline: "Asked on a transmittal", rail: "rail-sent",
    text: "A placeholder from the supplier's package goes to them, due on its planned day. They hold it until they send it.",
    who: [{ title: "Asking for it", by: "The control function (with none, anyone of ours who sends documents), from the supplier's package" }],
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
    key: "handed-back", title: "Back with the supplier", tagline: "Theirs again, to update", rail: "rail-rejected",
    text: "Rejected, or released with comments: it goes back to the supplier for the next revision.",
    who: [{ title: "Taking the comments in", by: "The supplier" }],
    sets: ["REVIEW_OUTCOMES"],
  },

  // ── Documents our client asks of us ─────────────────────────────────────────
  {
    key: "client-placeholder", title: "Their placeholder", tagline: "Filled on their project", rail: "rail-sent",
    text: "A client on DELIOS keeps the document on its own project and asks it of us there, from our package: we switch into their project, see only what they asked, and attach our file beside it.",
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
    answers: ["POLICY_RELEASE", "POLICY_PDF_STAMP", "STAMP:RELEASED"],
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
    answers: ["STAMP:HELD"],
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
type FlowLane = { scene: string; optional?: string; tagline?: string; end?: boolean };
const cap = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

type FlowShape = { key: string; title: string; tab: string; from: string; to: string; columns: FlowLane[][] };

/**
 * What our role on the project (This project, "our role", CONTRACT_ROLES) makes of the flows, as such projects run:
 * what comes first, in whose words, who approves what we produce, and what our verdict on what others send is worth.
 *  - `ours`: our verdict on what others send us is final ("final"), a recommendation another decides on
 *    ("recommends"), or a check before we pass it on to whoever approves ("passes").
 *  - `decider`: who decides after us when our verdict is not final; `approver`: who approves what we produce, when
 *    someone outside always does (else an outside approval is optional); `client`: who asks documents of us.
 */
type RoleWork = {
  order: string[];
  titles?: Record<string, string>;
  /** The short names on the tabs, where the role words them otherwise. */
  tabs?: Record<string, string>;
  ours: "final" | "recommends" | "passes";
  decider?: string;
  approver?: string;
  client?: string;
};
const ROLE_WORK: Record<string, RoleWork> = {
  // Everything comes to the owner, who decides.
  OWNER: { order: ["receive", "supplier", "produce"], ours: "final",
    titles: { receive: "Documents we approve", supplier: "Documents owed to us", produce: "Documents we issue" },
    tabs: { receive: "We approve", supplier: "Owed to us", produce: "We issue" } },
  // A project management consultant manages for the owner: it reviews and recommends, the owner decides.
  PMC: { order: ["receive", "produce", "supplier"], ours: "recommends", decider: "The owner",
    titles: { receive: "Documents we review for the owner", produce: "Documents we issue", supplier: "Documents owed to the project" },
    tabs: { receive: "We review", produce: "We issue", supplier: "Owed to the project" } },
  // EPCM manages engineering, vendors and contractors on the owner's behalf, and approves for it.
  EPCM: { order: ["produce", "receive", "supplier"], ours: "final", approver: "The owner",
    titles: { produce: "Engineering we produce for the owner", receive: "Documents we approve on the owner's behalf", supplier: "Documents vendors owe the project" },
    tabs: { produce: "We engineer", receive: "We approve", supplier: "Vendors owe" } },
  // EPC approves its own engineering and its suppliers' data; the client may ask to approve.
  EPC: { order: ["produce", "supplier", "receive"], ours: "final",
    titles: { supplier: "Documents our suppliers owe us" } },
  // The designer (architect, engineer of record) produces the design the client approves, and approves shop
  // drawings and submittals for conformance with it.
  DESIGN: { order: ["produce", "receive", "client"], ours: "final", approver: "The client", client: "the client",
    titles: { produce: "Design we produce for the client", receive: "Shop drawings and submittals we approve" },
    tabs: { produce: "We design", receive: "We approve" } },
  // A construction manager checks the trades' submittals first and passes them to the designer, who approves.
  CM: { order: ["receive", "produce", "supplier"], ours: "passes", decider: "The designer",
    titles: { receive: "Submittals we check and pass on", produce: "Documents we issue", supplier: "Documents the trades owe us" },
    tabs: { receive: "We check", produce: "We issue", supplier: "Trades owe us" } },
  // A contractor produces for the client or its engineer, and checks its subcontractors' and suppliers' first.
  CONTRACTOR: { order: ["produce", "client", "receive", "supplier"], ours: "passes", decider: "The client or its engineer", approver: "The client or its engineer", client: "the client",
    titles: { produce: "Documents we produce for the client", receive: "Submittals we check and pass on", supplier: "Documents our suppliers owe us" },
    tabs: { receive: "We check" } },
  SUBCONTRACTOR: { order: ["produce", "client", "supplier", "receive"], ours: "passes", decider: "The main contractor", approver: "The main contractor", client: "the main contractor",
    titles: { produce: "Documents we produce for the main contractor", supplier: "Documents our suppliers owe us" } },
  SUPPLIER: { order: ["produce", "client", "supplier", "receive"], ours: "final", approver: "Our customer", client: "our customer",
    titles: { produce: "Documents we produce for our customer", supplier: "Documents our own suppliers owe us" } },
  // A third-party inspector certifies its own scope and comments on the rest; it never approves design.
  INSPECTOR: { order: ["produce", "receive"], ours: "recommends", decider: "The client", approver: "The client",
    titles: { produce: "Reports and certificates we issue", receive: "Documents we review and comment on" },
    tabs: { produce: "We certify", receive: "We comment" } },
};
const GENERIC_WORK: RoleWork = { order: ["produce", "receive", "supplier"], ours: "final" };

function flowsFor({ gate, returner, together, unreviewed, role }: { gate: boolean; returner: string; together: boolean; unreviewed: boolean; role: string }): FlowShape[] {
  const work = ROLE_WORK[role] ?? GENERIC_WORK;
  const all = flowsAll({ gate, returner, together, unreviewed, work });
  const flow = (key: string) => {
    const one = all.find((f) => f.key === key)!;
    return { ...one, title: work.titles?.[key] ?? one.title, tab: work.tabs?.[key] ?? one.tab };
  };
  // The flows that matter most for our role come first, in its words; the others follow.
  const lead = work.order.filter((key) => all.some((f) => f.key === key));
  const rest = ["produce", "receive", "supplier", "deliver", "action", "join", "keep"].filter((key) => !lead.includes(key));
  return [...lead, ...rest].map(flow);
}

function flowsAll({ gate, returner, together, unreviewed, work }: { gate: boolean; returner: string; together: boolean; unreviewed: boolean; work: RoleWork }): FlowShape[] {
  // Released and issued are one act unless the project keeps them apart (POLICY_RELEASE): one step, or two.
  // A released revision may be voided: the road that ends below the release.
  const voided: FlowLane = { scene: "voided", end: true, optional: "it was released in error" };
  const out: FlowLane[][] = together ? [[{ scene: "released-issued" }, voided]] : [[{ scene: "release" }, voided], [{ scene: "issue" }]];
  // Where some document types are not reviewed, review happens only for the others.
  const reviewed = unreviewed ? "its document type is reviewed" : undefined;
  // What we produce: approved outside always when our role answers to someone, else only when asked for.
  const approved: FlowLane[] = work.approver
    ? [{ scene: "approval", tagline: `${work.approver} approves it` }, { scene: "approval-refused", end: true, tagline: `${work.approver} refuses it` }]
    : [{ scene: "approval", optional: "an outside approval is asked for" }, { scene: "approval-refused", end: true, optional: "an outside approval is asked for" }];
  // What others send us: our verdict is final, or another decides after us.
  const afterUs: FlowLane[][] = work.ours === "final" ? [] : [[
    { scene: "approval", tagline: `${work.decider ?? "Another"} decides` },
    { scene: "approval-refused", end: true, tagline: `${work.decider ?? "Another"} refuses it` },
  ]];
  const ourReview = work.ours === "recommends" ? "We review it and recommend" : work.ours === "passes" ? "We check it before passing it on" : "By us, by them, or both";
  return [
    {
      key: "produce", tab: "We produce", title: "Documents we produce", from: "We write it", to: "in force, and sent to whoever needs it",
      columns: [
        [{ scene: "register" }],
        [{ scene: "prepare" }],
        [{ scene: "review", tagline: "Our reviewers, and others when the route names them", optional: reviewed }],
        [{ scene: "accepted" }, { scene: "returned", end: true, tagline: `${returner} returns it` }],
        ...(gate ? [[{ scene: "gate" }, { scene: "gate-return", end: true }]] : []),
        approved,
        ...out,
      ],
    },
    {
      key: "receive", tab: "We receive", title: "Documents we receive", from: "Another organization sends it", to: "accepted here and passed on, or back to them",
      columns: [
        [{ scene: "received" }],
        [{ scene: gate ? "checked" : "checked-self" }],
        [{ scene: "theirs" }],
        [{ scene: "review", tagline: ourReview, optional: reviewed }],
        [{ scene: "accepted", tagline: work.ours === "final" ? undefined : work.ours === "recommends" ? "We recommend it" : "We pass it on" }, { scene: "to-sender", end: true }],
        ...afterUs,
        ...out,
      ],
    },
    {
      key: "supplier", tab: "Suppliers owe us", title: "Documents a supplier owes us", from: "We ask the supplier for it", to: "in force with us, or back with them for the next revision",
      columns: [
        [{ scene: "asked" }],
        [{ scene: "received", tagline: "They send it, on a transmittal" }],
        [{ scene: gate ? "checked" : "checked-self" }],
        [{ scene: "review", tagline: "By us, by them, or both" }],
        [{ scene: "accepted", tagline: "We hold it" }, { scene: "handed-back", end: true }],
        ...out,
      ],
    },
    {
      key: "client", tab: `${cap(work.client ?? "our client")} asks`, title: `Documents ${work.client ?? "our client"} asks of us`, from: `${cap(work.client ?? "our client")} asks for it`, to: `accepted by ${work.client ?? "our client"}, or back with us for the next revision`,
      columns: [
        // Two ways it is asked: their placeholder, filled on their own DELIOS, or asked outside it and recorded here.
        [{ scene: "client-placeholder", optional: "they work on DELIOS" }, { scene: "client-asked", optional: "they are not on DELIOS" }],
        [{ scene: "register", tagline: "Here, when it was asked here", optional: "they are not on DELIOS" }],
        [{ scene: "prepare" }],
        [{ scene: "review", tagline: "Ours, before it goes", optional: "we review before sending" }],
        [{ scene: "client-sent" }],
        [{ scene: "client-check", optional: "they work on DELIOS" }],
        [{ scene: "accepted", tagline: `${cap(work.client ?? "our client")} accepts it` }, { scene: "returned", end: true, tagline: `${cap(work.client ?? "our client")} returns it` }],
      ],
    },
    {
      key: "deliver", tab: "Packages", title: "Packages we deliver", from: "We gather what someone needs", to: "delivered, and accepted by them",
      columns: [
        [{ scene: "pkg-made" }],
        [{ scene: "pkg-checked" }],
        [{ scene: "pkg-short", optional: "something is missing" }],
        [{ scene: "pkg-delivered" }],
        [{ scene: "pkg-accepted" }],
      ],
    },
    {
      key: "action", tab: "Actions", title: "An action on the schedule", from: "The schedule needs documents", to: "the action goes ahead, or is postponed",
      columns: [
        [{ scene: "act-needs" }],
        [{ scene: "act-risk", optional: "a document is still missing" }],
        [{ scene: "act-confirm" }],
        [{ scene: "act-ahead" }, { scene: "act-postponed", end: true }],
      ],
    },
    {
      key: "join", tab: "People joining", title: "Someone joins the project", from: "Someone is needed on the project", to: "on it, and told",
      columns: [
        [{ scene: "join-asked" }],
        [{ scene: "join-confirmed", optional: "confirmation is asked" }, { scene: "join-refused", end: true, optional: "confirmation is asked" }],
        [{ scene: "join-on" }],
      ],
    },
    {
      key: "keep", tab: "Keeping & ending", title: "A document kept, and ended", from: "In the register", to: "kept as long as it must be, or ended with why",
      columns: [
        // Ended at any time while kept: withdrawn once released, cancelled before.
        [{ scene: "kept" }, { scene: "withdrawn", end: true, optional: "it was released and is no longer valid" }, { scene: "cancelled", end: true, optional: "it will never be produced" }],
        [{ scene: "held", optional: "a legal reason calls for it" }],
        [{ scene: "archived", optional: "the project is archived" }],
      ],
    },
  ];
}

const EXTRA: Record<Extra, { title: string; href: string }> = {
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

/** Where every answer of how the project works is changed. */
const HOW = "/settings/control";

export default async function ControlRoomPage() {
  const ctx = await requireScope();
  const { user: me } = ctx;
  const page = SETUP_PAGES.find((one) => one.href === "/settings/flow")!;
  if (!maySetup(me, page)) return <NoAccess title="Control room" who="admin" />;
  /** Whether this person opens the Settings card a link leads to (a page outside Settings opens for everyone of ours). */
  const opens = (href: string) => {
    const path = href.split(/[?#]/)[0];
    const card = SETUP_PAGES.find((one) => one.href === path);
    return !card || maySetup(me, card);
  };

  const [settings, holders, sets, values, templates, schemes, functions, parties, answers, schedule, directory, switches, verdictSets, organization, checksOff] = await Promise.all([
    controlSettings(ctx),
    holdersOf(ctx, "CONTROL"),
    getSets().then((all) => all.map((one) => ({ key: one.key, title: one.title }))),
    // Every value of every list, to count what is in use.
    getSets().then(async (all) => (await Promise.all(all.map(async (one) => (await getSet(one.key)).map((v) => ({ setKey: one.key, code: v.code, label: v.label, status: v.status, props: v.props as Record<string, unknown> }))))).flat()),
    // What only the keepers of Settings may read comes back empty for others: unknown, never counted as none.
    routesForEditor().catch(() => null),
    projectNumbering().then((n) => n.schemes.filter((one) => one.active).length).catch(() => 0),
    adminFunctions().catch(() => null),
    partiesWithAnswers().then((all) => all.filter((one) => one.active)).catch(() => null),
    projectSettings(ctx.projectId).catch(() => new Map<string, string>()),
    scheduleSource(ctx),
    api<{ people: unknown[] }>(projectPath(ctx, "/people/directory")).catch(() => null),
    liberty(),
    api<{ key: string; title: string; verdicts: { code: string; status: string }[] }[]>("/api/admin/verdict-lists").catch(() => null),
    // What is kept about people's activity is the organization's (What is kept), read here only.
    orgSettings().catch(() => null),
    optOutsOf(ctx.projectId).then((all) => all.length).catch(() => null),
  ]);
  const stateNames_ = await stateNames(ctx);

  const gate = holders.length > 0;
  // Our role on the project decides which flows come first, and in whose words.
  const role = ctx.project.role ?? "GENERIC";
  const roleName = (await contractRoleOptions().catch(() => [])).find((one) => one.code === role)?.label ?? roleLabel(role);
  // A document type published as not reviewed goes from Prepare straight to release.
  const unreviewed = values.some((one) => one.setKey === "DOCUMENT_TYPES" && one.status === "ACTIVE" && one.props?.review === false);
  const together = (answers.get("POLICY_RELEASE") ?? "TOGETHER") === "TOGETHER";
  const actRow = new Map(settings.rows.map((row) => [row.activity.key, row]));
  const setTitle = new Map(sets.map((one) => [one.key, one.title]));
  const inUse = (key: string) => values.filter((one) => one.setKey === key && one.status === "ACTIVE").length;
  const lead = schedule.source?.defaultLeadDays ?? DEFAULT_LEAD_DAYS;
  const risk = schedule.source?.riskWindowDays ?? DEFAULT_RISK_DAYS;
  const escalate = answers.get(ESCALATE_AFTER_KEY) ?? String(DEFAULT_ESCALATE_AFTER);
  const receives = functions?.reduce((n, f) => n + f.rules.filter((r) => r.verbs.includes("RECEIVE")).length, 0) ?? null;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

  // Routes may answer from a set of their own; the review step lists every set a live route uses.
  const routeSets = new Set<string>();
  for (const template of templates ?? []) {
    try {
      for (const step of JSON.parse(template.steps) as { outcomeSetKey?: string }[]) if (step.outcomeSetKey) routeSets.add(step.outcomeSetKey);
    } catch { /* a route that cannot be read lists nothing extra */ }
  }
  const stages = STAGES.map((stage) => (stage.key === "review" ? { ...stage, sets: [...new Set([...(stage.sets ?? []), ...routeSets])] } : stage));

  const readOnly = !mayChangeControlRoom(me);
  const fixedItems = new Set(switches.filter((one) => one.area === "Control room" && !one.free).map((one) => one.key));
  const isFixed = (key: string) => fixedItems.has(roomItemOf(key) ?? key);
  const riskFixed = switches.some((one) => one.key === "RISK_WINDOW" && !one.free);
  const clean = (label: string) => label.replace(/ — recommended$/, "").replace(/ \(recommended\)$/, "");
  const names = holders.map((one) => one.name);

  /** A plain line of what stands, with where it is changed. */
  const fact = (key: string, title: string, value: string, href?: string) => (
    <li key={key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
      <span className="text-[13px] font-medium text-slate-900">{title}</span>
      <span className="text-[13px] text-slate-700">
        {value}
        {href && opens(href) && !readOnly ? <> · <Link href={href} className="font-semibold text-link hover:underline">change</Link></> : null}
      </span>
    </li>
  );

  /** One answer of how the project works, changed right where it is read. */
  const answer = (key: string) => {
    if (key === "ROUTE_VERDICTS") {
      if (!templates || !verdictSets) return fact(key, "Which verdicts each route decides with", "Set on each route", "/settings/workflow-templates");
      const options = [
        { value: "", label: "Its documents' own set", text: "The set of Review outcomes serving each document's deliverable type (Types & sets)." },
        ...verdictSets.map((one) => {
          const live = one.verdicts.filter((v) => v.status === "ACTIVE");
          return { value: one.key, label: one.title, text: `${live.length} verdict${live.length === 1 ? "" : "s"}: ${live.map((v) => v.code).join(", ")}.` };
        }),
      ];
      return templates.map((route) => (
        <Choice key={`verdicts:${route.id}`} title={`The route "${route.name}" decides with`} options={options} value={route.outcomeSetKey ?? ""}
          action={setRouteVerdictsAction} hidden={{ id: route.id }} readOnly={readOnly} />
      ));
    }
    if (key === "TRACKING") {
      // The organization's choice for every project; changed on its Settings by an administrator.
      const where = isAdmin(me) ? "/organization/settings/tracking" : undefined;
      if (!organization) return fact(key, "What is kept about people's activity", "The organization's choice");
      return [
        fact("track-acts", "What people do to documents", "Always kept"),
        fact("track-reading", "Opening a document, downloading a file", organization.get("TRACK_READING") === "OFF" ? "Not kept" : "Kept", where),
        fact("track-signins", "Sign-ins, on a person's activity", organization.get("TRACK_SIGN_INS") === "ON" ? "Shown" : "Kept for security, not shown", where),
      ];
    }
    if (key === "CONTROL_PEOPLE") return fact(key, "Who acts as the control function", names.length ? names.join(", ") : "Nobody", `${HOW}#control-people`);
    if (key.startsWith("STATE:")) {
      const code = key.slice(6) === "RELEASED" && together ? "RELEASED_ISSUED" : key.slice(6);
      return fact(key, "This state is called", stateNames_[code as keyof typeof stateNames_] ?? code, `${HOW}#state-names`);
    }
    const stamp = STAMP_KINDS.find((one) => one.key === key);
    if (stamp || key === STAMP_COMMENTS_KEY) {
      const stamped = effectiveAnswer("POLICY_PDF_STAMP", answers.get("POLICY_PDF_STAMP")) === "ON";
      const options = [
        { value: "ON", label: "On", text: stamp ? `${stamp.text}.${stamped ? "" : " Only once the PDF is stamped."}` : `A stamp whose verdict carries comments lists them on a last page of the PDF.${stamped ? "" : " Only once the PDF is stamped."}` },
        { value: "OFF", label: "Off", text: stamp ? "This stamp is left off the PDF." : "The comments stay in the app only." },
      ];
      return <Choice key={key} title={stamp ? `The stamp "${stamp.label}"` : "The verdict's comments on the PDF"} options={options} value={effectiveAnswer(key, answers.get(key))}
        action={setRoomAnswerAction} hidden={{ key }} readOnly={readOnly} fixed={isFixed(key)} />;
    }
    const act = CONTROL_ACTIVITIES.find((one) => one.key === key);
    if (act) {
      const row = actRow.get(key);
      const people = key === PEOPLE_KEY;
      const options = [
        { value: "CONTROL", label: people ? PEOPLE_MODE_LABEL.CONTROL : "The control function", text: act.control },
        { value: "SELF", label: people ? PEOPLE_MODE_LABEL.SELF : "The people doing the work", text: act.self },
        ...(SKIPPABLE[key] ? [{ value: "OFF", label: "Left out", text: SKIPPABLE[key].off }] : []),
      ];
      const value = row?.off ? "OFF" : row?.controlDoes ? "CONTROL" : "SELF";
      return <Choice key={key} title={act.title} options={options} value={value} action={setRoomAnswerAction} hidden={{ key }} readOnly={readOnly} fixed={isFixed(key)} />;
    }
    if (key.startsWith("CONFIRM:")) {
      const of = key.slice(8);
      const options = [
        { value: "ON", label: "Yes", text: CONFIRMABLE[of] ?? "" },
        { value: "OFF", label: "No", text: of === PEOPLE_KEY ? "Nobody confirms: they are on the project at once." : "Nobody confirms: the control function applies it." },
      ];
      return <Choice key={key} title="Confirmed by whoever holds Manage" options={options} value={effectiveAnswer(key, answers.get(key))} action={setRoomAnswerAction} hidden={{ key }} readOnly={readOnly} fixed={isFixed(key)} />;
    }
    if (key === "DAYS") {
      const noSchedule = !schedule.source;
      return [
        <Choice key="lead" title="A document is needed before the action's day" value={String(lead)} unit="days" min={0} max={365} field="leadDays"
          action={setScheduleDaysAction} hidden={{ riskDays: String(risk) }} readOnly={readOnly || noSchedule} />,
        <Choice key="risk" title="The action is at risk from" value={String(risk)} unit="days before" min={0} max={365} field="riskDays"
          action={setScheduleDaysAction} hidden={{ leadDays: String(lead) }} readOnly={readOnly || noSchedule} fixed={riskFixed} />,
      ];
    }
    if (key === "ESCALATE") {
      return <Choice key={key} title="A discipline still silent after the day is told again, with whoever holds Manage and the control function, after" value={escalate} unit="working days" min={1} max={60}
        action={setRoomAnswerAction} hidden={{ key: ESCALATE_AFTER_KEY }} readOnly={readOnly} fixed={isFixed(ESCALATE_AFTER_KEY)} />;
    }
    const policy = POLICIES.find((one) => one.key === key);
    if (!policy) return null;
    const options = policy.options.map((one) => ({ value: one.value, label: clean(one.label), text: one.text }));
    return <Choice key={key} title={policy.title} options={options} value={effectiveAnswer(key, answers.get(key))} action={setRoomAnswerAction} hidden={{ key }} readOnly={readOnly} fixed={isFixed(key)} />;
  };

  const extraCount: Record<Extra, string> = {
    numbering: plural(schemes, "scheme"),
    revisions: "how revisions are named",
    fields: "what each form asks",
    routes: templates ? plural(templates.length, "route") : "the project's routes",
    distribution: receives === null ? "who receives what" : receives ? plural(receives, "rule") : "none yet",
    parties: parties ? plural(parties.length, "organization") : "who takes part",
    packages: "the project's packages",
    schedule: schedule.source ? "the project's schedule" : "no schedule named yet",
    people: directory ? `${directory.people.length} people` : "who is on the project",
    functions: functions ? plural(functions.length, "function") : "what each may do",
    "form:DOCUMENT": "what it asks", "form:REVISION": "what it asks", "form:REVIEW": "what it asks",
    "form:TRANSMITTAL": "what it asks", "form:PACKAGE": "what it asks", "form:ASSET": "what it asks",
    "form:PARTY": "the organization's", "form:PROJECT": "the organization's",
    assets: "what each tag describes",
    checks: checksOff === null ? "what is checked every day" : checksOff ? `${checksOff} switched off, with why` : "none switched off",
    project: "what it is, our role, its dates",
  };

  /** A step's panel: what happens, who does it, how it works here, and where it is set up, each answer changed in place. */
  const panels = Object.fromEntries(stages.map((stage) => {
    const tiles = [
      ...(stage.sets ?? []).map((key) => ({
        title: setTitle.get(key) ?? key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, " "),
        figure: setTitle.has(key) ? `${plural(inUse(key), "value")} in use` : "not set up yet",
        href: `/settings/config?set=${key}`,
        warn: !setTitle.has(key) || !inUse(key),
      })),
      ...(stage.extras ?? []).map((key) => ({ title: EXTRA[key].title, figure: extraCount[key], href: EXTRA[key].href, warn: false })),
    ];
    const fixedWho = stage.who.filter((one): one is { title: string; by: string } => typeof one !== "string");
    const acts = stage.who.filter((one): one is string => typeof one === "string");
    const panel = (
      <section className={cn("register register-sheet register-sheet-open relative overflow-hidden", stage.rail)}>
        <span className="absolute inset-y-0 left-0 w-1 bg-(--rail)" aria-hidden />
        <header className="border-b border-line bg-tint-soft px-5 py-3 sm:px-6">
          <h2 className="text-[15px] font-semibold text-slate-950">{stage.title}</h2>
          <p className="mt-0.5 text-[13px] leading-5 text-slate-600">{stage.text}</p>
        </header>
        <div className="grid grid-cols-1 divide-y divide-line lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
          <div className="space-y-5 px-5 py-4 sm:px-6">
            <div>
              <h3 className="stencil mb-2 text-slate-500">Who does it</h3>
              <ul className="divide-y divide-line">
                {fixedWho.map((one) => (
                  <li key={one.title} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
                    <span className="text-[13px] font-medium text-slate-900">{one.title}</span>
                    <span className="text-[13px] text-slate-700">{one.by}</span>
                  </li>
                ))}
                {acts.map(answer)}
              </ul>
            </div>
            {stage.answers?.length ? (
              <div>
                <h3 className="stencil mb-2 text-slate-500">How it works here</h3>
                <ul className="divide-y divide-line">{stage.answers.flatMap((key) => answer(key))}</ul>
              </div>
            ) : null}
          </div>
          <div className="px-5 py-4 sm:px-6">
            <h3 className="stencil mb-2 text-slate-500">Set up in</h3>
            {tiles.length ? (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {tiles.map((one) => (
                  <li key={one.href}>
                    {opens(one.href) ? (
                      <Link href={one.href} className="group flex h-full flex-col rounded-md bg-tint-soft px-3 py-2 ring-1 ring-line hover:ring-brand-line">
                        <span className="text-[13px] font-medium text-link group-hover:underline">{one.title}</span>
                        <span className={cn("text-xs", one.warn ? "text-amber-800" : "text-slate-600")}>{one.figure}</span>
                      </Link>
                    ) : (
                      <div className="flex h-full flex-col rounded-md bg-tint-soft px-3 py-2 ring-1 ring-line">
                        <span className="text-[13px] font-medium text-slate-800">{one.title}</span>
                        <span className={cn("text-xs", one.warn ? "text-amber-800" : "text-slate-600")}>{one.figure}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-600">Nothing of its own: it works from what the steps before it set.</p>
            )}
          </div>
        </div>
      </section>
    );
    return [stage.key, panel];
  }));

  const byKey = new Map(stages.map((stage) => [stage.key, stage]));
  const returner = actRow.get("RETURN_OUTCOME")?.controlDoes ? "The control function" : "The reviewer";
  const flows: Flow[] = flowsFor({ gate, returner, together, unreviewed, role }).map((flow) => ({
    ...flow,
    columns: flow.columns.map((column) => column.map((lane) => {
      const stage = byKey.get(lane.scene)!;
      const scene: Scene = { key: stage.key, title: stage.title, tagline: lane.tagline ?? stage.tagline, rail: stage.rail };
      return { scene, optional: lane.optional, end: lane.end };
    })),
  }));

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col gap-3 px-5 pt-6 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="plate-title text-slate-950">Control room</h1>
            <p className="plate-meta mt-2">
              The control function: {names.length ? names.join(", ") : "nobody (the people doing the work run the register)"}
              {opens(HOW) ? <> · <Link href={`${HOW}#control-people`} className="text-link hover:underline">{readOnly ? "see" : "change"}</Link></> : null}
            </p>
            <p className="plate-meta mt-1">
              Drawn for our role on {ctx.project.code}: {roleName}
              {opens("/settings/projects") && !readOnly ? <> · <Link href="/settings/projects" className="text-link hover:underline">change</Link></> : null}
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              How {ctx.project.code} works, step by step. Choose a flow, then a step: who does it and how it works here are
              changed right there{readOnly ? " by an administrator or the control function" : ""}; the lists and pages it reads open from it.
            </p>
          </div>
          {opens(HOW) ? <Link href={HOW} className="ask shrink-0 self-start">Every answer on one page</Link> : null}
        </div>
      </section>

      <SceneDeck flows={flows} panels={panels} />
    </div>
  );
}
