import Link from "next/link";
import { SETUP_PAGES, maySetup, mayChangeControlRoom } from "../setup-pages";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath } from "@/lib/client";
import { projectSettings, orgSettings } from "@/lib/settings/api";
import { optOutsOf } from "@/lib/conformance/api";
import { isAdmin } from "@/lib/core/auth";
import { controlSettings, CONTROL_ACTIVITIES, effectiveAnswer, POLICIES, SKIPPABLE, CONFIRMABLE, PEOPLE_KEY, PEOPLE_MODE_LABEL, roomItemOf } from "@/lib/settings/control-activities";
import { stateNames } from "@/lib/core/state-names";
import { holdersOf } from "@/lib/core/permissions";
import { scheduleSource } from "@/lib/actions/api";
import { DEFAULT_LEAD_DAYS } from "@/lib/actions/schedule";
import { DEFAULT_RISK_DAYS } from "@/lib/actions/action-state";
import { ESCALATE_AFTER_KEY, DEFAULT_ESCALATE_AFTER } from "@/lib/actions/escalation";
import { SceneDeck, type Flow, type Scene } from "./scene-deck";
import { STAGES, EXTRA, flowsFor, type Extra } from "./stages";
import { StepPanel } from "./step-panel";
import { IntakeChoice } from "./intake-choice";
import { projectIntake } from "@/lib/packages/api";
import { Choice } from "./choice";
import { FollowOrganizationDays } from "./follow-days";
import { projectLiberty } from "@/lib/organization/liberty";
import { setRoomAnswerAction, setScheduleDaysAction } from "@/lib/settings/forms-how-it-works";
import { setRouteVerdictsAction } from "@/lib/reviews/forms";
import { adminFunctions, projectNumbering, partiesWithAnswers, routesForEditor } from "@/lib/settings/api-admin";
import { getSet, getSets } from "@/lib/settings/config";
import { NoAccess } from "../no-access";
import { ControlPeople, BackToDefaults } from "./project-wide";
import { projectDefaults } from "@/lib/organization/defaults";
import { contractRoleOptions } from "@/lib/settings/contract-roles";
import { roleLabel } from "@/lib/settings/profiles/roles";
import { stampAnswers, stampSaid } from "@/lib/settings/stamp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Control room" };

/**
 * The Control room: how the project works, step by step, and where it is changed. The flows a document, a package,
 * an action and a person go through on a band; the chosen step's panel under it says what happens, who does it and
 * how it works here (each answer changed right there, asked first), and opens the lists and pages it reads. Every
 * answer is also read as written sentences in the plan (Assurance).
 */

/** Where every answer of how the project works is changed. */
/** Where the project's acts and answers are read as written sentences, for everyone of ours. */
const PLAN = "/conformance/plan";

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
    api<{
      people: { id: string; name: string; partyId: string | null; function: string; control: boolean; actsAsControl: boolean }[];
      organizations: { id: string; kind: string }[];
      mayNameControl: boolean;
    }>(projectPath(ctx, "/people/directory")).catch(() => null),
    projectLiberty(ctx.projectId),
    api<{ key: string; title: string; verdicts: { code: string; status: string }[] }[]>("/api/admin/verdict-lists").catch(() => null),
    // What is kept about people's activity is the organization's (What is kept), read here only.
    orgSettings().catch(() => null),
    optOutsOf(ctx.projectId).then((all) => all.length).catch(() => null),
  ]);
  const [stateNames_, intake, defaults] = await Promise.all([stateNames(ctx), projectIntake(ctx), projectDefaults().catch(() => null)]);
  const asCome = intake.mode === "AS_RECEIVED";
  const confirmJoin = effectiveAnswer(`CONFIRM:${PEOPLE_KEY}`, answers.get(`CONFIRM:${PEOPLE_KEY}`)) === "ON";

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
  const { lead, risk } = schedule.days;
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
  const leadFixed = switches.some((one) => one.key === "LEAD_DAYS" && !one.free);
  /** Whose a number of days is: the project's own, with the organization's beside it, or the organization's. */
  const daysMark = (own: boolean, organization: number) => (
    <span className="text-[11px] font-normal text-slate-500">{own ? `changed here · the organization's: ${organization}` : "the organization's"}</span>
  );
  // An answer the organization keeps fixed on every other project, free here by an exception: its reason.
  const exceptionOf = (key: string) => {
    const item = switches.find((one) => one.key === (roomItemOf(key) ?? key));
    return item?.exceptHere ? item.except.find((e) => e.projectId === ctx.projectId)?.reason : undefined;
  };
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
      const where = isAdmin(me) ? "/organization/settings/security#tracking" : undefined;
      if (!organization) return fact(key, "What is kept about people's activity", "The organization's choice");
      return [
        fact("track-acts", "What people do to documents", "Always kept"),
        fact("track-reading", "Opening a document, downloading a file", organization.get("TRACK_READING") === "OFF" ? "Not kept" : "Kept", where),
        fact("track-signins", "Sign-ins, on a person's activity", organization.get("TRACK_SIGN_INS") === "ON" ? "Shown" : "Kept for security, not shown", where),
      ];
    }
    if (key === "INTAKE") {
      const list = (setKey: string) => values.filter((one) => one.setKey === setKey && one.status === "ACTIVE").map((one) => ({ code: one.code, label: one.label }));
      return <IntakeChoice key={key} mode={intake.mode} filing={intake} deliverableTypes={list("DELIVERABLE_TYPES")} docTypes={list("DOCUMENT_TYPES")}
        disciplines={list("DISCIPLINES")} readOnly={readOnly} fixed={isFixed("SUPPLIER_INTAKE")} />;
    }
    if (key === "CONTROL_PEOPLE") return fact(key, "Who acts as the control function", names.length ? names.join(", ") : "Nobody", "#control-people");
    if (key.startsWith("STATE:")) {
      const code = key.slice(6) === "RELEASED" && together ? "RELEASED_ISSUED" : key.slice(6);
      return fact(key, "This state is called", stateNames_[code as keyof typeof stateNames_] ?? code, isAdmin(me) ? "/organization/settings/states" : undefined);
    }
    // The stamp is a Settings card of its own (owner): here it is read, as it stands, with where it is changed.
    if (key === "THE_STAMP") return fact(key, "The stamp on the PDF", stampSaid(stampAnswers(organization ?? new Map(), answers)), "/settings/stamp");
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
      return <Choice key={key} title={act.title} options={options} value={value} action={setRoomAnswerAction} hidden={{ key }} readOnly={readOnly} fixed={isFixed(key)} exception={exceptionOf(key)} />;
    }
    if (key.startsWith("CONFIRM:")) {
      const of = key.slice(8);
      const options = [
        { value: "ON", label: "Yes", text: CONFIRMABLE[of] ?? "" },
        { value: "OFF", label: "No", text: of === PEOPLE_KEY ? "Nobody confirms: they are on the project at once." : "Nobody confirms: the control function applies it." },
      ];
      return <Choice key={key} title="Confirmed by whoever holds Manage" options={options} value={effectiveAnswer(key, answers.get(key))} action={setRoomAnswerAction} hidden={{ key }} readOnly={readOnly} fixed={isFixed(key)} exception={exceptionOf(key)} />;
    }
    if (key === "DAYS") {
      const days = schedule.days;
      return [
        <Choice key="lead" title="A document is needed before the action's day" value={String(lead)} unit="days" min={0} max={365} field="leadDays"
          action={setScheduleDaysAction} hidden={{ riskDays: String(risk) }} readOnly={readOnly} fixed={leadFixed} exception={exceptionOf("LEAD_DAYS")}
          mark={daysMark(days.ownLead, days.organizationLead)} />,
        <Choice key="risk" title="The action is at risk from" value={String(risk)} unit="days before" min={0} max={365} field="riskDays"
          action={setScheduleDaysAction} hidden={{ leadDays: String(lead) }} readOnly={readOnly} fixed={riskFixed} exception={exceptionOf("RISK_WINDOW")}
          mark={daysMark(days.ownRisk, days.organizationRisk)} />,
        ...(!readOnly && (days.ownLead || days.ownRisk) ? [<FollowOrganizationDays key="follow" lead={days.organizationLead} risk={days.organizationRisk} />] : []),
      ];
    }
    if (key === "ESCALATE") {
      return <Choice key={key} title="A discipline still silent after the day is told again, with whoever holds Manage and the control function, after" value={escalate} unit="working days" min={1} max={60}
        action={setRoomAnswerAction} hidden={{ key: ESCALATE_AFTER_KEY }} readOnly={readOnly} fixed={isFixed(ESCALATE_AFTER_KEY)} exception={exceptionOf(ESCALATE_AFTER_KEY)} />;
    }
    const policy = POLICIES.find((one) => one.key === key);
    if (!policy) return null;
    const options = policy.options.map((one) => ({ value: one.value, label: clean(one.label), text: one.text }));
    return <Choice key={key} title={policy.title} options={options} value={effectiveAnswer(key, answers.get(key))} action={setRoomAnswerAction} hidden={{ key }} readOnly={readOnly} fixed={isFixed(key)} exception={exceptionOf(key)} />;
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
    const acts = stage.who.filter((one): one is string => typeof one === "string");
    const panel = (
      <StepPanel stage={stage} warn={!!stage.warn || (asCome && !!stage.answers?.includes("INTAKE"))}
        acts={acts.map(answer)} answers={(stage.answers ?? []).flatMap((key) => answer(key))}
        tiles={tiles.map((one) => ({ ...one, opens: opens(one.href) }))} />
    );
    return [stage.key, panel];
  }));

  const byKey = new Map(stages.map((stage) => [stage.key, stage]));
  const returner = actRow.get("RETURN_OUTCOME")?.controlDoes ? "The control function" : "The reviewer";
  const flows: Flow[] = flowsFor({ gate, returner, together, unreviewed, asCome, confirmJoin, role }).map((flow) => ({
    ...flow,
    columns: flow.columns.map((column) => column.map((lane) => {
      const stage = byKey.get(lane.scene)!;
      const scene: Scene = { key: stage.key, title: stage.title, tagline: lane.tagline ?? stage.tagline, rail: stage.rail };
      return { scene, when: lane.when, end: lane.end };
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
              {" "}· <a href="#control-people" className="text-link hover:underline">{readOnly ? "see" : "change"}</a>
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
          <Link href={PLAN} className="ask shrink-0 self-start">Read it all as the plan</Link>
        </div>
      </section>

      <SceneDeck flows={flows} panels={panels} />

      {/* What holds for the whole project rather than one step. */}
      {directory ? (
        <ControlPeople project={ctx.project.code} mayName={directory.mayNameControl}
          people={directory.people.filter((p) => p.partyId === null || directory.organizations.some((o) => o.kind === "OURS" && o.id === p.partyId))} />
      ) : null}
      {readOnly ? null : <BackToDefaults defaults={defaults} admin={isAdmin(me)} />}
    </div>
  );
}
