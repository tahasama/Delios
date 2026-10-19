import Link from "next/link";
import { Lock } from "lucide-react";
import { SETUP_PAGES, maySetup, mayChangeControlRoom } from "../setup-pages";
import { requireScope } from "@/lib/core/scope";
import { Chip, StateChip } from "@/components/ui";
import { ProjectSettings } from "./project-settings";
import { ActionForm } from "@/components/form";
import { SearchPick } from "@/components/search-pick";
import { api, projectPath } from "@/lib/client";
import { setControlPeopleAction } from "@/lib/settings/forms-people";
import { orgSettings, projectSettings } from "@/lib/settings/api";
import { projectDefaults } from "@/lib/organization/defaults";
import { liberty } from "@/lib/organization/liberty";
import { scheduleSource } from "@/lib/actions/api";
import { POLICIES } from "@/lib/settings/control-activities";
import { StepChoice } from "./step-choice";
import type { AnswerSource } from "@/components/how-it-works";
import { isAdmin } from "@/lib/core/auth";
import { controlSettings, policies, PROJECT_MODE_LABEL, CONTROL_ACTIVITIES, SKIPPABLE } from "@/lib/settings/control-activities";
import { holdersOf } from "@/lib/core/permissions";
import { REV_STATE_COLOR, type RevState } from "@/lib/core/standard";
import { stateNames, stateName } from "@/lib/core/state-names";
import { SceneDeck, type Flow, type Scene } from "./scene-deck";
import { ActSwitch } from "./act-switch";
import { cn } from "@/lib/core/utils";

import { adminFunctions, projectNumbering, partiesWithAnswers, routesForEditor, orEmpty } from "@/lib/settings/api-admin";
import { getSet, getSets } from "@/lib/settings/config";
import { NoAccess } from "../no-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Control room" };

/**
 * The whole flow on one page: each step a document goes through, who carries
 * it out on this project, what the project has chosen, and the lists it draws from.
 *
 * Everything a step decides is changed on that step: who carries an act out
 * (ActSwitch), and the questions it answers (StepChoice, opened in place). What
 * no step decides is lower on the page; lists, routes and numbering link to
 * their own pages.
 */

/** A step that is not a choice, and why. */
type Fixed = { title: string; text: string };

/** A revision state, or the hold, which is read as one. */
type Shown = RevState | "ON_HOLD";

type Stage = {
  key: string;
  title: string;
  /** A few words for the scene card. */
  tagline: string;
  text: string;
  rail: string;
  /** The states a revision is in, or leaves in, at this step. */
  states: Shown[];
  /** Acts the organization decides the carrier of. */
  acts: string[];
  policies: string[];
  sets: string[];
  fixed: Fixed[];
  /** Roads off the main line, with their act where they have one. */
  branches: { title: string; text: string; act?: string; fixed?: string }[];
  /** Other configuration the step reads, with where it is kept. */
  extras: ("numbering" | "routes" | "distribution" | "parties" | "unreviewed")[];
};

/**
 * Every scene, once. A scene several routes pass through — review, release —
 * is the same scene on each, so what is switched in one is switched in all.
 */
const STAGES: Stage[] = [
  {
    key: "received",
    tagline: "Arrives, and is accepted",
    title: "Received",
    text: "The sender's transmittal is recorded, checked against the acceptance conditions, and accepted or rejected.",
    rail: "rail-received",
    states: [],
    acts: [],
    policies: [],
    sets: ["SUPPLIER_CODES", "PURCHASE_ORDERS", "REASONS_FOR_ISSUE", "NATIVE_FORMATS", "RENDITION_FORMATS"],
    fixed: [
      { title: "Accepting what arrived", text: "Whoever recorded it accepts or rejects it against the acceptance conditions. A transmittal with nothing enclosed — a letter — is accepted on recording." },
      { title: "From an organization not on the system", text: "One of our people records it for them; the files that came with it are kept as they arrived." },
    ],
    branches: [],
    extras: ["parties"],
  },
  {
    key: "theirs",
    tagline: "Put in our register",
    title: "Registered",
    text: "A file that arrived becomes a document in the register, under the sender's code and the order it answers.",
    rail: "rail-none",
    states: [],
    acts: [],
    policies: [],
    sets: ["SUPPLIER_CODES", "PURCHASE_ORDERS", "DISCIPLINES", "DOCUMENT_TYPES", "DELIVERABLE_TYPES", "CRITICALITY", "CONFIDENTIALITY"],
    fixed: [{ title: "Making it a document", text: "Done from what arrived, so the register keeps the link to the transmittal it came on." }],
    branches: [],
    extras: ["numbering"],
  },
  {
    key: "register",
    tagline: "Numbered and classified",
    title: "Register",
    text: "The document is given its number and its classification, before anything is written in it.",
    rail: "rail-none",
    states: [],
    acts: [],
    policies: [],
    sets: ["SUBPROJECTS", "DISCIPLINES", "DOCUMENT_TYPES", "DELIVERABLE_TYPES", "DELIVERABLE_TYPE_FIELDS", "PHASES", "CRITICALITY", "CONFIDENTIALITY", "RETENTION_CLASSES"],
    fixed: [{ title: "The number", text: "Built by the scheme its deliverable type uses, and never reused." }],
    branches: [{ title: "Taking a document out of use", text: "Withdrawn: no longer worked from.", act: "WITHDRAW" }],
    extras: ["numbering"],
  },
  {
    key: "prepare",
    tagline: "Written by its author",
    title: "Prepare",
    text: "The author writes the revision and attaches its files, at the status it is meant for.",
    rail: "rail-prep",
    states: ["IN_PREPARATION"],
    acts: [],
    policies: [],
    sets: ["STATUSES", "NATIVE_FORMATS", "RENDITION_FORMATS"],
    branches: [
      { title: "Starting a revision nobody asked for", text: "The last one was accepted as it stands; whoever starts the next writes why.", act: "AUTHORIZE_REVISION" },
    ],
    fixed: [{ title: "A revision the verdict asked for", text: "Refused, accepted with comments, or sent back by the control function: the next revision may be started at once, and carries the verdict as its reason." }],
    extras: [],
  },
  {
    key: "review",
    tagline: "Down its route",
    title: "Review",
    text: "One step: the route the document matches sends it to its reviewers — ours, and another organization's where the route names one, together or in turn as the route says — and each answers with a verdict or advice.",
    rail: "rail-review",
    states: ["IN_REVIEW"],
    acts: ["REVIEW_ISSUE"],
    policies: ["POLICY_MATRIX", "POLICY_MATRIX_DETAIL"],
    sets: ["REVIEW_OUTCOMES", "REVIEW_ADVICE", "COMMENT_CLASSES"],
    fixed: [
      { title: "Outside reviewers on the route", text: "An organization with accounts here answers for itself, alongside ours. One that is not on the system is carried by its liaison — or the control function — who sends the pack out and records what comes back." },
      { title: "Or on a transmittal for review", text: "Sent for review or approval, with an answer due by the reason's period; their answer arrives as a reply, and the verdict is recorded against the revision." },
    ],
    branches: [{ title: "Handing a review to somebody else", text: "A reviewer who cannot answer in time passes the step on.", act: "DELEGATE" }],
    extras: ["routes", "parties", "unreviewed"],
  },
  {
    key: "accepted",
    tagline: "The verdict lets it go on",
    title: "Accepted",
    text: "The binding verdict lets it go on — accepted as it stands, or accepted with comments that the next revision carries.",
    rail: "rail-accepted",
    states: [],
    acts: [],
    policies: [],
    sets: ["REVIEW_OUTCOMES"],
    fixed: [{ title: "What the verdict does", text: "Each verdict is published with what it does: final, final with comments to fix next time, or back to the author. Only the first two go on." }],
    branches: [],
    extras: [],
  },
  {
    key: "returned",
    tagline: "Rejected — back to the author",
    title: "Returned",
    text: "The verdict refuses it: it goes back to the author with the comments, and this revision ends here. The next one answers them.",
    rail: "rail-rejected",
    states: [],
    acts: ["RETURN_OUTCOME"],
    policies: [],
    sets: ["REVIEW_OUTCOMES", "COMMENT_CLASSES"],
    fixed: [{ title: "The next revision", text: "Asked for by the verdict: it may be started at once, and carries the verdict as its reason." }],
    branches: [],
    extras: [],
  },
  {
    key: "to-sender",
    tagline: "For correction — this revision ends",
    title: "Returned to the sender",
    text: "The verdict refuses it: it goes back to whoever sent it, with the comments, for correction. This revision ends here; their next one starts again at Received.",
    rail: "rail-returned",
    states: [],
    acts: ["RETURN_OUTCOME"],
    policies: [],
    sets: ["REVIEW_OUTCOMES", "COMMENT_CLASSES"],
    fixed: [
      { title: "Who it goes back to", text: "The sender, as the document's originator — on a reply to the transmittal it came on. The control function chooses who else is copied in." },
      { title: "To a sender not on the system", text: "One of our people sends it on and marks it sent, with the proof." },
    ],
    branches: [],
    extras: ["parties"],
  },
  {
    key: "gate",
    tagline: "Checked before it is published",
    title: "The control function's check",
    text: "Decided, and waiting: the control function publishes it at the status the review settled on — or sends it back when it is wrong for the record.",
    rail: "rail-check",
    states: ["NOT_RELEASED"],
    acts: [],
    policies: [],
    sets: ["STATUSES"],
    fixed: [],
    branches: [],
    extras: [],
  },
  {
    key: "gate-return",
    tagline: "Sent back — this revision ends",
    title: "Sent back",
    text: "The control function refuses to publish it — the wrong file, a missing enclosure, a status that cannot be true yet — and sends it back with a reason. This revision ends; the next one is authorized.",
    rail: "rail-returned",
    states: ["RETURNED"],
    acts: [],
    policies: [],
    sets: ["RETURN_REASONS"],
    fixed: [
      { title: "To the author, or to a step", text: "Back to the author, or — when the route itself was at fault, for one of the published reasons — to an earlier step of the same route. The control function edits who is copied in." },
    ],
    branches: [],
    extras: [],
  },
  {
    key: "approval",
    tagline: "An outside party approves",
    title: "Approved outside",
    text: "After our own review, somebody outside must approve it before it is released and issued. Approved, it goes on.",
    rail: "rail-accepted",
    states: ["NOT_RELEASED", "ON_HOLD"],
    acts: [],
    policies: [],
    sets: ["REVIEW_OUTCOMES"],
    fixed: [
      { title: "Asked for when it is sent", text: "Whoever asks for it to be sent says that an outside approval is needed, and from whom; the revision stays not released while their step is open." },
    ],
    branches: [
      { title: "On hold", text: "An approval found to be needed after release puts the revision on hold, marked not for use; everyone it went to is told, and again when the hold is lifted or it is sent back.", fixed: "Always on: a revision nobody should use is never left reading as in force." },
    ],
    extras: ["parties"],
  },
  {
    key: "approval-refused",
    tagline: "Not approved — returned",
    title: "Not approved",
    text: "The outside party refuses it: release stays blocked until it is sent back, with a reason, to the author. This revision ends here.",
    rail: "rail-rejected",
    states: ["ON_HOLD"],
    acts: [],
    policies: [],
    sets: [],
    fixed: [{ title: "Sent back, with a copy list", text: "To the author, with a reason; whoever sends it back chooses who else is told. A revision already released stays on hold, not for use, until the next one replaces it." }],
    branches: [],
    extras: ["parties"],
  },
  {
    key: "release",
    tagline: "In force",
    title: "Release",
    text: "The revision comes into force in the register, and the one before it is superseded.",
    rail: "rail-released",
    states: ["RELEASED", "SUPERSEDED"],
    acts: [],
    policies: ["POLICY_RELEASE", "POLICY_PDF_STAMP"],
    sets: [],
    fixed: [],
    branches: [
      { title: "Voiding a revision", text: "Released in error, or never reviewed — and what was done from it is reassessed.", act: "VOID" },
    ],
    extras: [],
  },
  {
    key: "released-issued",
    tagline: "In force, and sent",
    title: "Released & issued",
    text: "One act: the revision comes into force, the one before it is superseded, and it goes at once to the people and organizations named by whoever decided or asked. Nothing is released to nobody.",
    rail: "rail-released",
    states: ["RELEASED", "SUPERSEDED"],
    acts: ["ISSUE"],
    policies: ["POLICY_RELEASE", "POLICY_PDF_STAMP", "POLICY_READY"],
    sets: ["REASONS_FOR_ISSUE", "ISSUE_CODES"],
    fixed: [
      { title: "Who receives it", text: "Named by the decider, or by whoever asked for it to be sent; the release shows them, each removable, and others may be added." },
      { title: "To an organization not on the system", text: "One of our people sends it on and marks it sent, with the proof; until then it reads as not yet sent." },
    ],
    branches: [
      { title: "Voiding a revision", text: "Released in error, or never reviewed — and what was done from it is reassessed.", act: "VOID" },
      { title: "An action going ahead without its documents", text: "The day passes and something it needed is missing; the note says who decided and who owns the delay.", act: "ACTION_NOTE" },
    ],
    extras: ["distribution", "parties"],
  },
  {
    key: "asked",
    tagline: "Asked on a transmittal",
    title: "Asked of the supplier",
    text: "A placeholder from the supplier's package goes to them on a transmittal, issued for update, due on its planned day. From then the supplier holds it: only they change it until they send it.",
    rail: "rail-sent",
    states: [],
    acts: [],
    policies: [],
    sets: ["SUPPLIER_CODES", "PURCHASE_ORDERS"],
    fixed: [
      { title: "Asked once", text: "Each placeholder is asked once, from the package or the register; after that it is handed back and forth." },
      { title: "Who holds it", text: "One side at a time: the supplier while it is with them, us once they send it; only the holder changes it." },
    ],
    branches: [],
    extras: ["parties"],
  },
  {
    key: "checked",
    tagline: "Accepted, or back to them",
    title: "The control function's check",
    text: "What the supplier sent is checked before it counts: accepted, it becomes the document's revision and we hold it; returned, with why, they hold it again to correct it.",
    rail: "rail-check",
    states: [],
    acts: [],
    policies: [],
    sets: [],
    fixed: [{ title: "Nothing counts before the check", text: "Until it is accepted, the files belong to the transmittal they came on; the document keeps what it had." }],
    branches: [],
    extras: [],
  },
  {
    key: "handed-back",
    tagline: "Theirs again, to update",
    title: "Back with the supplier",
    text: "A review that rejects it, or releases it with comments to take in, hands it back to the supplier for the next revision; their people are told and it is on their Home. Either side may also ask the holder to hand it back for an update, with why.",
    rail: "rail-rejected",
    states: ["RETURNED"],
    acts: [],
    policies: [],
    sets: [],
    fixed: [{ title: "Read from what the verdict means", text: "Accepted or for information: we keep it. Accepted with comments or rejected: it goes back to them. Never read from a verdict's code." }],
    branches: [],
    extras: [],
  },
  {
    key: "issue",
    tagline: "Sent out",
    title: "Issue",
    text: "The revision is sent out on a transmittal, to the people the distribution names.",
    rail: "rail-issue",
    states: [],
    acts: ["ISSUE"],
    policies: ["POLICY_READY"],
    sets: ["REASONS_FOR_ISSUE", "ISSUE_CODES"],
    fixed: [{ title: "To an organization not on the system", text: "One of our people sends it on and marks it sent, with the proof; until then it reads as not yet sent." }],
    branches: [{ title: "An action going ahead without its documents", text: "The day passes and something it needed is missing; the note says who decided and who owns the delay.", act: "ACTION_NOTE" }],
    extras: ["distribution", "parties"],
  },
];

/**
 * The two flows a document can take, from the organization's own side: what
 * it produces, and what it receives. Whether the organization is the owner, the
 * client, a contractor or a supplier changes who is on the other side, never
 * the flow.
 *
 * After a decision the line forks: one lane carries on, the other ends — the
 * revision goes back, and the next one starts the flow again. Who sends it back
 * follows the project: the control function where it has one, the people doing the
 * work where it has not. Without a control function there is no check before
 * release either; the verdict releases it.
 */
type FlowLane = { scene: string; optional?: string; tagline?: string; end?: boolean };
function flowsFor({ gate, returner, together }: { gate: boolean; returner: string; together: boolean }): { key: string; title: string; from: string; to: string; columns: FlowLane[][] }[] {
  // Released and issued are one act unless the project keeps them apart (POLICY_RELEASE): one step, or two.
  const out: FlowLane[][] = together ? [[{ scene: "released-issued" }]] : [[{ scene: "release" }], [{ scene: "issue" }]];
  return [
    {
      key: "produce",
      title: "Documents we produce",
      from: "We write it",
      to: "In force, and sent to whoever needs it",
      columns: [
        [{ scene: "register" }],
        [{ scene: "prepare" }],
        // One step. Ours always review it; another organization's reviewers are
        // on the same step, alongside ours, when the route names them.
        [{ scene: "review", tagline: "Our reviewers, and others when the route names them" }],
        [{ scene: "accepted" }, { scene: "returned", end: true, tagline: `Rejected — ${returner} returns it` }],
        ...(gate ? [[{ scene: "gate", tagline: "Passes, and is published" }, { scene: "gate-return", end: true }]] : []),
        [
          { scene: "approval", optional: "an outside approval is asked for" },
          { scene: "approval-refused", end: true, optional: "an outside approval is asked for", tagline: `Not approved — ${returner} returns it` },
        ],
        ...out,
      ],
    },
    {
      key: "receive",
      title: "Documents we receive",
      from: "Another organization sends it",
      to: "Back to them for correction — or accepted here, and passed on",
      columns: [
        [{ scene: "received" }],
        [{ scene: "theirs" }],
        // One step, by us, by another organization, or both: the route the
        // document matches decides who is on it.
        [{ scene: "review", tagline: "By us, by them, or both" }],
        [{ scene: "accepted" }, { scene: "to-sender", end: true, tagline: `For correction — ${returner} returns it` }],
        ...out,
      ],
    },
    {
      key: "supplier",
      title: "Documents a supplier owes us",
      from: "We ask the supplier for it",
      to: "In force with us — or back with them for the next revision",
      columns: [
        [{ scene: "asked" }],
        [{ scene: "received", tagline: "They send it, on a transmittal" }],
        [{ scene: "checked" }],
        [{ scene: "review", tagline: "By us, by them, or both" }],
        [{ scene: "accepted", tagline: "We hold it" }, { scene: "handed-back", end: true }],
        ...out,
      ],
    },
  ];
}

const EXTRA: Record<Stage["extras"][number], { title: string; href: string }> = {
  numbering: { title: "Numbering schemes", href: "/settings/numbering" },
  routes: { title: "Review routes", href: "/settings/workflow-templates" },
  distribution: { title: "Distribution rules", href: "/distribution" },
  parties: { title: "Outside organizations", href: "/settings/parties" },
  unreviewed: { title: "Document types not reviewed", href: "/settings/config?set=DOCUMENT_TYPES" },
};

export default async function ControlRoomPage() {
  const ctx = await requireScope();
  const { user: me } = ctx;
  const page = SETUP_PAGES.find((one) => one.href === "/settings/flow")!;
  if (!maySetup(me, page)) return <NoAccess title="Control room" who="admin" />;
  // Everyone of ours reads how the project works; an administrator or the control function changes it.
  const changesIt = mayChangeControlRoom(me);

  const [settings, chosen, holders, sets, values, templates, schemes, rules, names, parties, answers, defaults, switches, schedule] = await Promise.all([
    controlSettings(ctx),
    policies(ctx),
    holdersOf(ctx, "CONTROL"),
    getSets().then((all) => all.map((one) => ({ key: one.key, title: one.title, description: one.description }))),
    // Every value of every list, to count what is in use.
    getSets().then(async (all) => (await Promise.all(all.map(async (one) => (await getSet(one.key)).map((v) => ({
      setKey: one.key, code: v.code, status: v.status, props: Object.keys(v.props).length ? JSON.stringify(v.props) : null,
    }))))).flat()),
    routesForEditor().catch(() => []),
    projectNumbering().then((n) => n.schemes.filter((one) => one.active).length).catch(() => 0),
    // Who receives what is the matrix's Receive rows.
    orEmpty(adminFunctions).then((all) => all.reduce((n, f) => n + f.rules.filter((r) => r.verbs.includes("RECEIVE")).length, 0)),
    stateNames(ctx),
    partiesWithAnswers().then((all) => all.filter((one) => one.active).map((one) => ({ kind: one.kind }))).catch(() => []),
    projectSettings(ctx.projectId).catch(() => new Map<string, string>()),
    projectDefaults().catch(() => null),
    liberty(),
    scheduleSource(ctx),
  ]);

  const orgAnswers = await orgSettings().catch(() => new Map<string, string>());
  const directory = await api<{
    people: { id: string; name: string; partyId: string | null; organization: string | null; function: string; control: boolean; actsAsControl: boolean }[];
    organizations: { id: string; kind: string }[];
    mayNameControl: boolean;
  }>(projectPath(ctx, "/people/directory")).catch(() => null);
  const ours = new Set(directory?.organizations.filter((o) => o.kind === "OURS").map((o) => o.id) ?? []);
  const ourPeople = (directory?.people ?? []).filter((p) => p.partyId === null || ours.has(p.partyId));
  const byFunction = ourPeople.filter((p) => p.control && !p.actsAsControl);
  const gate = holders.length > 0;
  const together = chosen.find((one) => one.policy.key === "POLICY_RELEASE")?.value === "TOGETHER";
  const actRow = new Map(settings.rows.map((row) => [row.activity.key, row]));
  const setByKey = new Map(sets.map((one) => [one.key, one]));
  // Where every answer comes from: what the organization keeps the same on every project is read only here (ROOM_FIXED).
  const source: AnswerSource = {
    target: "project",
    answers,
    base: defaults?.values ?? null,
    fixed: switches.filter((one) => one.area === "Control room" && !one.free).map((one) => one.key),
  };

  // Routes may answer from a set of their own; the review step lists every set
  // a live route uses, not only the default one.
  const routeSets = new Set<string>();
  for (const template of templates) {
    try {
      for (const step of JSON.parse(template.steps) as { outcomeSetKey?: string }[]) if (step.outcomeSetKey) routeSets.add(step.outcomeSetKey);
    } catch { /* a route that cannot be read lists nothing extra */ }
  }
  const stages = STAGES.map((stage) =>
    stage.key === "review" ? { ...stage, sets: [...new Set([...stage.sets, ...routeSets])] } : stage,
  );

  const extraCount: Record<Stage["extras"][number], string> = {
    numbering: `${schemes} in use`,
    routes: `${templates.length} live`,
    distribution: rules ? `${rules} rule${rules === 1 ? "" : "s"}` : "none yet",
    unreviewed: (() => {
      // A type says when it is published whether it is reviewed; one that is
      // not goes from Prepare straight to release and never reaches this step.
      const skipped = values.filter((one) => one.setKey === "DOCUMENT_TYPES" && one.status === "ACTIVE" && /"review"\s*:\s*false/.test(one.props ?? ""));
      return skipped.length ? `${skipped.length} — ${skipped.slice(0, 6).map((one) => one.code).join(", ")}${skipped.length > 6 ? "…" : ""}: from Prepare straight to release` : "none — every type is reviewed";
    })(),
    parties: (() => {
      const offline = parties.filter((one) => one.kind === "OFFLINE").length;
      return `${parties.length - offline} answer here · ${offline} not on the system`;
    })(),
  };

  const stateLabel = (state: Shown) =>
    state === "ON_HOLD" ? names.ON_HOLD
      : state === "RELEASED" ? (together ? names.RELEASED_ISSUED : names.RELEASED)
      : stateName(names, state);
  const stateColor = (state: Shown) => (state === "ON_HOLD" ? "bg-red-50/40 text-red-800 ring-red-300" : REV_STATE_COLOR[state]);

  // Release reads differently with and without somebody standing between the
  // route and the register; the gate is the control function itself.
  const releaseFixed: Fixed = gate
    ? { title: "The control function's gate", text: `A finished route waits as Not released until the control function publishes it — ${holders.length} ${holders.length === 1 ? "person holds" : "people hold"} the control function.` }
    : { title: "No gate", text: "Nobody holds the control function, so a finished route is released at once." };

  const panels = Object.fromEntries(stages.map((stage) => {
    // The check before release is The control function's gate where there is one,
    // and the release itself says so where there is none.
    const fixed = stage.key === (gate ? "gate" : "release") ? [releaseFixed, ...stage.fixed] : stage.fixed;
    // Not released and Returned to review only exist where there is a gate.
    const states = stage.states.filter((state) => gate || (state !== "NOT_RELEASED" && state !== "RETURNED"));
    const panel = (
        <section key={stage.key} className={cn("register register-sheet register-sheet-open relative", stage.rail)}>
          <span className="absolute inset-y-0 left-0 w-0.75 rounded-l-[0.875rem] bg-(--rail)" aria-hidden />
          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <h2 className="text-sm font-semibold text-slate-900">{stage.title}</h2>
            <span className="text-xs text-slate-600">{stage.text}</span>
            {states.length ? (
              <span className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
                {states.map((state) => <StateChip key={state} label={stateLabel(state)} color={stateColor(state)} />)}
                {changesIt ? <Link href="#state-names" className="text-[11px] font-semibold text-link hover:underline">rename</Link> : null}
              </span>
            ) : null}
          </header>

          <div className="grid grid-cols-1 divide-y divide-line lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
            {/* What the step decides: who carries it out, and the questions it answers. */}
            <div className="space-y-3 px-5 py-3.5 sm:px-6">
              <h3 className="stencil text-slate-500">Who does it</h3>
              {stage.acts.length || fixed.length ? (
                <ul className="space-y-2.5">
                  {stage.acts.map((key) => <ActLine key={key} act={key} row={actRow.get(key)} readOnly={!changesIt} />)}
                  {fixed.map((one) => <FixedLine key={one.title} {...one} />)}
                </ul>
              ) : (
                <p className="text-xs text-slate-600">Whoever is doing the work — nothing here to switch.</p>
              )}

              {stage.policies.map((key) => <StepChoice key={key} source={source} policyKey={key} readOnly={!changesIt} />)}

              {stage.branches.length ? (
                <div className="border-t border-line pt-2.5">
                  <h3 className="stencil mb-1.5 text-slate-500">Off this step</h3>
                  <ul className="space-y-2.5">
                    {stage.branches.map((branch) => branch.act
                      ? <ActLine key={branch.title} act={branch.act} row={actRow.get(branch.act)} readOnly={!changesIt} />
                      : <FixedLine key={branch.title} title={branch.title} text={`${branch.text} ${branch.fixed ?? ""}`.trim()} />)}
                  </ul>
                </div>
              ) : null}
            </div>

            {/* What it reads: the lists, and where else it is set up. Each opens where it is kept. */}
            <div className="space-y-3 px-5 py-3.5 sm:px-6">
              <h3 className="stencil text-slate-500">Lists it uses</h3>
              {stage.sets.length ? (
                <ul className="space-y-1">
                  {stage.sets.map((key) => (
                    <SetLine key={key} setKey={key} set={setByKey.get(key)} values={values.filter((one) => one.setKey === key)} />
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-600">None — this step reads what the earlier ones set.</p>
              )}
              {stage.extras.length ? (
                <ul className="space-y-1 border-t border-line pt-2.5">
                  {stage.extras.map((key) => (
                    <li key={key} className="flex flex-wrap items-baseline justify-between gap-x-2 text-[13px]">
                      <Link href={EXTRA[key].href} className="font-medium text-link hover:underline">{EXTRA[key].title}</Link>
                      <span className="text-[11px] text-slate-500">{extraCount[key]}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </section>
    );
    return [stage.key, panel];
  }));

  const sceneOf = (stage: Stage): Scene => ({ key: stage.key, title: stage.title, tagline: stage.tagline, rail: stage.rail });
  const byKey = new Map(stages.map((stage) => [stage.key, stage]));
  const returner = actRow.get("RETURN_OUTCOME")?.controlDoes ? "The control function" : "the reviewer";
  const shape = flowsFor({ gate, returner, together });
  const flows: Flow[] = shape.map((flow) => ({
    ...flow,
    columns: flow.columns.map((column) => column.map((lane) => ({ scene: { ...sceneOf(byKey.get(lane.scene)!), ...(lane.tagline ? { tagline: lane.tagline } : {}) }, optional: lane.optional, end: lane.end }))),
  }));

  // What a step of the flow decides is changed on that step only: below, each act is named with the step it is on.
  const placedActs: Record<string, { title: string; href: string }> = {};
  for (const flow of shape) {
    for (const lane of flow.columns.flat()) {
      const stage = byKey.get(lane.scene)!;
      for (const act of [...stage.acts, ...stage.branches.flatMap((b) => (b.act ? [b.act] : []))]) {
        placedActs[act] ??= { title: stage.title, href: `#${flow.key}/${stage.key}` };
      }
    }
  }
  const shown = new Set(shape.flatMap((flow) => flow.columns.flat().map((lane) => lane.scene)));
  const placedPolicies = POLICIES.map((one) => one.key).filter((key) => stages.some((stage) => shown.has(stage.key) && stage.policies.includes(key)));

  const whoDoesWhat = PROJECT_MODE_LABEL[settings.projectMode];
  const onThisPage: [string, string][] = [
    ["#the-flow", "The flow"],
    ["#control-people", "Who acts as the control function"],
    ["#how-it-works", "Who carries the other acts out"],
    ["#action-days", "The days around an action"],
    ...(changesIt ? [["#state-names", "What the states are called"], ["#defaults", "Back to the defaults"]] as [string, string][] : []),
  ];

  return (
    <div className="space-y-4">
      {/* The masthead: where the project stands, before the steps. */}
      <section className="register register-sheet register-sheet-open">
        <div className="px-5 pt-6 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">Control room</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            How {ctx.project.code} works: every step a document goes through, who carries each act out, and what the project chose.
            {changesIt ? " Choose a step to see what it decides, and change it there." : " You read it; an administrator or the control function changes it."}
          </p>
        </div>
        <div className="grid grid-cols-1 divide-y divide-line border-t border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-5 py-3 sm:px-6">
            <h2 className="stencil text-slate-500">Control function</h2>
            <p className="mt-1 text-[13px] font-medium text-slate-900">{gate ? `${holders.length} ${holders.length === 1 ? "person" : "people"}` : "Nobody"}</p>
            <p className="text-xs leading-5 text-slate-600">{gate ? "Stands between the work and the register." : "The people doing the work run the register."}</p>
            <a href="#control-people" className="text-xs font-semibold text-link hover:underline">Who acts as it</a>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <h2 className="stencil text-slate-500">Who does what</h2>
            <p className="mt-1 text-[13px] font-medium text-slate-900">{whoDoesWhat}</p>
            <p className="text-xs leading-5 text-slate-600">{settings.set ? "Answered for this project." : "Not answered yet: read from the project."}</p>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <h2 className="stencil text-slate-500">Releasing</h2>
            <p className="mt-1 text-[13px] font-medium text-slate-900">{together ? names.RELEASED_ISSUED : names.RELEASED}</p>
            <p className="text-xs leading-5 text-slate-600">{together ? "Releasing sends it." : "Releasing means go ahead."} {answers.has("POLICY_RELEASE") ? "Chosen here." : "The default."}</p>
          </div>
        </div>
        <nav aria-label="On this page" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-5 py-2.5 text-xs sm:px-6">
          <span className="text-slate-500">On this page:</span>
          {onThisPage.map(([href, label]) => <a key={href} href={href} className="font-semibold text-link hover:underline">{label}</a>)}
        </nav>
      </section>

      <div id="the-flow" className="scroll-mt-24">
        <SceneDeck flows={flows} panels={panels} />
      </div>

      {/* Who acts as the control function: named here, whatever their function. */}
      {directory ? (
        <section className="register register-sheet register-sheet-open scroll-mt-24" id="control-people" aria-labelledby="control-people-head">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <h2 id="control-people-head" className="stencil mr-1 text-slate-500">Who acts as the control function</h2>
            <span className="text-[11px] text-slate-500">whatever their function: they keep the register, check what arrives, add people…</span>
          </div>
          <div className="space-y-3 px-5 py-4 sm:px-6">
            {byFunction.length ? (
              <div className="space-y-1.5">
                <p className="text-xs text-slate-600">
                  By their function (changed in <Link href="/settings/functions" className="font-semibold text-link hover:underline">Functions</Link>):
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {byFunction.map((p) => (
                    <li key={p.id}><Chip className="bg-tint-soft text-slate-700 ring-line">{p.name}<span className="ml-1 font-normal text-slate-500">{p.function}</span></Chip></li>
                  ))}
                </ul>
              </div>
            ) : null}
            {directory.mayNameControl ? (
              <ActionForm action={setControlPeopleAction} submitLabel="Save" size="sm">
                <div className="max-w-xl">
                  <SearchPick name="userIds" label={`Named on ${ctx.project.code}`} hint="people of ours on the project; each is told"
                    items={ourPeople.filter((p) => !byFunction.some((b) => b.id === p.id)).map((p) => ({ id: p.id, name: p.name, detail: p.function }))}
                    initial={ourPeople.filter((p) => p.actsAsControl).map((p) => p.id)} placeholder="Find someone" />
                  <p className="mt-1.5 text-[11px] leading-4 text-slate-500">Nobody named, and no function carrying it: the project has no control function, and the people doing the work carry its acts out themselves.</p>
                </div>
              </ActionForm>
            ) : (
              <p className="text-xs leading-5 text-slate-600">
                Named on {ctx.project.code}: {ourPeople.filter((p) => p.actsAsControl).map((p) => p.name).join(", ") || "nobody"}. An administrator, or whoever acts as the control function, names them.
              </p>
            )}
          </div>
        </section>
      ) : null}

      <ProjectSettings
        source={source}
        follows={gate}
        placed={{ acts: placedActs, policies: placedPolicies }}
        names={names}
        defaults={defaults}
        schedule={schedule.source ? { defaultLeadDays: schedule.source.defaultLeadDays ?? null, riskWindowDays: schedule.source.riskWindowDays ?? null } : null}
        riskFixed={switches.some((one) => one.key === "RISK_WINDOW" && !one.free)}
        admin={isAdmin(me)}
        readOnly={!changesIt}
      />

      {/* What is kept about people's activity: the organization's choice, shown here, changed on its page. */}
      <section className="register register-sheet register-sheet-open" aria-labelledby="tracking-head">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <h2 id="tracking-head" className="stencil mr-1 text-slate-500">What is kept about people&rsquo;s activity</h2>
          <span className="text-[11px] text-slate-500">the organization&rsquo;s choice, for every project</span>
        </div>
        <ul className="divide-y divide-line">
          <li className="px-5 py-2.5 text-xs leading-5 text-slate-600 sm:px-6"><span className="font-semibold text-slate-800">Acts on documents:</span> always kept (registered, reviewed, released, sent, returned).</li>
          <li className="px-5 py-2.5 text-xs leading-5 text-slate-600 sm:px-6"><span className="font-semibold text-slate-800">Who opened a document or downloaded a file:</span> {orgAnswers.get("TRACK_READING") === "OFF" ? "not kept." : "kept."}</li>
          <li className="px-5 py-2.5 text-xs leading-5 text-slate-600 sm:px-6"><span className="font-semibold text-slate-800">Sign-ins:</span> kept for security; {orgAnswers.get("TRACK_SIGN_INS") === "ON" ? "shown on a person's activity." : "not shown on a person's activity."}</li>
        </ul>
        <p className="border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">
          {isAdmin(me) ? <>Changed on the <Link href="/organization#tracking" className="font-semibold text-link hover:underline">organization&rsquo;s page</Link>.</> : "An administrator changes it, on the organization's page."}
        </p>
      </section>
    </div>
  );
}

/** One act the organization decides the carrier of, switchable in place. */
function ActLine({ act, row, readOnly }: { act: string; row?: { controlDoes: boolean; off: boolean }; readOnly?: boolean }) {
  const activity = CONTROL_ACTIVITIES.find((one) => one.key === act);
  if (!activity || !row) return null;
  return (
    <ActSwitch
      act={act}
      title={activity.title}
      controlText={activity.control}
      selfText={activity.self}
      controlDoes={row.controlDoes}
      offText={SKIPPABLE[act]?.off}
      off={row.off}
      readOnly={readOnly}
    />
  );
}

function FixedLine({ title, text }: Fixed) {
  return (
    <li>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[13px] font-medium text-slate-900">{title}</span>
        <Chip className="bg-tint-soft text-slate-500 ring-slate-200"><Lock className="mr-1 h-3 w-3" />Fixed</Chip>
      </p>
      <p className="mt-0.5 text-xs leading-5 text-slate-600">{text}</p>
    </li>
  );
}

/** A list the step reads: its name (opening it in Types & sets), and how many of its values are in use. */
function SetLine({ setKey, set, values }: {
  setKey: string;
  set?: { title: string; description: string | null };
  values: { status: string }[];
}) {
  const on = values.filter((one) => one.status === "ACTIVE").length;
  const off = values.length - on;
  // A list not set up yet still reads by its name, never its key.
  const name = set?.title ?? setKey.charAt(0) + setKey.slice(1).toLowerCase().replace(/_/g, " ");
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-2 text-[13px]">
      <Link href={`/settings/config?set=${setKey}`} title={set?.description ?? undefined} className="font-medium text-link hover:underline">{name}</Link>
      <span className={cn("text-[11px]", set && on ? "text-slate-500" : "text-amber-800")}>
        {!set ? "not set up yet" : on ? `${on} in use${off ? ` · ${off} retired` : ""}` : "none in use"}
      </span>
    </li>
  );
}
