import Link from "next/link";
import { SETUP_PAGES, maySetup } from "../setup-pages";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath } from "@/lib/client";
import { projectSettings } from "@/lib/settings/api";
import { controlSettings, CONTROL_ACTIVITIES, effectiveAnswer, POLICIES } from "@/lib/settings/control-activities";
import { policySaid } from "@/components/how-it-works";
import { holdersOf } from "@/lib/core/permissions";
import { scheduleSource } from "@/lib/actions/api";
import { DEFAULT_LEAD_DAYS } from "@/lib/actions/schedule";
import { DEFAULT_RISK_DAYS } from "@/lib/actions/action-state";
import { ESCALATE_AFTER_KEY, DEFAULT_ESCALATE_AFTER } from "@/lib/actions/escalation";
import { SceneDeck, type Flow, type Scene, type StepRow } from "./scene-deck";
import { cn } from "@/lib/core/utils";
import { adminFunctions, projectNumbering, partiesWithAnswers, routesForEditor } from "@/lib/settings/api-admin";
import { getSet, getSets } from "@/lib/settings/config";
import { NoAccess } from "../no-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Control room" };

/**
 * The Control room: where everything about how the project works is found, not changed. The flows a document, a
 * package, an action and a person go through, each step saying who does it and what it reads, with a link to where
 * each is kept; then everything that makes the project work, with its answer today and its link. Every answer is
 * changed on its own card (How this project works, Numbering, Review routes…).
 */

/** Who does something on a step: an act the project decides the carrier of (its key), or one that never changes. */
type Who = string | { title: string; by: string };

type Extra = "numbering" | "revisions" | "fields" | "routes" | "distribution" | "parties" | "packages" | "schedule" | "people" | "functions";

type Stage = {
  key: string;
  title: string;
  /** A few words for the step's card. */
  tagline: string;
  /** One sentence: what happens at this step. */
  text: string;
  rail: string;
  who: Who[];
  /** What the project chose that this step reads: a question's key, or DAYS, ESCALATE, CONFIRM:<act>. */
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
    sets: ["SUBPROJECTS", "DISCIPLINES", "DOCUMENT_TYPES", "DELIVERABLE_TYPES", "PHASES", "CRITICALITY", "CONFIDENTIALITY", "RETENTION_CLASSES"],
    extras: ["numbering", "fields"],
  },
  {
    key: "prepare", title: "Prepare", tagline: "Written by its author", rail: "rail-prep",
    text: "The author writes the revision and attaches its files.",
    who: [{ title: "Writing the revision", by: "Its author" }, "AUTHORIZE_REVISION"],
    sets: ["STATUSES", "NATIVE_FORMATS", "RENDITION_FORMATS"],
    extras: ["revisions"],
  },
  {
    key: "review", title: "Review", tagline: "Down its route", rail: "rail-review",
    text: "The route the document matches sends it to its reviewers, and each answers with a verdict or advice.",
    who: ["REVIEW_ISSUE", { title: "Answering", by: "The people on each step of the route" }, "DELEGATE"],
    answers: ["POLICY_MATRIX", "POLICY_MATRIX_DETAIL"],
    sets: ["REVIEW_OUTCOMES", "REVIEW_ADVICE", "COMMENT_CLASSES"],
    extras: ["routes", "distribution"],
  },
  {
    key: "accepted", title: "Accepted", tagline: "The verdict lets it go on", rail: "rail-accepted",
    text: "The verdict accepts it, as it stands or with comments for the next revision.",
    who: [{ title: "Deciding", by: "The step of the route that decides" }],
    sets: ["REVIEW_OUTCOMES"],
  },
  {
    key: "returned", title: "Returned", tagline: "Back to the author", rail: "rail-rejected",
    text: "The verdict refuses it: it goes back to the author with the comments, and this revision ends.",
    who: ["RETURN_OUTCOME"],
    sets: ["REVIEW_OUTCOMES", "COMMENT_CLASSES"],
  },
  {
    key: "to-sender", title: "Returned to the sender", tagline: "For correction", rail: "rail-returned",
    text: "The verdict refuses it: it goes back to whoever sent it, for correction. Their next one starts again.",
    who: ["RETURN_OUTCOME"],
    sets: ["REVIEW_OUTCOMES", "COMMENT_CLASSES"],
    extras: ["parties"],
  },
  {
    key: "gate", title: "The control function's check", tagline: "Before it is published", rail: "rail-check",
    text: "Decided, it waits until the control function publishes it at the status the review settled on.",
    who: [{ title: "Publishing it", by: "The control function" }],
    sets: ["STATUSES"],
  },
  {
    key: "gate-return", title: "Sent back", tagline: "Wrong for the record", rail: "rail-returned",
    text: "The control function refuses to publish it and sends it back with a reason. This revision ends.",
    who: [{ title: "Sending it back", by: "The control function" }],
    sets: ["RETURN_REASONS"],
  },
  {
    key: "approval", title: "Approved outside", tagline: "An outside party approves", rail: "rail-accepted",
    text: "Somebody outside approves it before it is released, when an approval was asked for.",
    who: [{ title: "Approving", by: "The outside party named when it was asked" }],
    extras: ["parties"],
  },
  {
    key: "approval-refused", title: "Not approved", tagline: "Back to the author", rail: "rail-rejected",
    text: "The outside party refuses it: it goes back to the author with a reason. This revision ends.",
    who: [{ title: "Sending it back", by: "Whoever asked for the approval" }],
  },
  {
    key: "release", title: "Release", tagline: "In force", rail: "rail-released",
    text: "The revision comes into force, and the one before it is superseded.",
    who: [{ title: "Releasing", by: "The decider, or the control function where it checks first" }, "VOID"],
    answers: ["POLICY_RELEASE", "POLICY_PDF_STAMP"],
  },
  {
    key: "released-issued", title: "Released & issued", tagline: "In force, and sent", rail: "rail-released",
    text: "In one act it comes into force and goes to the people named by whoever decided or asked.",
    who: ["ISSUE", "VOID", "ACTION_NOTE"],
    answers: ["POLICY_RELEASE", "POLICY_PDF_STAMP", "POLICY_READY"],
    sets: ["REASONS_FOR_ISSUE", "ISSUE_CODES"],
    extras: ["distribution"],
  },
  {
    key: "issue", title: "Issue", tagline: "Sent out", rail: "rail-issue",
    text: "The released revision is sent out on a transmittal.",
    who: ["ISSUE", "ACTION_NOTE"],
    answers: ["POLICY_READY"],
    sets: ["REASONS_FOR_ISSUE", "ISSUE_CODES"],
    extras: ["distribution"],
  },
  {
    key: "received", title: "Received", tagline: "Arrives on a transmittal", rail: "rail-received",
    text: "What another organization sends is recorded on the transmittal it came on.",
    who: [{ title: "Recording what arrived", by: "Whoever receives it" }],
    sets: ["SUPPLIER_CODES", "PURCHASE_ORDERS", "REASONS_FOR_ISSUE"],
    extras: ["parties"],
  },
  {
    key: "theirs", title: "Registered", tagline: "Put in our register", rail: "rail-none",
    text: "It becomes a document of the register, under the sender's code and the order it answers.",
    who: [{ title: "Registering it", by: "Whoever recorded it" }],
    sets: ["SUPPLIER_CODES", "PURCHASE_ORDERS", "DISCIPLINES", "DOCUMENT_TYPES", "DELIVERABLE_TYPES"],
    extras: ["numbering"],
  },
  {
    key: "asked", title: "Asked of the supplier", tagline: "Asked on a transmittal", rail: "rail-sent",
    text: "A placeholder from the supplier's package goes to them, due on its planned day. They hold it until they send it.",
    who: [{ title: "Asking for it", by: "The control function, from the supplier's package" }],
    sets: ["SUPPLIER_CODES", "PURCHASE_ORDERS"],
    extras: ["packages", "parties"],
  },
  {
    key: "checked", title: "The control function's check", tagline: "Accepted, or back to them", rail: "rail-check",
    text: "What the supplier sent counts only once it is checked: accepted, we hold it; returned, they correct it.",
    who: [{ title: "Checking it", by: "The control function" }],
  },
  {
    key: "handed-back", title: "Back with the supplier", tagline: "Theirs again, to update", rail: "rail-rejected",
    text: "Rejected, or released with comments: it goes back to the supplier for the next revision.",
    who: [{ title: "Taking the comments in", by: "The supplier" }],
  },

  // ── Packages we deliver ─────────────────────────────────────────────────────
  {
    key: "pkg-made", title: "Put together", tagline: "Its documents gathered", rail: "rail-prep",
    text: "The package is opened with the statuses it is needed at, and its documents are added.",
    who: [{ title: "Adding and taking out documents", by: "Those putting it together" }, { title: "Everything else on it", by: "The control function" }],
    extras: ["packages"],
  },
  {
    key: "pkg-checked", title: "Checked", tagline: "Ready or not, each one", rail: "rail-check",
    text: "Each document is read against the status it is needed at; what is not ready is the shortfall.",
    who: [{ title: "Checking it", by: "The control function" }],
    sets: ["STATUSES"],
  },
  {
    key: "pkg-short", title: "Going without", tagline: "What is missing is asked", rail: "rail-shortfall",
    text: "Whoever accepts the package is asked whether it may go without what is missing; agreeing delivers it at once.",
    who: [{ title: "Asking", by: "The control function, on a transmittal" }, { title: "Agreeing", by: "Whoever accepts the package" }],
  },
  {
    key: "pkg-delivered", title: "Delivered", tagline: "Sent, then fixed", rail: "rail-delivered",
    text: "One transmittal per organization carries its documents; what the package holds is then fixed.",
    who: [{ title: "Delivering it", by: "The control function" }],
    sets: ["REASONS_FOR_ISSUE"],
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
  },
  {
    key: "act-postponed", title: "Postponed", tagline: "Will not go ahead", rail: "rail-withdrawn",
    text: "Recorded with who decided and why; whoever plans confirms it, and a new schedule revision follows.",
    who: [{ title: "Recording it", by: "Anyone concerned" }, { title: "Confirming it", by: "Whoever plans" }],
  },

  // ── Someone joins the project ───────────────────────────────────────────────
  {
    key: "join-asked", title: "Asked or added", tagline: "Someone new, or with an account", rail: "rail-people",
    text: "Anyone of ours asks for someone new; someone with an account is added. Either way with a function and a department.",
    who: [{ title: "Asking for someone", by: "Anyone of ours on the project" }, "PROJECT_PEOPLE"],
    extras: ["people"],
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
    extras: ["people", "functions"],
  },
];

/**
 * The flows, from the organization's own side. A fork carries one lane on and hangs the one that ends below it; who
 * returns a refused revision follows the project, and without a control function there is no check before release.
 */
type FlowLane = { scene: string; optional?: string; tagline?: string; end?: boolean };
function flowsFor({ gate, returner, together }: { gate: boolean; returner: string; together: boolean }): { key: string; title: string; from: string; to: string; columns: FlowLane[][] }[] {
  // Released and issued are one act unless the project keeps them apart (POLICY_RELEASE): one step, or two.
  const out: FlowLane[][] = together ? [[{ scene: "released-issued" }]] : [[{ scene: "release" }], [{ scene: "issue" }]];
  return [
    {
      key: "produce", title: "Documents we produce", from: "We write it", to: "in force, and sent to whoever needs it",
      columns: [
        [{ scene: "register" }],
        [{ scene: "prepare" }],
        [{ scene: "review", tagline: "Our reviewers, and others when the route names them" }],
        [{ scene: "accepted" }, { scene: "returned", end: true, tagline: `${returner} returns it` }],
        ...(gate ? [[{ scene: "gate" }, { scene: "gate-return", end: true }]] : []),
        [{ scene: "approval", optional: "an outside approval is asked for" }, { scene: "approval-refused", end: true, optional: "an outside approval is asked for" }],
        ...out,
      ],
    },
    {
      key: "receive", title: "Documents we receive", from: "Another organization sends it", to: "accepted here and passed on, or back to them",
      columns: [
        [{ scene: "received" }],
        [{ scene: "theirs" }],
        [{ scene: "review", tagline: "By us, by them, or both" }],
        [{ scene: "accepted" }, { scene: "to-sender", end: true }],
        ...out,
      ],
    },
    {
      key: "supplier", title: "Documents a supplier owes us", from: "We ask the supplier for it", to: "in force with us, or back with them for the next revision",
      columns: [
        [{ scene: "asked" }],
        [{ scene: "received", tagline: "They send it, on a transmittal" }],
        [{ scene: "checked" }],
        [{ scene: "review", tagline: "By us, by them, or both" }],
        [{ scene: "accepted", tagline: "We hold it" }, { scene: "handed-back", end: true }],
        ...out,
      ],
    },
    {
      key: "deliver", title: "Packages we deliver", from: "We gather what someone needs", to: "delivered, and accepted by them",
      columns: [
        [{ scene: "pkg-made" }],
        [{ scene: "pkg-checked" }],
        [{ scene: "pkg-short", optional: "something is missing" }],
        [{ scene: "pkg-delivered" }],
        [{ scene: "pkg-accepted" }],
      ],
    },
    {
      key: "action", title: "An action on the schedule", from: "The schedule needs documents", to: "the action goes ahead, or is postponed",
      columns: [
        [{ scene: "act-needs" }],
        [{ scene: "act-risk", optional: "a document is still missing" }],
        [{ scene: "act-confirm" }],
        [{ scene: "act-ahead" }, { scene: "act-postponed", end: true }],
      ],
    },
    {
      key: "join", title: "Someone joins the project", from: "Someone is needed on the project", to: "on it, and told",
      columns: [
        [{ scene: "join-asked" }],
        [{ scene: "join-confirmed", optional: "confirmation is asked" }, { scene: "join-refused", end: true, optional: "confirmation is asked" }],
        [{ scene: "join-on" }],
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

  const [settings, holders, sets, values, templates, schemes, functions, parties, answers, schedule, directory] = await Promise.all([
    controlSettings(ctx),
    holdersOf(ctx, "CONTROL"),
    getSets().then((all) => all.map((one) => ({ key: one.key, title: one.title }))),
    // Every value of every list, to count what is in use.
    getSets().then(async (all) => (await Promise.all(all.map(async (one) => (await getSet(one.key)).map((v) => ({ setKey: one.key, status: v.status }))))).flat()),
    // What only the keepers of Settings may read comes back empty for others: unknown, never counted as none.
    routesForEditor().catch(() => null),
    projectNumbering().then((n) => n.schemes.filter((one) => one.active).length).catch(() => 0),
    adminFunctions().catch(() => null),
    partiesWithAnswers().then((all) => all.filter((one) => one.active)).catch(() => null),
    projectSettings(ctx.projectId).catch(() => new Map<string, string>()),
    scheduleSource(ctx),
    api<{ people: unknown[] }>(projectPath(ctx, "/people/directory")).catch(() => null),
  ]);

  const gate = holders.length > 0;
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

  /** One line of what the project chose: what it is, the answer today, where it is changed. */
  const said = (key: string): { title: string; answer: string; href: string } => {
    const act = CONTROL_ACTIVITIES.find((one) => one.key === key);
    if (act) {
      const row = actRow.get(key);
      return { title: act.title, answer: row?.off ? "Left out" : row?.controlDoes ? "The control function" : "The people doing the work", href: `${HOW}#who-does-what` };
    }
    if (key.startsWith("CONFIRM:")) {
      return { title: "Confirmed by whoever holds Manage", answer: effectiveAnswer(key, answers.get(key)) === "ON" ? "Yes" : "No", href: `${HOW}#who-does-what` };
    }
    if (key === "DAYS") return { title: "Documents needed / at risk from", answer: `${lead} days / ${risk} days before`, href: `${HOW}#action-days` };
    if (key === "ESCALATE") return { title: "A silent discipline is escalated", answer: `after ${escalate} working days`, href: `${HOW}#policies` };
    const policy = POLICIES.find((one) => one.key === key);
    return { title: policy?.title ?? key, answer: policySaid(answers, key), href: `${HOW}#policies` };
  };

  const extraCount: Record<Extra, string> = {
    numbering: plural(schemes, "scheme"),
    revisions: "",
    fields: "",
    routes: templates ? plural(templates.length, "route") : "",
    distribution: receives === null ? "" : receives ? plural(receives, "rule") : "none yet",
    parties: parties ? plural(parties.length, "organization") : "",
    packages: "",
    schedule: schedule.source ? "" : "no schedule named yet",
    people: directory ? `${directory.people.length} people` : "",
    functions: functions ? plural(functions.length, "function") : "",
  };


  // Each step as its row of the flow's table: who does what there (an answer linking to where it is changed), and
  // where it is set up.
  const rows: Record<string, StepRow> = Object.fromEntries(stages.map((stage) => [stage.key, {
    who: [
      ...stage.who.map((one) => {
        const line = typeof one === "string" ? said(one) : { title: one.title, answer: one.by, href: null as string | null };
        return { ...line, href: line.href && opens(line.href) ? line.href : null };
      }),
      ...(stage.answers ?? []).map(said).map((line) => ({ ...line, href: opens(line.href) ? line.href : null })),
    ],
    links: [
      ...(stage.sets ?? []).map((key) => ({
        title: setTitle.get(key) ?? key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, " "),
        figure: setTitle.has(key) ? String(inUse(key)) : "not set up yet",
        href: `/settings/config?set=${key}`,
        warn: !setTitle.has(key) || !inUse(key),
      })),
      ...(stage.extras ?? []).map((key) => ({ title: EXTRA[key].title, figure: extraCount[key], href: EXTRA[key].href, warn: false })),
    ].filter((one) => opens(one.href)),
  }]));

  const byKey = new Map(stages.map((stage) => [stage.key, stage]));
  const returner = actRow.get("RETURN_OUTCOME")?.controlDoes ? "The control function" : "The reviewer";
  const flows: Flow[] = flowsFor({ gate, returner, together }).map((flow) => ({
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
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              How {ctx.project.code} works, all in one place. Choose a flow and a step to see who does it and where it is set up; every
              answer opens where it is changed.
            </p>
          </div>
          {opens(HOW) ? <Link href={HOW} className="ask shrink-0 self-start">How this project works</Link> : null}
        </div>
      </section>

      <SceneDeck flows={flows} rows={rows} />

    </div>
  );
}
