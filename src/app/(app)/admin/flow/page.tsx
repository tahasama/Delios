import Link from "next/link";
import { Lock } from "lucide-react";
import { SETUP_PAGES, maySetup } from "../setup-pages";
import { requireScope } from "@/lib/scope";
import { PageHeader, Chip, StateChip } from "@/components/ui";
import { controlSettings, policies, PROJECT_MODE_LABEL, CONTROL_ACTIVITIES, SKIPPABLE } from "@/lib/control-activities";
import { holdersOf } from "@/lib/permissions";
import { REV_STATE_COLOR, type RevState } from "@/lib/standard";
import { stateNames, stateName } from "@/lib/state-names";
import { SceneDeck, type Scene } from "./scene-deck";
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

type Stage = {
  key: string;
  title: string;
  /** A few words for the scene card. */
  tagline: string;
  text: string;
  rail: string;
  /** The states a revision is in, or leaves in, at this step. */
  states: RevState[];
  /** Acts the organization decides the carrier of. */
  acts: string[];
  policies: string[];
  sets: string[];
  fixed: Fixed[];
  /** Roads off the main line, with their act where they have one. */
  branches: { title: string; text: string; act?: string; fixed?: string }[];
  /** Other configuration the step reads, with where it is kept. */
  extras: ("numbering" | "routes" | "distribution")[];
};

const STAGES: Stage[] = [
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
    fixed: [],
    branches: [{ title: "Allowing a new revision nobody asked for", text: "No review sent it back, and somebody wants one anyway.", act: "AUTHORIZE_REVISION" }],
    extras: [],
  },
  {
    key: "review",
    tagline: "Down its route",
    title: "Review",
    text: "The route the document matches sends it to its reviewers; each answers with a verdict or advice.",
    rail: "rail-review",
    states: ["IN_REVIEW"],
    acts: ["REVIEW_ISSUE"],
    policies: [],
    sets: ["REVIEW_OUTCOMES", "REVIEW_ADVICE", "COMMENT_CLASSES"],
    fixed: [],
    branches: [{ title: "Handing a review to somebody else", text: "A reviewer who cannot answer in time passes the step on.", act: "DELEGATE" }],
    extras: ["routes"],
  },
  {
    key: "answer",
    tagline: "The verdict reaches the author",
    title: "Answer returned",
    text: "The verdict reaches the author. Accepted goes on to release; sent back means a new revision.",
    rail: "rail-review",
    states: [],
    acts: ["RETURN_OUTCOME"],
    policies: ["POLICY_PDF_STAMP"],
    sets: ["RETURN_REASONS"],
    fixed: [],
    branches: [],
    extras: [],
  },
  {
    key: "release",
    tagline: "In force",
    title: "Release",
    text: "The revision comes into force in the register, and the one before it is superseded.",
    rail: "rail-released",
    states: ["NOT_RELEASED", "RETURNED", "RELEASED", "SUPERSEDED"],
    acts: [],
    policies: ["POLICY_RELEASE"],
    sets: [],
    fixed: [],
    branches: [
      { title: "On hold", text: "An outside answer that arrives late puts the revision on hold, marked not for use, until Document Control lifts it or sends it back.", fixed: "Always on: a revision nobody should use is never left reading as in force." },
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
    fixed: [],
    branches: [{ title: "An action going ahead without its documents", text: "The day passes and something it needed is missing; the note says who decided and who owns the delay.", act: "ACTION_NOTE" }],
    extras: ["distribution"],
  },
  {
    key: "receive",
    tagline: "Taken in from outside",
    title: "Receive",
    text: "What arrives from outside is recorded, checked, and accepted or rejected.",
    rail: "rail-superseded",
    states: [],
    acts: [],
    policies: [],
    sets: ["SUPPLIER_CODES", "PURCHASE_ORDERS", "PRESERVATION_FORMATS"],
    fixed: [{ title: "Accepting what arrived", text: "The recipient's act, checked against the acceptance conditions." }],
    branches: [],
    extras: [],
  },
];

const EXTRA: Record<Stage["extras"][number], { title: string; href: string }> = {
  numbering: { title: "Numbering schemes", href: "/admin/numbering" },
  routes: { title: "Review routes", href: "/admin/workflow-templates" },
  distribution: { title: "Distribution rules", href: "/admin/controlled" },
};

export default async function ControlRoomPage() {
  const ctx = await requireScope();
  const { user: me, db } = ctx;
  const page = SETUP_PAGES.find((one) => one.href === "/admin/flow")!;
  if (!maySetup(me, page)) return <PageHeader title="Control room" subtitle="Administrators only." />;

  const [settings, chosen, holders, sets, values, templates, schemes, rules, names] = await Promise.all([
    controlSettings(ctx),
    policies(ctx),
    holdersOf(ctx, "CONTROL"),
    db.configSet.findMany({ select: { key: true, title: true, description: true } }),
    db.configValue.findMany({ select: { setKey: true, code: true, label: true, status: true }, orderBy: [{ sort: "asc" }, { code: "asc" }] }),
    db.workflowTemplate.findMany({ where: { active: true }, select: { name: true, steps: true, outcomeSetKey: true } }),
    db.scheme.count({ where: { active: true } }),
    db.distributionRule.count(),
    stateNames(ctx),
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
  };

  const stateLabel = (state: RevState) =>
    state === "RELEASED" ? (together ? names.RELEASED_ISSUED : `${names.RELEASED}, then ${names.ISSUED.toLowerCase()}`) : stateName(names, state);

  // Release reads differently with and without somebody standing between the
  // route and the register; the gate is the control function itself.
  const releaseFixed: Fixed = gate
    ? { title: "Document Control's gate", text: `A finished route waits as Not released until Document Control publishes it — ${holders.length} ${holders.length === 1 ? "person holds" : "people hold"} the control function.` }
    : { title: "No gate", text: "Nobody holds the control function, so a finished route is released at once." };

  const usedBy = new Map<string, string[]>();
  for (const stage of stages) for (const key of stage.sets) usedBy.set(key, [...(usedBy.get(key) ?? []), stage.title]);
  const unplaced = sets.filter((one) => !usedBy.has(one.key));

  const panels = stages.map((stage, i) => {
    const fixed = stage.key === "release" ? [releaseFixed, ...stage.fixed] : stage.fixed;
    // Not released and Returned to review only exist where there is a gate.
    const states = stage.states.filter((state) => gate || (state !== "NOT_RELEASED" && state !== "RETURNED"));
    return (
        <section key={stage.key} className={cn("register register-sheet register-sheet-open relative", stage.rail)}>
          <span className="absolute inset-y-0 left-0 w-0.75 rounded-l-[0.875rem] bg-(--rail)" aria-hidden />
          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <span className="font-mono text-[11px] text-slate-400">Scene {String(i + 1).padStart(2, "0")}</span>
            <h2 className="text-sm font-semibold text-slate-900">{stage.title}</h2>
            <span className="text-[11px] text-slate-500">{stage.text}</span>
            {states.length ? (
              <span className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
                {states.map((state) => <StateChip key={state} label={stateLabel(state)} color={REV_STATE_COLOR[state]} />)}
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
  });

  const scenes: Scene[] = stages.map((stage) => {
    const fixedCount = (stage.key === "release" ? 1 : 0) + stage.fixed.length;
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
  });

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
            <p className="mt-1 text-[13px] font-medium text-slate-900">{together ? `${names.RELEASED_ISSUED}, one act` : `${names.RELEASED}, then ${names.ISSUED.toLowerCase()}`}</p>
            <p className="text-[11px] text-slate-500">{policyRow.get("POLICY_RELEASE")?.set ? "Chosen by an administrator." : "The default."}</p>
          </div>
        </div>
      </section>

      <SceneDeck scenes={scenes} panels={panels} />

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
