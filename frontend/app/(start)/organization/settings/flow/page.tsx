import Link from "next/link";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { orgSettings } from "@/lib/settings/api";
import { libertyOrFail } from "@/lib/organization/liberty";
import { projectDefaults } from "@/lib/organization/defaults";
import { setRoomAnswerAction } from "@/lib/settings/forms-how-it-works";
import { controlFrom, CONTROL_ACTIVITIES, effectiveAnswer, POLICIES, SKIPPABLE, CONFIRMABLE, PEOPLE_KEY, PEOPLE_MODE_LABEL, roomItemOf } from "@/lib/settings/control-activities";
import { ESCALATE_AFTER_KEY, DEFAULT_ESCALATE_AFTER } from "@/lib/actions/escalation";
import { DEFAULT_RISK_DAYS } from "@/lib/actions/action-state";
import { stateNames } from "@/lib/core/state-names";
import { stampAnswers, stampSaid } from "@/lib/settings/stamp";
import { fmtDate } from "@/lib/core/utils";
import { organizationSets, organizationSet } from "@/lib/settings/config";
import { SceneDeck, type Flow, type Scene } from "@/app/(app)/settings/flow/scene-deck";
import { STAGES, EXTRA, flowsFor, type Extra } from "@/app/(app)/settings/flow/stages";
import { StepPanel, type Tile } from "@/app/(app)/settings/flow/step-panel";
import { Choice } from "@/app/(app)/settings/flow/choice";
import { RoomSwitches } from "./room-switches";

export const dynamic = "force-dynamic";
export const metadata = { title: "Control room" };

/**
 * The organization's Control room (owner: "the same cards"): the same console as a project's, its flows and steps, set
 * to what every new project starts with (the defaults for new projects, `PROJECT_DEFAULTS`). Each answer is changed on
 * its step, with its switch saying whether projects may change it; what only a project knows (who acts as its control
 * function, its schedule, how its suppliers send) is said, and changed on the project. Copied when a project opens;
 * a project already open keeps its own.
 */

/** Where each page a step reads lives on the organization's side; none: it is each project's own. */
const ORG_EXTRA: Partial<Record<Extra, string>> = {
  numbering: "/organization/settings/numbering",
  revisions: "/organization/settings/revisions",
  fields: "/organization/settings/fields",
  routes: "/organization/settings/routes",
  functions: "/organization/settings/functions",
  parties: "/organization/organizations",
  people: "/organization/people",
  project: "/organization/projects",
  "form:DOCUMENT": "/organization/settings/fields?form=DOCUMENT",
  "form:REVISION": "/organization/settings/fields?form=REVISION",
  "form:REVIEW": "/organization/settings/fields?form=REVIEW",
  "form:TRANSMITTAL": "/organization/settings/fields?form=TRANSMITTAL",
  "form:PACKAGE": "/organization/settings/fields?form=PACKAGE",
  "form:ASSET": "/organization/settings/fields?form=ASSET",
  "form:PARTY": "/organization/settings/fields?form=PARTY",
  "form:PROJECT": "/organization/settings/fields?form=PROJECT",
};

/** The switch an answer of a step belongs to, beyond the answers' own keys. */
const SWITCH_OF: Record<string, string> = { DAYS: "RISK_WINDOW", INTAKE: "SUPPLIER_INTAKE", ESCALATE: ESCALATE_AFTER_KEY };

export default async function OrganizationControlRoomPage() {
  const scope = await requireOrgAdmin();
  const [defaults, switches, organization, names] = await Promise.all([
    projectDefaults({ orFail: true }),
    libertyOrFail(),
    orgSettings().catch(() => new Map<string, string>()),
    stateNames(),
  ]);
  const sets = await organizationSets().catch(() => []);
  const setTitle = new Map(sets.map((one) => [one.key, one.title]));
  const wanted = [...new Set(STAGES.flatMap((stage) => stage.sets ?? []))].filter((key) => setTitle.has(key));
  const inUse = new Map(await Promise.all(wanted.map(async (key) => [key, (await organizationSet(key)).filter((v) => v.status === "ACTIVE").length] as const)));
  const answers = new Map(Object.entries(defaults?.values ?? {}));
  // Read as for a project with a control function, the usual case (a project is taken to have one).
  const reading = controlFrom(answers, true);
  const actRow = new Map(reading.rows.map((row) => [row.activity.key, row]));
  const together = effectiveAnswer("POLICY_RELEASE", answers.get("POLICY_RELEASE")) === "TOGETHER";
  const confirmJoin = effectiveAnswer(`CONFIRM:${PEOPLE_KEY}`, answers.get(`CONFIRM:${PEOPLE_KEY}`)) === "ON";
  const room = switches.filter((one) => one.area === "Control room");
  const switchOf = (key: string) => room.find((one) => one.key === (SWITCH_OF[key] ?? roomItemOf(key) ?? key));
  const clean = (label: string) => label.replace(/ — recommended$/, "").replace(/ \(recommended\)$/, "");
  const hidden = (key: string) => ({ key, target: "defaults" });

  /** A plain line of what stands, with where it is changed. */
  const fact = (key: string, title: string, value: string, href?: string) => (
    <li key={key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
      <span className="text-[13px] font-medium text-slate-900">{title}</span>
      <span className="text-[13px] text-slate-700">
        {value}
        {href ? <> · <Link href={href} className="font-semibold text-link hover:underline">change</Link></> : null}
      </span>
    </li>
  );

  /** One answer every new project starts with, changed right where it is read. */
  const answer = (key: string): React.ReactNode => {
    if (key === "ROUTE_VERDICTS") return fact(key, "Which verdicts each route decides with", "Set on each route", "/organization/settings/routes");
    if (key === "TRACKING") {
      return [
        fact("track-acts", "What people do to documents", "Always kept"),
        fact("track-reading", "Opening a document, downloading a file", organization.get("TRACK_READING") === "OFF" ? "Not kept" : "Kept", "/organization/settings/tracking"),
        fact("track-signins", "Sign-ins, on a person's activity", organization.get("TRACK_SIGN_INS") === "ON" ? "Shown" : "Kept for security, not shown", "/organization/settings/tracking"),
      ];
    }
    if (key === "INTAKE") return fact(key, "How other organizations' documents come in", "By placeholder; a project may be made an exception on its own Control room");
    if (key === "CONTROL_PEOPLE") return fact(key, "Who acts as the control function", "Named on each project");
    if (key.startsWith("STATE:")) {
      const code = key.slice(6) === "RELEASED" && together ? "RELEASED_ISSUED" : key.slice(6);
      return fact(key, "This state is called", names[code as keyof typeof names] ?? code, "/organization/settings/states");
    }
    if (key === "THE_STAMP") return fact(key, "The stamp on the PDF", stampSaid(stampAnswers(organization)), "/organization/settings/stamp");
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
      return <Choice key={key} title={act.title} options={options} value={value} action={setRoomAnswerAction} hidden={hidden(key)} />;
    }
    if (key.startsWith("CONFIRM:")) {
      const of = key.slice(8);
      const options = [
        { value: "ON", label: "Yes", text: CONFIRMABLE[of] ?? "" },
        { value: "OFF", label: "No", text: of === PEOPLE_KEY ? "Nobody confirms: they are on the project at once." : "Nobody confirms: the control function applies it." },
      ];
      return <Choice key={key} title="Confirmed by whoever holds Manage" options={options} value={effectiveAnswer(key, answers.get(key))} action={setRoomAnswerAction} hidden={hidden(key)} />;
    }
    if (key === "DAYS") {
      return [
        fact("lead", "A document is needed before the action's day", "Set with each project's schedule"),
        fact("risk", "The action is at risk from", `${DEFAULT_RISK_DAYS} days before, unless a project changes it where free`),
      ];
    }
    if (key === "ESCALATE") {
      return <Choice key={key} title="A discipline still silent after the day is told again, with whoever holds Manage and the control function, after"
        value={answers.get(ESCALATE_AFTER_KEY) ?? String(DEFAULT_ESCALATE_AFTER)} unit="working days" min={1} max={60}
        action={setRoomAnswerAction} hidden={hidden(ESCALATE_AFTER_KEY)} />;
    }
    const policy = POLICIES.find((one) => one.key === key);
    if (!policy) return null;
    const options = policy.options.map((one) => ({ value: one.value, label: clean(one.label), text: one.text }));
    return <Choice key={key} title={policy.title} options={options} value={effectiveAnswer(key, answers.get(key))} action={setRoomAnswerAction} hidden={hidden(key)} />;
  };

  const panels = Object.fromEntries(STAGES.map((stage) => {
    const tiles: Tile[] = [
      ...(stage.sets ?? []).map((key) => ({
        title: setTitle.get(key) ?? key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, " "),
        figure: setTitle.has(key) ? `${inUse.get(key) ?? 0} value${inUse.get(key) === 1 ? "" : "s"} in use` : "not set up yet",
        href: `/organization/settings/types?set=${key}`,
        warn: !setTitle.has(key) || !inUse.get(key),
        opens: true,
      })),
      ...(stage.extras ?? []).map((key) => ({
        title: EXTRA[key].title,
        figure: ORG_EXTRA[key] ? "the organization's" : "on each project",
        href: ORG_EXTRA[key] ?? EXTRA[key].href,
        warn: false,
        opens: !!ORG_EXTRA[key],
      })),
    ];
    const acts = stage.who.filter((one): one is string => typeof one === "string");
    const keys = [...acts, ...(stage.answers ?? [])];
    const covered = [...new Map(keys.map(switchOf).filter((one) => !!one).map((one) => [one!.key, one!])).values()];
    return [stage.key, (
      <StepPanel key={stage.key} stage={stage} warn={false} acts={acts.map(answer)} answers={(stage.answers ?? []).flatMap((key) => answer(key))}
        tiles={tiles} below={<RoomSwitches items={covered} />} />
    )];
  }));

  const byKey = new Map(STAGES.map((stage) => [stage.key, stage]));
  const returner = actRow.get("RETURN_OUTCOME")?.controlDoes ? "The control function" : "The reviewer";
  const flows: Flow[] = flowsFor({ gate: true, returner, together, unreviewed: false, asCome: false, confirmJoin, role: "GENERIC" }).map((flow) => ({
    ...flow,
    columns: flow.columns.map((column) => column.map((lane) => {
      const stage = byKey.get(lane.scene)!;
      const scene: Scene = { key: stage.key, title: stage.title, tagline: lane.tagline ?? stage.tagline, rail: stage.rail };
      return { scene, when: lane.when, end: lane.end };
    })),
  }));
  const source = defaults
    ? defaults.fromProject ? `Taken from ${defaults.fromProject}${defaults.edited ? ", then changed here" : ""}` : "Set here"
    : "The app's own";

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="px-5 pt-6 pb-4 sm:px-6">
          <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">
            <Link href="/organization/settings" className="hover:underline">{scope.organization.name} · Settings</Link>
          </p>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="plate-title mt-1 text-slate-950">Control room</h1>
            <span className="flex flex-wrap gap-2">
              <Link href="/organization/defaults" className="ask">Defaults for new projects</Link>
              <Link href="/organization/settings/may-change" className="ask">What projects may change</Link>
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            How a new project of ours works, step by step: what each starts with. Choose a flow, then a step: its answers are changed
            right there, with whether projects may change them. A project already open keeps its own; another organization&rsquo;s
            project follows its owner.
          </p>
        </div>
        <dl className="grid grid-cols-1 divide-y divide-line border-t border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Where they come from</dt>
            <dd className="mt-1 text-[13px] font-medium text-slate-900">{source}</dd>
            <dd className="text-[11px] text-slate-500">{defaults ? `last changed ${fmtDate(defaults.at)} by ${defaults.by}` : "nothing changed by the organization yet"}</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Projects may change</dt>
            <dd className="mt-1 text-[13px] font-medium text-slate-900">{room.filter((one) => one.free).length} of {room.length} answers</dd>
            <dd className="text-[11px] text-slate-500">the rest stay as set here</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Drawn for</dt>
            <dd className="mt-1 text-[13px] font-medium text-slate-900">Any role</dd>
            <dd className="text-[11px] text-slate-500">each project draws it for our role there</dd>
          </div>
        </dl>
      </section>

      <SceneDeck flows={flows} panels={panels} />

    </div>
  );
}
