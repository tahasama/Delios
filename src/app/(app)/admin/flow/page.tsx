import Link from "next/link";
import { Lock } from "lucide-react";
import { SETUP_PAGES, maySetup } from "../setup-pages";
import { requireScope } from "@/lib/scope";
import { PageHeader, Chip, StateChip } from "@/components/ui";
import { controlSettings, policies, PROJECT_MODE_LABEL, CONTROL_ACTIVITIES, SKIPPABLE } from "@/lib/control-activities";
import { holdersOf } from "@/lib/permissions";
import { REV_STATE_COLOR, type RevState } from "@/lib/standard";
import { stateNames, stateName } from "@/lib/state-names";
import { SceneDeck, type Flow, type Scene } from "./scene-deck";
import { ActSwitch } from "./act-switch";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Control room" };

/**
 * The whole flow on one page: each step a document goes through, who carries
 * it out, what the organization has switched on, and the sets it draws from.
 *
 * Read only. Every answer shown here is changed on the page that owns it, and
 * each box links there — so this page can never disagree with the settings,
 * it only puts them in the order a document meets them.
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
    rail: "rail-superseded",
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
    tagline: "Made one of ours",
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
    sets: ["PROJECT_CODES", "SUBPROJECTS", "DISCIPLINES", "DOCUMENT_TYPES", "DELIVERABLE_TYPES", "DELIVERABLE_TYPE_FIELDS", "PHASES", "CRITICALITY", "CONFIDENTIALITY", "RETENTION_CLASSES"],
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
    fixed: [{ title: "A revision the verdict asked for", text: "Refused, accepted with comments, or sent back by Document Control: the next revision may be started at once, and carries the verdict as its reason." }],
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
    policies: ["POLICY_PDF_STAMP", "POLICY_MATRIX", "POLICY_MATRIX_DETAIL"],
    sets: ["REVIEW_OUTCOMES", "REVIEW_ADVICE", "COMMENT_CLASSES"],
    fixed: [
      { title: "Outside reviewers on the route", text: "An organization with accounts here answers for itself, alongside ours. One that is not on the system is carried by its liaison — or Document Control — who sends the pack out and records what comes back." },
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
    rail: "rail-released",
    states: [],
    acts: [],
    policies: ["POLICY_PDF_STAMP", "POLICY_MATRIX", "POLICY_MATRIX_DETAIL"],
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
    rail: "rail-void",
    states: [],
    acts: ["RETURN_OUTCOME"],
    policies: ["POLICY_PDF_STAMP", "POLICY_MATRIX", "POLICY_MATRIX_DETAIL"],
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
    rail: "rail-void",
    states: [],
    acts: ["RETURN_OUTCOME"],
    policies: ["POLICY_PDF_STAMP", "POLICY_MATRIX", "POLICY_MATRIX_DETAIL"],
    sets: ["REVIEW_OUTCOMES", "COMMENT_CLASSES"],
    fixed: [
      { title: "Who it goes back to", text: "The sender, as the document's originator — on a reply to the transmittal it came on. Document Control chooses who else is copied in." },
      { title: "To a sender not on the system", text: "One of our people sends it on and marks it sent, with the proof." },
    ],
    branches: [],
    extras: ["parties"],
  },
  {
    key: "gate",
    tagline: "Checked before it is published",
    title: "Document Control's check",
    text: "Decided, and waiting: Document Control publishes it at the status the review settled on — or sends it back when it is wrong for the record.",
    rail: "rail-release",
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
    text: "Document Control refuses to publish it — the wrong file, a missing enclosure, a status that cannot be true yet — and sends it back with a reason. This revision ends; the next one is authorized.",
    rail: "rail-void",
    states: ["RETURNED"],
    acts: [],
    policies: [],
    sets: ["RETURN_REASONS"],
    fixed: [
      { title: "To the author, or to a step", text: "Back to the author, or — when the route itself was at fault, for one of the published reasons — to an earlier step of the same route. Document Control edits who is copied in." },
    ],
    branches: [],
    extras: [],
  },
  {
    key: "approval",
    tagline: "An outside party approves",
    title: "Approved outside",
    text: "After our own review, somebody outside must approve it before it is released and issued. Approved, it goes on.",
    rail: "rail-release",
    states: ["NOT_RELEASED", "ON_HOLD"],
    acts: [],
    policies: ["POLICY_PDF_STAMP", "POLICY_MATRIX", "POLICY_MATRIX_DETAIL"],
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
    rail: "rail-void",
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
    policies: ["POLICY_RELEASE"],
    sets: [],
    fixed: [],
    branches: [
      { title: "Voiding a revision", text: "Released in error, or never reviewed — and what was done from it is reassessed.", act: "VOID" },
    ],
    extras: [],
  },
  {
    key: "issue",
    tagline: "Sent out",
    title: "Issue",
    text: "The revision is sent out on a transmittal, to the people the distribution names.",
    rail: "rail-release",
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
 * follows the project: Document Control where it has one, the people doing the
 * work where it has not. Without a control function there is no check before
 * release either; the verdict releases it.
 */
type FlowLane = { scene: string; optional?: string; tagline?: string; end?: boolean };
function flowsFor({ gate, returner }: { gate: boolean; returner: string }): { key: string; title: string; from: string; to: string; columns: FlowLane[][] }[] {
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
        [{ scene: "review", tagline: "Ours always · outside ones too, when named" }],
        [{ scene: "accepted" }, { scene: "returned", end: true, tagline: `Rejected — ${returner} returns it` }],
        ...(gate ? [[{ scene: "gate", tagline: "Passes, and is published" }, { scene: "gate-return", end: true }]] : []),
        [
          { scene: "approval", optional: "an outside approval is asked for" },
          { scene: "approval-refused", end: true, optional: "an outside approval is asked for", tagline: `Not approved — ${returner} returns it` },
        ],
        [{ scene: "release" }],
        [{ scene: "issue" }],
      ],
    },
    {
      key: "receive",
      title: "Documents we receive",
      from: "Another organization sends it",
      to: "Back to them for correction — or in force here, and passed on",
      columns: [
        [{ scene: "received" }],
        [{ scene: "theirs" }],
        // One step, by us, by another organization, or both: the route the
        // document matches decides who is on it.
        [{ scene: "review", tagline: "Ours, theirs, or both" }],
        [{ scene: "accepted" }, { scene: "to-sender", end: true, tagline: `For correction — ${returner} returns it` }],
        [{ scene: "release" }],
        [{ scene: "issue" }],
      ],
    },
  ];
}

const EXTRA: Record<Stage["extras"][number], { title: string; href: string }> = {
  numbering: { title: "Numbering schemes", href: "/admin/numbering" },
  routes: { title: "Review routes", href: "/admin/workflow-templates" },
  distribution: { title: "Distribution rules", href: "/admin/controlled" },
  parties: { title: "Outside organizations", href: "/admin/parties" },
  unreviewed: { title: "Document types not reviewed", href: "/admin/config?set=DOCUMENT_TYPES" },
};

export default async function ControlRoomPage() {
  const ctx = await requireScope();
  const { user: me, db } = ctx;
  const page = SETUP_PAGES.find((one) => one.href === "/admin/flow")!;
  if (!maySetup(me, page)) return <PageHeader title="Control room" subtitle="Administrators only." />;

  const [settings, chosen, holders, sets, values, templates, schemes, rules, names, parties] = await Promise.all([
    controlSettings(ctx),
    policies(ctx),
    holdersOf(ctx, "CONTROL"),
    db.configSet.findMany({ select: { key: true, title: true, description: true } }),
    db.configValue.findMany({ select: { setKey: true, code: true, label: true, status: true, props: true }, orderBy: [{ sort: "asc" }, { code: "asc" }] }),
    db.workflowTemplate.findMany({ where: { active: true }, select: { name: true, steps: true, outcomeSetKey: true } }),
    db.scheme.count({ where: { active: true } }),
    db.distributionRule.count(),
    stateNames(ctx),
    db.party.findMany({ where: { active: true }, select: { kind: true } }),
  ]);

  const gate = holders.length > 0;
  const together = chosen.find((one) => one.policy.key === "POLICY_RELEASE")?.value === "TOGETHER";
  const actRow = new Map(settings.rows.map((row) => [row.activity.key, row]));
  const policyRow = new Map(chosen.map((one) => [one.policy.key, one]));
  const setByKey = new Map(sets.map((one) => [one.key, one]));

  // Routes may answer from a set of their own; the review step lists every set
  // a live route uses, not only the default one.
  const routeSets = new Set<string>();
  for (const template of templates) {
    if (template.outcomeSetKey) routeSets.add(template.outcomeSetKey);
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
  const stateColor = (state: Shown) => (state === "ON_HOLD" ? "bg-red-50 text-red-800 ring-red-200" : REV_STATE_COLOR[state]);

  // Release reads differently with and without somebody standing between the
  // route and the register; the gate is the control function itself.
  const releaseFixed: Fixed = gate
    ? { title: "Document Control's gate", text: `A finished route waits as Not released until Document Control publishes it — ${holders.length} ${holders.length === 1 ? "person holds" : "people hold"} the control function.` }
    : { title: "No gate", text: "Nobody holds the control function, so a finished route is released at once." };

  const usedBy = new Map<string, string[]>();
  for (const stage of stages) for (const key of stage.sets) usedBy.set(key, [...(usedBy.get(key) ?? []), stage.title]);
  const unplaced = sets.filter((one) => !usedBy.has(one.key));

  const panels = Object.fromEntries(stages.map((stage) => {
    // The check before release is Document Control's gate where there is one,
    // and the release itself says so where there is none.
    const fixed = stage.key === (gate ? "gate" : "release") ? [releaseFixed, ...stage.fixed] : stage.fixed;
    // Not released and Returned to review only exist where there is a gate.
    const states = stage.states.filter((state) => gate || (state !== "NOT_RELEASED" && state !== "RETURNED"));
    const panel = (
        <section key={stage.key} className={cn("register register-sheet register-sheet-open relative", stage.rail)}>
          <span className="absolute inset-y-0 left-0 w-0.75 rounded-l-[0.875rem] bg-(--rail)" aria-hidden />
          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <h2 className="text-sm font-semibold text-slate-900">{stage.title}</h2>
            <span className="text-[11px] text-slate-500">{stage.text}</span>
            {states.length ? (
              <span className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
                {states.map((state) => <StateChip key={state} label={stateLabel(state)} color={stateColor(state)} />)}
                <Link href="/admin/control#state-names" className="text-[11px] font-semibold text-link hover:underline">rename</Link>
              </span>
            ) : null}
          </header>

          <div className="grid grid-cols-1 divide-y divide-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:divide-x lg:divide-y-0">
            {/* Who carries it out, and what the organization chose. */}
            <div className="space-y-3 px-5 py-3.5 sm:px-6">
              <p className="stencil text-slate-500">Who does it</p>
              {stage.acts.length || fixed.length ? (
                <ul className="space-y-2.5">
                  {stage.acts.map((key) => <ActLine key={key} act={key} row={actRow.get(key)} />)}
                  {fixed.map((one) => <FixedLine key={one.title} {...one} />)}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">Whoever is doing the work — nothing here to switch.</p>
              )}

              {stage.policies.map((key) => {
                const row = policyRow.get(key);
                if (!row) return null;
                const option = row.policy.options.find((one) => one.value === row.value);
                return (
                  <div key={key} className="border-t border-line pt-2.5">
                    <p className="text-[11px] text-slate-500">{row.policy.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[13px] font-medium text-slate-900">
                      {option?.label.replace(/ — recommended$/, "")}
                      <span className="text-[11px] font-normal text-slate-400">{row.set ? "chosen" : "default"}</span>
                      <Link href="/admin/control" className="text-[11px] font-semibold text-link hover:underline">change</Link>
                    </p>
                  </div>
                );
              })}

              {stage.branches.length ? (
                <div className="border-t border-line pt-2.5">
                  <p className="stencil mb-1.5 text-slate-500">Off this step</p>
                  <ul className="space-y-2.5">
                    {stage.branches.map((branch) => branch.act
                      ? <ActLine key={branch.title} act={branch.act} row={actRow.get(branch.act)} />
                      : <FixedLine key={branch.title} title={branch.title} text={`${branch.text} ${branch.fixed ?? ""}`.trim()} />)}
                  </ul>
                </div>
              ) : null}
            </div>

            {/* The sets it draws from, and their values. */}
            <div className="space-y-3 px-5 py-3.5 sm:px-6">
              <p className="stencil text-slate-500">Sets it uses</p>
              {stage.sets.length ? (
                <ul className="space-y-3">
                  {stage.sets.map((key) => (
                    <SetLine key={key} setKey={key} set={setByKey.get(key)} values={values.filter((one) => one.setKey === key)} />
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">None — this step reads what the earlier ones set.</p>
              )}
              {stage.extras.length ? (
                <ul className="space-y-1 border-t border-line pt-2.5">
                  {stage.extras.map((key) => (
                    <li key={key} className="flex items-baseline gap-2 text-[13px]">
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

  const sceneOf = (stage: Stage): Scene => {
    const fixedCount = (stage.key === (gate ? "gate" : "release") ? 1 : 0) + stage.fixed.length;
    return {
      key: stage.key,
      title: stage.title,
      tagline: stage.tagline,
      rail: stage.rail,
      carriers: [
        ...[...stage.acts, ...stage.branches.flatMap((b) => (b.act ? [b.act] : []))].map((key) => (actRow.get(key)?.off ? "off" : actRow.get(key)?.controlDoes ? "control" : "work") as Scene["carriers"][number]),
        ...Array.from({ length: fixedCount + stage.branches.filter((b) => !b.act).length }, () => "fixed" as const),
      ],
      states: stage.states,
      sets: stage.sets.length,
    };
  };
  const byKey = new Map(stages.map((stage) => [stage.key, stage]));
  const returner = actRow.get("RETURN_OUTCOME")?.controlDoes ? "Document Control" : "the reviewer";
  const flows: Flow[] = flowsFor({ gate, returner }).map((flow) => ({
    ...flow,
    columns: flow.columns.map((column) => column.map((lane) => ({ scene: { ...sceneOf(byKey.get(lane.scene)!), ...(lane.tagline ? { tagline: lane.tagline } : {}) }, optional: lane.optional, end: lane.end }))),
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Control room"
        subtitle="How a document moves through this project: who does each step, what is switched on, and the sets each step uses. Switch who carries out an act right here; the rest changes on the page it links to."
      />

      {/* Where the project stands, before the steps. */}
      <section className="register register-sheet register-sheet-open">
        <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-5 py-3 sm:px-6">
            <p className="stencil text-slate-500">Control function</p>
            <p className="mt-1 text-[13px] font-medium text-slate-900">{gate ? `${holders.length} ${holders.length === 1 ? "person" : "people"}` : "Nobody"}</p>
            <p className="text-[11px] text-slate-500">{gate ? "Document Control stands between the work and the register." : "The people doing the work run the register."}</p>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <p className="stencil text-slate-500">Who does what</p>
            <p className="mt-1 text-[13px] font-medium text-slate-900">{PROJECT_MODE_LABEL[settings.projectMode]}</p>
            <p className="text-[11px] text-slate-500">{settings.set ? "Set by an administrator." : "Not set yet — read from the project."}</p>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <p className="stencil text-slate-500">Releasing</p>
            <p className="mt-1 text-[13px] font-medium text-slate-900">{together ? `${names.RELEASED_ISSUED} — releasing sends it` : `${names.RELEASED} — releasing means go ahead`}</p>
            <p className="text-[11px] text-slate-500">{policyRow.get("POLICY_RELEASE")?.set ? "Chosen by an administrator." : "The default."}</p>
          </div>
        </div>
      </section>

      <SceneDeck flows={flows} panels={panels} />

      {unplaced.length ? (
        <section className="register register-sheet register-sheet-open">
          <div className="border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <span className="stencil text-slate-500">Other sets</span>
            <span className="ml-2 text-[11px] text-slate-500">published, and not tied to one step</span>
          </div>
          <ul className="space-y-3 px-5 py-3.5 sm:px-6">
            {unplaced.map((one) => (
              <SetLine key={one.key} setKey={one.key} set={one} values={values.filter((value) => value.setKey === one.key)} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** One act the organization decides the carrier of, switchable in place. */
function ActLine({ act, row }: { act: string; row?: { controlDoes: boolean; off: boolean } }) {
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
    />
  );
}

function FixedLine({ title, text }: Fixed) {
  return (
    <li>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[13px] font-medium text-slate-900">{title}</span>
        <Chip className="bg-slate-50 text-slate-500 ring-slate-200"><Lock className="mr-1 h-3 w-3" />Fixed</Chip>
      </p>
      <p className="mt-0.5 text-xs leading-5 text-slate-600">{text}</p>
    </li>
  );
}

/** A set, what it is for, and its values — the switched-off ones struck through. */
function SetLine({ setKey, set, values }: {
  setKey: string;
  set?: { title: string; description: string | null };
  values: { code: string; label: string; status: string }[];
}) {
  const on = values.filter((one) => one.status === "ACTIVE");
  const off = values.filter((one) => one.status !== "ACTIVE");
  const shown = [...on, ...off].slice(0, 14);
  const more = on.length + off.length - shown.length;
  return (
    <li>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <Link href={`/admin/config?set=${setKey}`} className="text-[13px] font-medium text-link hover:underline">{set?.title ?? setKey}</Link>
        <span className="text-[11px] text-slate-500">
          {set ? `${on.length} on${off.length ? ` · ${off.length} off` : ""}` : "not published yet"}
        </span>
      </p>
      {set?.description ? <p className="text-xs leading-5 text-slate-600">{set.description}</p> : null}
      {shown.length ? (
        <p className="mt-1 flex flex-wrap gap-1">
          {shown.map((one) => (
            <code key={one.code} title={one.label} className={cn("code-chip", one.status !== "ACTIVE" && "opacity-50 line-through")}>{one.code}</code>
          ))}
          {more > 0 ? <Link href={`/admin/config?set=${setKey}`} className="self-center text-[11px] text-slate-500 hover:text-link">+{more} more</Link> : null}
        </p>
      ) : null}
    </li>
  );
}
