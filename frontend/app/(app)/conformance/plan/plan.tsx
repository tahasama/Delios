import { requireScope } from "@/lib/core/scope";
import { api, projectPath } from "@/lib/client";
import { fmtDate } from "@/lib/core/utils";
import { getMe } from "@/lib/account/api";
import { getActiveSet, getSets } from "@/lib/settings/config";
import { projectSettings, orgSettings } from "@/lib/settings/api";
import { stampAnswers, stampSaid } from "@/lib/settings/stamp";
import { controlSettings, effectiveAnswer, PROJECT_MODE_LABEL, SKIPPABLE } from "@/lib/settings/control-activities";
import { KINDS, KIND_LABEL, fieldsOf, fieldRules, fieldLabels, storedOwnFields, type FieldRule } from "@/lib/settings/field-policy";
import { ESCALATE_AFTER_KEY, NOTIFY_AT_KEY } from "@/lib/actions/escalation";
import { DEFAULT_LEAD_DAYS } from "@/lib/actions/schedule";
import { scheduleSource } from "@/lib/actions/api";
import { stateNames } from "@/lib/core/state-names";
import { VERB_LABEL, type Verb } from "@/lib/core/permissions";
import { verdictEffect, VERDICT_EFFECT_BLURB } from "@/lib/reviews/verdict-effect";
import { CATALOG, PHASE_LABEL, type Phase } from "@/lib/conformance/checks/catalog";
import { PREVENTED } from "@/lib/conformance/checks/prevented";
import { optOutsOf, scopeOf } from "@/lib/conformance/api";
import { projectPlan, type ProjectPlan } from "@/lib/conformance/plan";
import { contractRoleOptions } from "@/lib/settings/contract-roles";
import { projectKinds } from "@/lib/settings/project-kinds";
import { Chapter, Part, Say, Flow, Facts, Grid, Code, Missing, Ensured, Always, ToneChip } from "./parts";

/**
 * The project's document management plan: how documents are controlled on this project, why, by whom, where and when.
 *
 * Every sentence is read from how the project is set up (its lists, numbering, routes, functions, answers in the
 * Control room), so the plan and what the app does cannot drift: change a setting and the plan changes with it. What
 * is not set up yet is said where it belongs. Nothing on it is typed, and it is not a setting: it is read under
 * Assurance, by everyone of ours, and printed.
 */

type Directory = {
  organizations: { id: string; code: string; name: string; role: string | null; kind: "OURS" | "COLLABORATOR" | "GUEST" | "OFFLINE"; contact: string | null; contactEmail: string | null; people: number }[];
  people: { id: string; name: string; organization: string | null; function: string; department: string | null; control: boolean; manages: boolean }[];
};

const HOW_THEY_WORK: Record<Directory["organizations"][number]["kind"], string> = {
  OURS: "Us",
  COLLABORATOR: "Works from its own DELIOS",
  GUEST: "We give its people accounts",
  OFFLINE: "One of ours works for it, by email",
};

/** The chapters, in the order the plan is read: the table of contents is made from it. */
export const CHAPTERS = [
  { id: "purpose", title: "Purpose and scope" },
  { id: "parties", title: "Who takes part" },
  { id: "roles", title: "Who does what" },
  { id: "life", title: "A document's life" },
  { id: "register", title: "Registering" },
  { id: "asked", title: "What forms ask" },
  { id: "numbering", title: "Numbering" },
  { id: "revisions", title: "Revisions" },
  { id: "review", title: "Review and approval" },
  { id: "release", title: "Release and issue" },
  { id: "transmittals", title: "Transmittals" },
  { id: "outside", title: "Other organizations" },
  { id: "schedule", title: "The schedule" },
  { id: "access", title: "Who sees what" },
  { id: "keeping", title: "Keeping and ending" },
  { id: "record", title: "What is recorded" },
  { id: "assurance", title: "How it is checked" },
] as const;
const n = (id: (typeof CHAPTERS)[number]["id"]) => CHAPTERS.findIndex((c) => c.id === id) + 1;

const ensured = (where: string) => PREVENTED.filter((rule) => rule.where === where);
const list = (items: string[]) => (items.length ? items.join(", ") : "—");

/** An example number, built from a scheme's parts and the first value of each list it reads. */
function exampleNumber(scheme: ProjectPlan["numbering"][number], facts: Record<string, string>): string {
  return scheme.fields.map((f) => {
    if (f.source === "SEQUENCE") return "1".padStart(f.digits ?? 4, "0");
    if (f.source === "FIXED") return f.value ?? "";
    return facts[f.source] ?? f.label.toUpperCase().slice(0, 3);
  }).join(scheme.delimiter);
}

/** The first few names a revision line gives: A, B, C… or 0, 1, 2…, with its prefix and the letters it skips. */
function revisionNames(series: ProjectPlan["revisions"][number]["series"][number]): string {
  const numbers = series.kind.toUpperCase().startsWith("N");
  const out: string[] = [];
  if (numbers) {
    const start = Number(series.start || 0) || 0;
    for (let i = 0; i < 3; i++) out.push(`${series.prefix}${String(start + i).padStart(series.width || 1, "0")}`);
  } else {
    let code = (series.start || "A").toUpperCase().charCodeAt(0);
    while (out.length < 3 && code <= 90) {
      const letter = String.fromCharCode(code++);
      if (!series.excludedLetters.includes(letter)) out.push(`${series.prefix}${series.lowercase ? letter.toLowerCase() : letter}`);
    }
  }
  return `${out.join(", ")}…`;
}

const MEANING_TONE: Record<string, "done" | "waiting" | "refused" | "idle"> = { FINAL: "done", FINAL_FIX_NEXT: "waiting", RETURN: "refused", INFORMATION: "idle" };
const MEANING_WORDS: Record<string, string> = { FINAL: "Accepted", FINAL_FIX_NEXT: "Accepted with comments", RETURN: "Rejected", INFORMATION: "For information" };

export async function DocumentManagementPlan() {
  const ctx = await requireScope();
  const [
    plan, me, settings, org, sets, names, reading, schedule, optOuts, scope, directory, roles, kinds,
    deliverables, docTypes, disciplines, phases, subprojects, criticality, confidentiality, statuses, reasons, advice,
    retention, returnReasons, native, rendition, preservation,
  ] = await Promise.all([
    projectPlan(ctx),
    getMe(),
    projectSettings(ctx.projectId),
    orgSettings(),
    getSets(),
    stateNames(ctx),
    controlSettings(ctx),
    scheduleSource(ctx),
    optOutsOf(ctx.projectId),
    scopeOf(ctx.projectId),
    api<Directory>(projectPath(ctx, "/people/directory")).catch(() => null),
    contractRoleOptions().catch(() => []),
    projectKinds(),
    getActiveSet("DELIVERABLE_TYPES"),
    getActiveSet("DOCUMENT_TYPES"),
    getActiveSet("DISCIPLINES"),
    getActiveSet("PHASES"),
    getActiveSet("SUBPROJECTS"),
    getActiveSet("CRITICALITY"),
    getActiveSet("CONFIDENTIALITY"),
    getActiveSet("STATUSES"),
    getActiveSet("REASONS_FOR_ISSUE"),
    getActiveSet("REVIEW_ADVICE"),
    getActiveSet("RETENTION_CLASSES"),
    getActiveSet("RETURN_REASONS"),
    getActiveSet("NATIVE_FORMATS"),
    getActiveSet("RENDITION_FORMATS"),
    getActiveSet("PRESERVATION_FORMATS"),
  ]);
  const project = me?.projects.find((p) => p.id === ctx.projectId);
  let info: { startDate?: string; endDate?: string | null; description?: string | null } = {};
  try { info = JSON.parse(settings.get("PROJECT_INFO") ?? "{}"); } catch { info = {}; }
  const answer = (key: string) => effectiveAnswer(key, settings.get(key));
  const label = (items: { code: string; label: string }[], code: string | null | undefined) => (code ? items.find((v) => v.code === code)?.label ?? code : null);
  const setTitle = (key: string) => sets.find((s) => s.key === key)?.title ?? key;

  // The sets of the review outcomes, each with whom it serves, the routes naming it, its verdicts and what each means.
  const outcomeSets = (await api<{ lists: { key: string; sets: { id: string | null; name: string; isDefault: boolean; active: boolean; deliverableTypes: string[] }[] }[] }>(projectPath(ctx, "/lists"))
    .catch(() => ({ lists: [] }))).lists.find((l) => l.key === "REVIEW_OUTCOMES")?.sets.filter((s) => s.active) ?? [];
  const outcomeValues = await getActiveSet("REVIEW_OUTCOMES");
  const defaultSetId = outcomeSets.find((s) => s.isDefault)?.id ?? null;
  const verdictLists = outcomeSets.map((s) => ({
    key: s.name, title: s.name,
    serves: s.deliverableTypes.length ? s.deliverableTypes : null, isDefault: s.isDefault,
    routes: plan.routes.filter((r) => r.verdicts === s.name).map((r) => r.name),
    values: outcomeValues.filter((v) => (v.setId ?? defaultSetId) === s.id),
  }));

  const orgs = directory?.organizations ?? [];
  const ours = orgs.find((o) => o.kind === "OURS");
  const others = orgs.filter((o) => o.kind !== "OURS");
  const people = directory?.people ?? [];
  const control = plan.control;
  const hasControl = control.length > 0;
  const controlName = hasControl ? "the control function" : "the people doing the work";
  const functionName = (code: string | null) => plan.functions.find((f) => f.code === code)?.name ?? code;
  const orgName = (code: string | null) => (code ? orgs.find((o) => o.code === code)?.name ?? code : null);
  const roleLabel = (code: string | null) => (code ? roles.find((r) => r.code === code)?.label ?? code : "—");

  const releaseSends = answer("POLICY_RELEASE") !== "SEPARATE";
  const stamp = stampAnswers(org, settings);
  const strictMatrix = answer("POLICY_MATRIX") === "STRICT";
  const readyMeans = answer("POLICY_READY") === "STATUS" ? "carrying the status the action needs" : "released and issued at the status the action needs";
  const escalateAfter = Number(answer(ESCALATE_AFTER_KEY));
  const notifyAt = `${String(Number(answer(NOTIFY_AT_KEY))).padStart(2, "0")}:00`;
  const riskWindow = schedule.days.risk;
  const leadDays = schedule.days.lead;
  const peopleRow = reading.rows.find((r) => r.activity.key === "PROJECT_PEOPLE");
  /** Who carries an act out on this project, as the Control room answers it. */
  const whoDoes = (key: string) => {
    const row = reading.rows.find((r) => r.activity.key === key);
    return row ? (row.controlDoes ? row.activity.control : row.activity.self) : "—";
  };
  const trackReading = (org.get("TRACK_READING") ?? "ON") !== "OFF";
  const trackSignIns = org.get("TRACK_SIGN_INS") === "ON";

  // Facts an example number is built from: the first value of each list.
  const facts: Record<string, string> = {
    PROJECT: project?.code ?? "", SUBPROJECT: subprojects[0]?.code ?? "00", DISCIPLINE: disciplines[0]?.code ?? "",
    DOC_TYPE: docTypes[0]?.code ?? "", ORIGINATOR: others[0]?.code ?? "ORG", CONTRACT_REF: "PO1",
  };
  const fromOutside = deliverables.filter((d) => Array.isArray(d.props.required) && (d.props.required as string[]).includes("originator"));
  const records = docTypes.filter((t) => t.props.record === true);
  const notReviewed = docTypes.filter((t) => t.props.review === false);
  const typesOf = (deliverable: string) => docTypes.filter((t) => Array.isArray(t.props.deliverables) && (t.props.deliverables as string[]).includes(deliverable));
  const dataReasons = reasons.filter((r) => r.props.family !== "Information");
  const infoReasons = reasons.filter((r) => r.props.family === "Information");
  const verbsOf = (f: ProjectPlan["functions"][number]) => [...new Set(f.rows.flatMap((r) => r.verbs))] as Verb[];
  const checksBy = (["SETUP", "RUNNING", "HANDOVER"] as Phase[]).map((p) => ({ phase: p, count: CATALOG.filter((c) => c.phase === p).length }));
  // What each form asks, where the organization decided otherwise than the app: a field made required, left out, or
  // added of its own. A form nobody changed asks what the app asks, and is not repeated here.
  const RULE_WORDS: Record<FieldRule, string> = { REQUIRED: "must be filled", OPTIONAL: "asked, may be left", OFF: "not asked" };
  const asked = (await Promise.all(KINDS.map(async (kind) => {
    const [rules, labels, stored] = await Promise.all([fieldRules(ctx, kind), fieldLabels(ctx, kind), storedOwnFields(ctx, kind)]);
    const changed = fieldsOf(kind).filter((f) => !f.fixed && rules[f.key] !== f.fallback)
      .map((f) => ({ label: labels[f.key] ?? f.label, rule: rules[f.key], own: false }));
    const added = stored.own.filter((f) => f.rule !== "OFF" && !f.retired).map((f) => ({ label: f.label, rule: f.rule as FieldRule, own: true }));
    return { kind, lines: [...changed, ...added] };
  }))).filter((one) => one.lines.length);
  const leftOut = reading.rows.filter((row) => row.off);

  return (
    <article className="plan-doc space-y-4">
      {/* The cover: what project, whose, and the figures it stands on. */}
      <section className="plan-cover register register-sheet register-sheet-open">
        <div className="px-5 pt-6 pb-5 sm:px-6">
          <p className="stencil text-slate-500">Document management plan</p>
          <p className="mt-3 font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">{project?.code}</p>
          <h1 className="plate-title mt-0.5 text-slate-950">{project?.name}</h1>
          <p className="plate-meta mt-2">
            {scope.organizationName} · {roleLabel(project?.contractRole ?? null)} · {kinds.label(project?.kind ?? "GENERIC")}
            {info.startDate ? ` · from ${fmtDate(info.startDate)}` : ""}{info.endDate ? ` to ${fmtDate(info.endDate)}` : ""}
          </p>
          {info.description ? <p className="mt-2 max-w-3xl whitespace-pre-line text-[13px] leading-6 text-slate-700">{info.description}</p> : null}
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              [String(orgs.length || 1), orgs.length === 1 ? "organization" : "organizations"],
              [String(people.length), people.length === 1 ? "person on it" : "people on it"],
              [hasControl ? String(control.length) : "none", hasControl ? "act as the control function" : "control function: the work does it"],
              [String(plan.numbering.length), plan.numbering.length === 1 ? "numbering" : "numberings"],
              [String(plan.routes.length), plan.routes.length === 1 ? "review route" : "review routes"],
              [`${scope.integrityThreshold}%`, "of documents clear: the target"],
            ].map(([figure, words]) => (
              <div key={words} className="rounded-md bg-tint-soft px-3 py-2.5 ring-1 ring-line">
                <p className="text-xl font-semibold leading-none tabular-nums text-slate-900">{figure}</p>
                <p className="mt-1 text-[11px] leading-4 text-slate-600">{words}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-slate-500">
            Written from how {project?.code} is set up, {fmtDate(new Date())}. Nothing on it is typed: change a setting and the plan changes with it.
          </p>
        </div>
      </section>

      <Chapter n={n("purpose")} id="purpose" title="Why this plan, and what it covers"
        why="So that everyone working on the project knows how a document is made, checked, approved, sent and kept, and works the same way."
        change={[{ href: "/settings/projects", label: "This project" }]}>
        <Part title="What it covers">
          <Say>{scope.scopeStatement}</Say>
          <Say>A document is controlled when it is in the register: it has its number, its revisions, its reviews, who received it and when. Anything not in the register is not controlled, whatever its name.</Say>
        </Part>
        <Part title="The principles everything below follows">
          <Always items={[
            "One register: every document, revision, review and transmittal is in it, and only there.",
            "Nothing is typed twice: numbers, dates and states are worked out by the app from what people do.",
            "Nothing is deleted. A value is retired, a revision voided, a document withdrawn, each with why.",
            "Every act says who did it, when, and why, and it stays.",
            "What people write (comments, reasons, answers) is shown where it matters, to the people it is for.",
            "Each document is held by one side at a time, and only the holder changes it.",
          ]} />
        </Part>
      </Chapter>

      <Chapter n={n("parties")} id="parties" title="Who takes part"
        why="Who works on the project, what each organization does, and how each one works with us: through its own DELIOS, with accounts we give, or by email."
        change={[{ href: "/settings/parties", label: "Organizations" }, { href: "/directory", label: "Project directory" }]}>
        <Part title="The organizations" aside={`${orgs.length} on ${project?.code}`}>
          <Grid head={["Organization", "Role with us", "How it works with us", "Who answers for it", "People"]}
            rows={[...(ours ? [ours] : []), ...others].map((o) => [
              <span key="n"><Code>{o.code}</Code> {o.name}</span>,
              o.kind === "OURS" ? roleLabel(project?.contractRole ?? null) : roleLabel(o.role),
              HOW_THEY_WORK[o.kind],
              o.contact ?? (o.kind === "OFFLINE" ? o.contactEmail ?? "—" : "—"),
              o.people,
            ])}
            empty="Only us so far: no other organization is on the project." />
        </Part>
        <Part title="How each way works">
          <Always items={[
            <><strong className="font-semibold">Its own DELIOS:</strong> its people sign in at home and switch into the project; its administrator puts them on.</>,
            <><strong className="font-semibold">Accounts we give:</strong> one account stands for the organization and acts as its document control.</>,
            <><strong className="font-semibold">By email:</strong> our transmittals go to its email with their files; only replies from that address are taken in, and one of ours records them.</>,
            <>People of another organization keep their own function, shown with their company; what they may do here is the function we give them.</>,
          ]} />
        </Part>
      </Chapter>

      <Chapter n={n("roles")} id="roles" title="Who does what"
        why="Each act is carried out by someone named: the control function, or the people doing the work. What each function may do is set once, in the matrix."
        change={[{ href: "/settings/flow", label: "Control room" }, { href: "/settings/functions", label: "Functions & permissions" }, { href: "/settings/users", label: "People & access" }]}>
        <Part title="The control function">
          {hasControl ? (
            <Say><strong className="font-semibold">{list(control)}</strong> {control.length === 1 ? "acts" : "act"} as the control function: between the work and the register, receiving, checking, releasing and sending. {PROJECT_MODE_LABEL[reading.projectMode]}.</Say>
          ) : (
            <Say>Nobody acts as the control function on {project?.code}: the people doing the work carry out its acts themselves (the deciding step releases, whoever asks for a revision to go out sends it).</Say>
          )}
        </Part>
        <Part title="Each act, and who carries it out here">
          {/* Who first, in a word, so the column reads at a glance; how it is done after it, in a lighter voice. */}
          <Grid head={["Act", "Who", "How"]}
            rows={reading.rows.map((row) => [
              <span key="a" className="font-semibold text-slate-800">{row.activity.title}</span>,
              row.off
                ? <span key="w" className="whitespace-nowrap text-slate-500">Nobody: left out</span>
                : <span key="w" className="flex flex-col gap-0.5 whitespace-nowrap">
                    <span className="font-semibold text-slate-800">{row.controlDoes ? "The control function" : "Whoever does the work"}</span>
                    {row.confirm ? <span className="text-[11px] text-slate-500">after whoever holds Manage confirms</span> : null}
                  </span>,
              row.off
                ? <span key="h" className="text-slate-500">Not done on this project.</span>
                : <span key="h" className="text-slate-600">{row.controlDoes ? row.activity.control : row.activity.self}</span>,
            ])} />
        </Part>
        <Part title="What each function may do" aside={`${strictMatrix ? "only the matrix decides who may be named" : "the matrix proposes; anyone on the project may be named, and the record says who chose"} · answered ${answer("POLICY_MATRIX_DETAIL") === "FAMILY" ? "per discipline and document family" : "per discipline"}`}>
          <Grid head={["Function", "May", "Held here by"]}
            rows={plan.functions.map((f) => [
              f.name,
              <span key="v" className="flex flex-wrap gap-1">{verbsOf(f).map((v) => <ToneChip key={v} tone="idle">{VERB_LABEL[v] ?? v}</ToneChip>)}</span>,
              f.holders.length ? list(f.holders.map((h) => h.name)) : <span className="text-slate-500">nobody yet</span>,
            ])}
            empty="No function is set up yet: nobody may act." />
        </Part>
        {leftOut.length ? (
          <Part title="Left out on this project">
            <Always items={leftOut.map((row) => <><strong className="font-semibold">{row.activity.title}:</strong> {SKIPPABLE[row.activity.key]?.off}</>)} />
          </Part>
        ) : null}
        <Part title="Joining the project">
          <Flow steps={[
            { what: "Someone new is asked for", who: "Anyone of ours", detail: "With their name, email, function and department.", rail: "rail-draft" },
            { what: "They are added", who: peopleRow?.controlDoes ? "The control function" : "Anyone on the project", rail: "rail-review" },
            ...(peopleRow?.confirm ? [{ what: "Their joining is confirmed, or refused with why", who: "Whoever holds Manage", detail: "Until confirmed they are not on the project.", rail: "rail-prep" }] : []),
            { what: "They are on the project, and told", who: "By itself", detail: "By notification and email; a new account gets its link to choose a password.", rail: "rail-released" },
          ]} />
        </Part>
      </Chapter>

      <Chapter n={n("life")} id="life" title="A document's life, end to end"
        why="The road every revision travels, and where it can turn back. Each state has its own colour, the same everywhere in the app."
        change={[{ href: "/settings/flow", label: "Control room" }]}>
        <Flow steps={[
          { what: "Registered", who: "Its author (or the control function)", detail: "It gets its number at once. It may hold nothing yet: a placeholder for what is due.", rail: "rail-none" },
          { what: names.IN_PREPARATION, who: "Its author or the control function", detail: "Until it is released, anything about it may change: its files, its title, every field.", rail: "rail-prep" },
          { what: names.IN_REVIEW, who: "The people on each step of its route", when: "Each step has its own days", detail: "Advisers advise, the decider decides. Whoever started the review, or the control function, may withdraw it with a reason.", rail: "rail-review" },
          { what: "Decided", who: "The decider", detail: "Accepted, accepted with comments, rejected, or taken for information. Rejected goes back to its author for a new revision.", rail: "rail-accepted" },
          { what: releaseSends ? names.RELEASED_ISSUED : names.RELEASED, who: hasControl ? "The control function" : "The deciding step", detail: releaseSends ? "Released and sent in one act, to the people the decider named." : "Released: people work from it; sending it is a separate act.", rail: "rail-released" },
          { what: names.SUPERSEDED, who: "By itself", detail: "When a later revision is released. Everyone who received it is told.", rail: "rail-superseded" },
        ]} />
        <Part title="Where it can turn">
          <Grid head={["What happens", "What follows"]} rows={[
            ["Accepted with comments, or released for update", "Released, and back with its author at once: the comments go into the next revision, which needs nobody's leave."],
            ["Rejected", "Back to its author: a new revision answers the comments."],
            ["Withdrawn from review", "The review stays in the register as Withdrawn, with its reason; the revision can be sent again."],
            [names.VOID, "One revision treated as never valid, with why; taken back only on the newest revision."],
            [names.ON_HOLD, "Released, then held: not for use until it is lifted."],
          ]} />
        </Part>
      </Chapter>

      <Chapter n={n("register")} id="register" title="Registering a document"
        why="A document exists for the project once it is registered: described the same way by everyone, so it can be found, numbered, routed and kept."
        change={[{ href: "/settings/config", label: "Types & sets" }, { href: "/settings/fields", label: "Forms & fields" }]}>
        <Flow steps={[
          { what: "Its deliverable type says who produces it", who: "Whoever registers it", detail: "And so how it is numbered, and which document types it may be.", rail: "rail-none" },
          { what: "It is described the same way by everyone", detail: "Document type, discipline, phase, criticality (its type recommends one), who may see it: each chosen from the project's lists.", rail: "rail-none" },
          { what: "Its files may come later", detail: "A PDF and a native file; neither is needed to register it.", rail: "rail-none" },
          { what: "It is numbered and in the register", who: "By itself", detail: "The project code comes from the project; nobody types a number.", rail: "rail-prep" },
        ]} />
        <Part title="Deliverable types: who produces it" aside={`${deliverables.length} in use`}>
          <Grid head={["Deliverable type", "From another organization", "Its document types"]}
            rows={deliverables.map((d) => [
              <span key="d"><Code>{d.code}</Code> {d.label}</span>,
              fromOutside.includes(d) ? "Yes: it asks whose it is" : "No",
              list(typesOf(d.code).map((t) => t.label)) === "—" ? <span className="text-slate-500">read from "who produces it"</span> : list(typesOf(d.code).map((t) => t.label)),
            ])}
            empty="No deliverable type yet: nothing can be registered." />
        </Part>
        <Part title="Disciplines" aside={`${disciplines.length}`}>
          {disciplines.length ? <Say>{disciplines.map((d) => `${d.code} ${d.label}`).join(" · ")}</Say> : <Missing>No discipline yet.</Missing>}
        </Part>
        {phases.length ? (
          <Part title="Phases" aside="each revision keeps the phase it was made in">
            <Say>{phases.map((p) => p.label).join(" → ")}</Say>
          </Part>
        ) : null}
        <Part title="Criticality: how much an error would cost">
          <Grid head={["Level", "What it means", "Kept"]}
            rows={criticality.map((c) => [
              <span key="c"><Code>{c.code}</Code> {c.label}</span>,
              String(c.props.meaning ?? "—"),
              label(retention, c.props.retention as string) ?? "—",
            ])}
            empty="No criticality levels yet." />
        </Part>
        {records.length || notReviewed.length ? (
          <Part title="Types handled differently">
            <Always items={[
              ...(records.length ? [<>Registered as <strong className="font-semibold">records</strong>, fixed once confirmed and never revised: {list(records.map((t) => t.label))}.</>] : []),
              ...(notReviewed.length ? [<>Released without review: {list(notReviewed.map((t) => t.label))}.</>] : []),
            ]} />
          </Part>
        ) : null}
        <Ensured rules={ensured("Registering a document")} />
      </Chapter>

      <Chapter n={n("asked")} id="asked" title="What is asked, and what must be filled"
        why="What this organization decided each form asks, beyond what the app asks by itself: so everyone gives the same information, every time."
        change={[{ href: "/settings/fields", label: "Forms & fields" }]}>
        {asked.length ? asked.map((one) => (
          <Part key={one.kind} title={KIND_LABEL[one.kind]}>
            <Grid head={["Field", "Here"]}
              rows={one.lines.map((line) => [<span key="f">{line.label}{line.own ? <span className="text-slate-500"> (added by us)</span> : null}</span>, RULE_WORDS[line.rule]])} />
          </Part>
        )) : <Say>Every form asks what the app asks by itself; nothing was made required, left out or added.</Say>}
      </Chapter>

      <Chapter n={n("numbering")} id="numbering" title="How documents are numbered"
        why="Every document, review, transmittal and package is numbered by the app, from its parts in a fixed order, so a number says what it is and is never given twice."
        change={[{ href: "/settings/numbering", label: "Numbering" }]}>
        {plan.numbering.length ? plan.numbering.map((s) => (
          <Part key={s.name} title={s.name} aside={s.deliverableTypes.filter((d) => !d.startsWith("@")).length ? `used by ${list(s.deliverableTypes.filter((d) => !d.startsWith("@")).map((d) => label(deliverables, d) ?? d))}` : s.deliverableTypes.length ? `numbers ${list(s.deliverableTypes.map((d) => d.slice(1).toLowerCase()))}` : "not in use"}>
            <div className="flex flex-wrap items-center gap-1.5">
              {s.fields.map((f, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {i ? <span className="font-mono text-slate-400">{s.delimiter}</span> : null}
                  <span className="rounded-md bg-tint-soft px-2 py-1 text-[11.5px] ring-1 ring-line">{f.source === "FIXED" ? <Code>{f.value}</Code> : f.label}</span>
                </span>
              ))}
              <span className="ml-2 text-[12px] text-slate-500">for example <Code>{exampleNumber(s, facts)}</Code></span>
            </div>
          </Part>
        )) : <Missing>No numbering yet: nothing can be registered.</Missing>}
        <Always items={[
          "A number is given when the document is registered, and never changes.",
          "A number is never reused, even when its document is cancelled.",
          "A numbering changed later keeps the numbers already given.",
          "Packages and asset tags are numbered the same way.",
        ]} />
      </Chapter>

      <Chapter n={n("revisions")} id="revisions" title="Revisions"
        why="Each change to a document is a new revision with a name everyone reads the same way. Revisions are never skipped, and each one says what changed and why."
        change={[{ href: "/settings/revisions", label: "Revisions" }]}>
        {plan.revisions.length ? plan.revisions.map((s) => (
          <Part key={s.name} title={`${s.name}${s.isDefault ? " (the default)" : ""}`} aside={s.deliverableTypes.length ? `for ${list(s.deliverableTypes.map((d) => label(deliverables, d) ?? d))}` : undefined}>
            <Grid head={["Phase", "Revisions are named"]}
              rows={s.series.map((line) => [line.phase ? label(phases, line.phase) ?? line.phase : "Any other phase", revisionNames(line)])} />
          </Part>
        )) : <Missing>No revision scheme yet.</Missing>}
        <Flow steps={[
          { what: "A new revision is started", who: "Its author", detail: "It asks one thing: what changed, and why. A verdict that asked for changes needs nobody's leave; one accepted as it stands needs a reason.", rail: "rail-prep" },
          { what: "It is prepared", detail: "Until released, anything about it may change: its files, its title, every field.", rail: "rail-prep" },
          { what: "It is sent for review, or released", detail: "Never in two reviews at once.", rail: "rail-review" },
        ]} />
        <Ensured rules={ensured("Revisions")} />
      </Chapter>

      <Chapter n={n("review")} id="review" title="Review and approval"
        why="Each revision is looked at by the people who should, in a known order, with a known number of days, and decided by one step. Every answer and comment stays with it."
        change={[{ href: "/settings/workflow-templates", label: "Review routes" }, { href: "/settings/verdicts", label: "Verdict lists" }]}>
        <Flow steps={[
          { what: "Sent for review", who: "Whoever is ready to have it looked at", detail: "The recommended route and people are proposed; the sender may change them for this review, and the record says so. People can be copied in.", rail: "rail-review" },
          { what: "Each step answers", who: "The people named on the step", when: "Within the step's days", detail: "Advisers choose advice; the decider chooses a verdict. Comments are written under the answer, and required when the answer carries comments.", rail: "rail-review" },
          { what: "Decided", who: "The deciding step", detail: "The verdict's meaning decides what follows. What it is issued for starts as the revision's purpose; each step confirms or changes it.", rail: "rail-accepted" },
          { what: "Everyone it concerns is told", who: "By itself", detail: "Whoever started it, the author, everyone on the route, those copied in, the control function, and the other organization when it is theirs.", rail: "rail-released" },
        ]} />
        {plan.routes.length ? plan.routes.map((route) => (
          <Part key={route.name} title={`${route.name}${route.isDefault ? " (the default)" : ""}`}
            aside={route.patterns.length
              ? `for ${route.patterns.map((p) => [label(deliverables, p.deliverableType), label(docTypes, p.docType), label(disciplines, p.discipline), p.criticality ? `criticality ${p.criticality}` : null, orgName(p.originator)].filter(Boolean).join(" · ") || "any document").join("; ")}`
              : "for any document"}>
            {route.description ? <Say className="text-[12px] text-slate-500">{route.description}</Say> : null}
            <Grid head={["Step", "Who answers", "Days", "Answered by"]}
              rows={route.steps.map((s, i) => [
                <span key="t">{i + 1}. {s.title}{i === route.steps.length - 1 ? <span className="ml-1.5"><ToneChip tone="moving">decides</ToneChip></span> : null}</span>,
                s.partyCode
                  ? `${orgName(s.partyCode)}, by transmittal`
                  : [...s.people, ...s.holders.filter((h) => !s.people.includes(h))].length
                    ? <span>{list([...s.people, ...s.holders.filter((h) => !s.people.includes(h))])}{s.functionCode ? <span className="text-slate-500"> ({functionName(s.functionCode)})</span> : null}</span>
                    : <span className="text-amber-800">nobody yet{s.functionCode ? ` holds ${functionName(s.functionCode)}` : ""}</span>,
                s.days ? `${s.days} working days` : "no limit",
                s.mode === "ALL" ? "every one of them" : "the first to answer",
              ])} />
          </Part>
        )) : <Missing>No review route yet: nothing can be reviewed.</Missing>}
        {verdictLists.map((v) => (
          <Part key={v.key} title={`Verdicts: ${v.title}`}>
            <Say>
              {v.serves ? `For ${v.serves.map((code) => label(deliverables, code) ?? code).join(", ")}` : v.isDefault ? "For every deliverable type no other set serves" : "For no deliverable type of its own"}
              {v.routes.length ? `; the routes ${v.routes.join(", ")} decide with it` : ""}.
            </Say>
            <Grid head={["Verdict", "Means", "What follows"]}
              rows={v.values.map((value) => {
                const meaning = "proceed" in value.props ? verdictEffect(value.props) : null;
                return [
                  <span key="v"><Code>{value.code}</Code> {value.label}</span>,
                  meaning ? <ToneChip tone={MEANING_TONE[meaning]}>{MEANING_WORDS[meaning]}</ToneChip> : <ToneChip tone="waiting">not chosen yet</ToneChip>,
                  meaning ? VERDICT_EFFECT_BLURB[meaning] : "Given a meaning in Types & sets before it is used.",
                ];
              })} />
          </Part>
        ))}
        {advice.length ? (
          <Part title="Advice an adviser may give">
            <Say>{advice.map((a) => a.label).join(" · ")}</Say>
          </Part>
        ) : null}
        <Ensured rules={ensured("Reviews")} />
      </Chapter>

      <Chapter n={n("release")} id="release" title="Release and distribution"
        why="A revision is in force only once released, and the people who need it receive it with a record of who got what and when."
        change={[{ href: "/settings/flow", label: "Control room" }, { href: "/settings/config?set=STATUSES", label: "Statuses" }]}>
        <Flow steps={[
          { what: "The decider says who receives it", who: "The decider, or whoever asked for it to be sent", detail: "People or organizations. Whoever releases it may take someone off; the record keeps who, by whom and when.", rail: "rail-accepted" },
          { what: releaseSends ? "Released and sent, in one act" : "Released: people work from it", who: hasControl ? "The control function" : "The deciding step", detail: releaseSends ? "A release needs someone to send to; it goes to them at once, by transmittal." : "Sending it is a separate act; nothing requires it.", rail: "rail-released" },
          { what: "The previous revision is superseded", who: "By itself", detail: "Everyone who received it is told to stop using it.", rail: "rail-superseded" },
        ]} />
        <Part title={`What it is issued for: ${setTitle("STATUSES")}`}>
          <Grid head={["Status", "Work goes ahead on it", "May be used for"]}
            rows={statuses.map((s) => [
              <span key="s"><Code>{s.code}</Code> {s.label}</span>,
              s.props.update === true ? "No: issued for update" : s.props.executes === true ? "Yes" : "No",
              [s.props.may, s.props.mayNot ? `not for ${s.props.mayNot}` : null].filter(Boolean).join("; ") || "—",
            ])}
            empty="No status yet." />
        </Part>
        <Part title="The PDF people open">
          <Say>{stampSaid(stamp)}{stamp.POLICY_PDF_STAMP === "OFF" ? "" : " The file as sent is kept either way."}</Say>
        </Part>
        <Part title="Handing documents over together: delivery packages">
          <Flow steps={[
            { what: "A package is put together", who: "Whoever is composing it", detail: "Its documents, and the status each is needed at (which also says why they get it).", rail: "rail-draft" },
            { what: "What is still missing is asked for", who: "The control function", detail: "On a transmittal to whoever accepts the package.", rail: "rail-review" },
            { what: "Its receiver confirms, and it is delivered", who: "Whoever accepts it", detail: "On their responsibility: a document not ready yet goes as it stands, and the delivery says so.", rail: "rail-delivered" },
          ]} />
        </Part>
        <Ensured rules={ensured("Releasing a revision")} />
      </Chapter>

      <Chapter n={n("transmittals")} id="transmittals" title="Transmittals and correspondence"
        why="Everything that goes out or comes in travels on a transmittal: what, to whom, why, and by when an answer is due."
        change={[{ href: "/settings/config?set=REASONS_FOR_ISSUE", label: "Reasons for issue" }]}>
        <Part title="Two kinds">
          <Always items={[
            <><strong className="font-semibold">Data transmittal:</strong> carries at least one document (or, received, the files that came with it).</>,
            <><strong className="font-semibold">Information transmittal:</strong> words alone: a request, a question, an answer, a confirmation.</>,
          ]} />
        </Part>
        <Part title="Why it is sent: the reasons">
          <Grid head={["Reason", "Kind", "An answer"]}
            rows={[...dataReasons, ...infoReasons].map((r) => [
              <span key="r"><Code>{r.code}</Code> {r.label}</span>,
              r.props.family === "Information" ? "Information" : "Data",
              r.props.response === true ? "expected" : "only if the sender asks for one",
            ])}
            empty="No reason for issue yet." />
        </Part>
        <Flow steps={[
          { what: "Written and sent", who: "Its sender, today", detail: "The documents chosen from the register; the people or organizations it goes to.", rail: "rail-sent" },
          { what: "An answer is asked by a day, when needed", who: "The sender", detail: "It then reads awaited, overdue, answered on time or answered late.", rail: "rail-review" },
          { what: "Answered or completed", who: "Either side", detail: "By a new transmittal that names the one it follows.", rail: "rail-received" },
        ]} />
        <Say className="text-[12px] text-slate-500">What arrives outside the system is recorded by the control function as received, with who sent it and when, and is checked like anything that arrives.</Say>
        <Ensured rules={ensured("Transmittals")} />
      </Chapter>

      <Chapter n={n("outside")} id="outside" title="Documents from other organizations"
        why="What another organization owes us is asked, received, checked and reviewed in the open: each side always knows who holds the document and what is next."
        change={[{ href: "/packages", label: "Packages" }]}>
        {fromOutside.length ? (
          <>
            <Flow steps={[
              { what: "Placeholders are registered and filed in its package", who: "The control function", detail: "One package per organization and order, made by itself with the first document.", rail: "rail-none" },
              { what: "Asked of it on a transmittal", who: "The control function", when: "Each document by its planned day", detail: "Issued for update. From then it holds the document.", rail: "rail-sent" },
              { what: "It sends the document", who: "The other organization", detail: "Its files stay on the transmittal until checked.", rail: "rail-check" },
              { what: "Checked on arrival", who: "The control function", detail: "Accepted: it becomes the document and goes for review. Returned: back to them, with why.", rail: "rail-accepted" },
              { what: "Reviewed and decided", who: "The review route", detail: "Accepted or for information: we hold it. Accepted with comments or rejected: they hold it, and their people are told.", rail: "rail-review" },
            ]} />
            <Always items={[
              "Only the side holding a document changes it.",
              "The side not holding it may ask for it back for an update, with why; the holder accepts or refuses, with why.",
              "Their people see only what was sent to them, in their own words.",
            ]} />
          </>
        ) : <Missing>No deliverable type asks whose a document is: nothing is received from another organization yet.</Missing>}
        <Ensured rules={ensured("Suppliers")} />
      </Chapter>

      <Chapter n={n("schedule")} id="schedule" title="When documents are needed: the schedule"
        why="Documents are needed by actions on the project schedule. Each document is planned for the earliest day an action needs it, and the disciplines confirm the action can go ahead."
        change={[{ href: "/schedule", label: "Schedule" }]}>
        <Flow steps={[
          { what: "The schedule and its lists are released", who: "Whoever plans (or the control function)", detail: "The schedule, the disciplines per action and the documents each discipline needs are register documents, read when released.", rail: "rail-released" },
          { what: "Each document gets its planned day", who: "By itself", detail: `The earliest day an action needs it; sending for review is due on that day, released & issued on the action's day (${leadDays} days ahead by default).`, rail: "rail-ahead" },
          { what: "An action is at risk", when: `${riskWindow} days before its day, or the document's own risk window`, detail: `Each discipline still short is told, once, with the day's notices at ${notifyAt}, the project's time.`, rail: "rail-risk" },
          { what: "Each discipline confirms", who: "Its people", detail: `All its documents ${readyMeans}: confirmed by itself. Otherwise it confirms by hand, always saying why it goes ahead without them.`, rail: "rail-ready" },
          { what: "A silent discipline is notified again", when: `${escalateAfter} working days after the day`, detail: `Its people, whoever holds Manage and the control function are told, once, at ${notifyAt}.`, rail: "rail-overdue" },
        ]} />
        <Say className="text-[12px] text-slate-500">An action that will not go ahead is recorded as postponed, with who decided and why; whoever plans confirms it with what changes.</Say>
        <Ensured rules={ensured("Schedule")} />
      </Chapter>

      <Chapter n={n("access")} id="access" title="Who may see what"
        why="Each document carries a level of who may see it; each function reads up to its clearance. Another organization sees only its own documents and those shared with it."
        change={[{ href: "/settings/config?set=CONFIDENTIALITY", label: "Confidentiality" }, { href: "/settings/functions", label: "Functions & permissions" }]}>
        <Grid head={["Level", "What it means"]}
          rows={confidentiality.map((c) => [<span key="c"><Code>{c.code}</Code> {c.label}</span>, String(c.props.meaning ?? "—")])}
          empty="No confidentiality levels yet." />
        {plan.functions.some((f) => f.clearance) ? (
          <Part title="Clearance by function">
            <Say>{plan.functions.filter((f) => f.clearance).map((f) => `${f.name}: up to ${label(confidentiality, f.clearance) ?? f.clearance}`).join(" · ")}</Say>
          </Part>
        ) : <Say className="text-[12px] text-slate-500">No function is limited: each reads every level, except where a document names who may see it.</Say>}
        <Ensured rules={ensured("Who sees what")} />
      </Chapter>

      <Chapter n={n("keeping")} id="keeping" title="Keeping, holding and ending"
        why="How long each document is kept, how one is held, and how one stops counting, always with why, never by deleting it."
        change={[{ href: "/settings/config?set=RETENTION_CLASSES", label: "Retention classes" }]}>
        <Grid head={["Kept for", "Because", "From"]}
          rows={retention.map((r) => [<span key="r"><Code>{r.code}</Code> {r.label}</span>, String(r.props.basis ?? "—"), String(r.props.startsFrom ?? "—")])}
          empty="No retention class yet." />
        <Grid head={["Act", "When", "Who, always with why"]} rows={[
          ["Legal hold", "A document must stay as it is: no revision voided, not retired. New revisions and reviews go on.", hasControl ? "The control function or an administrator" : "An administrator"],
          ["Cancelled", "It will never be produced; only if nothing of it was ever released.", whoDoes("WITHDRAW")],
          ["Withdrawn", "Released, and no longer valid: everyone who received it is told.", whoDoes("WITHDRAW")],
          [names.VOID, "One revision released in error, or never reviewed; taken back only on the newest revision.", whoDoes("VOID")],
          ["Reinstated", "An ended document counts again; whoever received it is told.", whoDoes("WITHDRAW")],
          ["Archived", "With the project, never one by one; back if the project reopens.", "An administrator"],
        ]} />
        {native.length || rendition.length || preservation.length ? (
          <Facts rows={[
            ["Working files", list(native.map((f) => f.label))],
            ["Files people open", list(rendition.map((f) => f.label))],
            ["Files kept for the long term", list(preservation.map((f) => f.label))],
          ]} />
        ) : null}
        {returnReasons.length ? <Say className="text-[12px] text-slate-500">Reasons a submission is returned: {list(returnReasons.map((r) => r.label))}.</Say> : null}
      </Chapter>

      <Chapter n={n("record")} id="record" title="What is recorded"
        why="Every act is kept with who, when and what changed, so the register can show how it came to stand where it does."
        change={[{ href: "/organization", label: "The organization's page" }]}>
        <Always items={[
          "Every act on a document, review, transmittal, package and setting: always.",
          trackReading ? "Opening a document and downloading a file: kept." : "Opening a document and downloading a file: not kept on this organization.",
          trackSignIns ? "Sign-ins: kept and shown on a person's activity." : "Sign-ins: kept for security, not shown on a person's activity.",
          "Every reason given is kept with its document, in full.",
        ]} />
      </Chapter>

      <Chapter n={n("assurance")} id="assurance" title="How it is checked"
        why="The register checks itself whenever someone runs the checks, and its figures say when; some mistakes simply cannot happen."
        change={[{ href: "/conformance/checks", label: "Assurance" }]}>
        <Facts rows={[
          ["Target", `${scope.integrityThreshold}% of documents with nothing critical or major outstanding, and no critical finding open`],
          ["How often", "When someone of the control function runs the checks (nothing runs by itself); the figures say when they last ran"],
          ["Checks", <span key="c">{CATALOG.length} questions the app answers from its own records <span className="text-slate-500">({checksBy.map((c) => `${c.count} ${PHASE_LABEL[c.phase].toLowerCase()}`).join(" · ")})</span></span>],
          ["Refused outright", `${PREVENTED.length} mistakes the app refuses at the moment someone tries (listed in each chapter)`],
        ]} />
        {optOuts.length ? (
          <Part title="Checks switched off on this project">
            <Grid head={["Check", "Why", "Decided by"]}
              rows={optOuts.map((o) => [<Code key="c">{o.checkId}</Code>, o.reason, `${o.setByName}${o.setAt ? `, ${fmtDate(o.setAt)}` : ""}`])} />
          </Part>
        ) : <Say className="text-[12px] text-slate-500">Every check is on.</Say>}
      </Chapter>
    </article>
  );
}
