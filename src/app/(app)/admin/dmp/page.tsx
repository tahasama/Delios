import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { CheckCircle2, CircleDashed, ArrowRight, Building2, Tags, FileDigit, Workflow, Users, ShieldCheck, CalendarClock, Gauge } from "lucide-react";
import { profileForKind, missingFromProfile, type Profile } from "@/lib/profiles";
import { draftProfileAction } from "@/lib/actions/profiles";
import { isAdmin } from "@/lib/auth";
import { holdersOf } from "@/lib/permissions";
import { Banner, Card, Chip, Field, PageHeader, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { setScopeAction, addExceptionAction } from "@/lib/actions/admin";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scope & readiness" };

export default async function DmpReadinessPage() {
  const ctx = await requireScope();
  const { user, db } = ctx;
  if (!isAdmin(user)) return <PageHeader title="Scope & readiness" subtitle="Administrators only." />;

  const REQUIRED = ["DELIVERABLE_TYPES", "DOCUMENT_TYPES", "DISCIPLINES", "PHASES", "CRITICALITY", "CONFIDENTIALITY", "STATUSES", "REVIEW_OUTCOMES", "REASONS_FOR_ISSUE", "RETENTION_CLASSES"];
  const [scope, requiredSets, schemes, routings, externalParties, members, withDepartment, rules, templates, actions, calls, lastRun, spineBaseline, projects] = await Promise.all([
    db.scopeConfig.findFirst(),
    db.configSet.findMany({ where: { key: { in: REQUIRED } }, include: { _count: { select: { values: true } } } }),
    db.scheme.count({ where: { active: true } }),
    db.schemeRouting.count({ where: { status: "ACTIVE" } }),
    db.party.count({ where: { isInternal: false } }),
    db.projectMembership.count({ where: { projectId: ctx.projectId, active: true } }),
    db.projectMembership.count({ where: { projectId: ctx.projectId, active: true, department: { not: null } } }),
    db.permissionRule.findMany({ select: { verbs: true } }),
    db.workflowTemplate.count({ where: { active: true } }),
    db.action.findMany({ select: { departments: true } }),
    db.requirementCall.count(),
    db.checkRun.findFirst({ orderBy: { ranAt: "desc" } }),
    db.spineBaseline.findFirst({ orderBy: { releasedAt: "desc" } }),
    db.project.findMany({ where: { orgId: ctx.orgId, status: "ACTIVE" }, select: { kind: true } }),
  ]);
  const exceptions = await db.exceptionEntry.findMany({ orderBy: { startDate: "desc" } });

  // Project types in use, and what their starter profiles would still add.
  const kinds = [...new Set(projects.map((p) => p.kind))];
  const profileGaps = [] as { profile: Profile; missing: number }[];
  for (const kind of kinds) {
    const profile = profileForKind(kind);
    if (!profile) continue;
    const missing = (await missingFromProfile(ctx, profile)).reduce((n, s) => n + s.values.length, 0);
    if (missing) profileGaps.push({ profile, missing });
  }
  const verbsGranted = new Set(rules.flatMap((r) => { try { return JSON.parse(r.verbs) as string[]; } catch { return []; } }));
  const tagged = actions.filter((a) => (a.departments ?? "").trim()).length;
  const measuredRecently = !!lastRun && Date.now() - lastRun.ranAt.getTime() <= (scope?.measurementIntervalDays ?? 30) * 86_400_000;

  // Whether this project has a control stage is not a setting: it is whether
  // anybody holds the control function on it.
  const controlHolders = await holdersOf(ctx, "CONTROL");

  // Annex C in the order an organization actually makes the decisions.
  const steps = [
 { title: "State the scope", text: "What information is controlled, at which assessment level, and the integrity threshold it is measured against.", href: "#scope", action: "Publish scope", icon: Building2, done: Boolean(scope?.organizationName && scope?.scopeStatement), evidence: scope?.scopeStatement ? `Scope published · threshold ${scope.integrityThreshold}%`: "No scope statement" , todo: "Write what this project controls and the level it is measured at." },
 { title: "Name the functions and people", text: "Who does what, by function rather than by name, and which department each person answers for — they receive requirements calls and confirm readiness.", href: "/admin/users", action: "People & functions", icon: Users, done: members > 1 && withDepartment > 0, evidence: members <= 1 ? "Only you are on this project — add the people who write, review and approve" : withDepartment === 0 ? `${members} people on the project, but none says which department they answer for — departments receive the requirements calls` : `${members} on this project · ${withDepartment} with a department · ${externalParties} external part${externalParties === 1 ? "y": "ies"}` , todo: members <= 1 ? "Add the people who write, review and approve, and give each one a function." : "Set a department on at least one person — departments receive the requirements calls and confirm readiness before an activity." },
 { title: "Decide whether there is a control function", text: "Somebody between the work and the record, who receives, releases and sends — or nobody, and the people doing the work do those acts themselves. It is not a setting: give the function to somebody, or to no one.", href: "/distribution", action: "Functions", icon: ShieldCheck, done: true, evidence: controlHolders.length ? `${controlHolders.length} ${controlHolders.length === 1 ? "person holds" : "people hold"} it: ${controlHolders.map((one) => one.name).join(", ")} — they receive, release and send` : "Nobody holds it — the deciding step releases, and whoever asks for a revision to go out sends it themselves", todo: "" },
 { title: "Publish the project's vocabulary", text: "Disciplines, document types, statuses, outcomes, reasons and retention classes. Each project type's starter profile adds its own values.", href: "/admin/config", action: "Value sets", icon: Tags, done: requiredSets.length === REQUIRED.length && requiredSets.every((set) => set._count.values > 0) && profileGaps.length === 0, evidence: `${requiredSets.filter((s) => s._count.values > 0).length}/${REQUIRED.length} essential sets${profileGaps.length ? ` · ${profileGaps.map((g) => `${g.profile.name}: ${g.missing} starter value(s) not published`).join(" · ")}`: ""}` , todo: "Publish the lists still empty: disciplines, document types, statuses, verdicts, reasons for issue and retention classes." },
 { title: "Publish numbering", text: "Numbers are built from ordered fields and each deliverable type is routed to its scheme, so nobody invents a number.", href: "/admin/numbering", action: "Numbering", icon: FileDigit, done: schemes > 0 && routings > 0, evidence: `${schemes} scheme${schemes === 1 ? "": "s"} · ${routings} routing${routings === 1 ? "": "s"}` , todo: "Build a numbering scheme and route each kind of document to it." },
 { title: "Set the distribution matrix", text: "Which functions review, approve and receive each class of document. The Approve column is the approval authority.", href: "/distribution", action: "Distribution", icon: ShieldCheck, done: verbsGranted.has("REVIEW") && verbsGranted.has("APPROVE"), evidence: `${rules.length} rule${rules.length === 1 ? "": "s"} · ${verbsGranted.has("APPROVE") ? "approval granted": "nobody may approve"}` , todo: "Give at least one function Review and one function Approve, so documents can be routed." },
 { title: "Define review routes", text: "The step sequences documents go through — parallel inputs, a lead in series — with people proposed from the matrix.", href: "/admin/workflow-templates", action: "Review routes", icon: Workflow, done: templates > 0, evidence: `${templates} active route${templates === 1 ? "": "s"}` , todo: "Draw one review route, ending in the step that decides." },
    { title: "Load the schedule and ask for requirements", text: "Schedule in force with A-codes, departments tagged by the project manager, and each department asked for the documents its activities need (Part 14).", href: "/actions/requirements", action: "Requirements", icon: CalendarClock, done: actions.length > 0 && tagged === actions.length && calls > 0, evidence: actions.length ? `${actions.length} activities · ${tagged} tagged · ${calls} department call${calls === 1 ? "" : "s"}` : "No schedule loaded" , todo: "Upload the schedule, tag each activity with its departments, then ask those departments what documents they need." },
 { title: "Measure and synchronize", text: "Run the checks within the measurement interval and release a synchronized Rules · Routes · Checks baseline.", href: "/conformance", action: "Assurance", icon: Gauge, done: measuredRecently && !!spineBaseline, evidence: `${lastRun ? `last run ${fmtDate(lastRun.ranAt)}${measuredRecently ? "": " — overdue"}`: "never measured"} · ${spineBaseline ? `baseline ${spineBaseline.label}`: "no synchronized baseline"}` , todo: "Run the checks, then release a baseline so the rules, routes and checks are recorded together." },
  ];
  const completed = steps.filter((step) => step.done).length;
  const percentage = Math.round((completed / steps.length) * 100);
  const next = steps.find((step) => !step.done);

  return (
    <div className="space-y-6">
 <PageHeader title="Scope & readiness" subtitle="The decisions that make a project work, in the order they are made. Each one is read from what is actually set up." />
      <section className="overflow-hidden rounded-2xl bg-brand-strong p-6 text-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#9fb8cc]">Implementation readiness</p><p className="mt-2 text-3xl font-semibold">{percentage}%</p><p className="mt-1 text-sm text-[#c7d7e5]">{completed} of {steps.length} decisions are in place.</p></div>
          {next ? <Link href={next.href} className="inline-flex items-center gap-2 rounded-xl bg-[#d9a441] px-4 py-2.5 text-sm font-bold text-[#102a43]">Continue with {next.title.toLowerCase()} <ArrowRight className="h-4 w-4" /></Link> : <Chip className="bg-emerald-100 text-emerald-800 ring-emerald-300">baseline ready</Chip>}
        </div>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#d9a441]" style={{ width: `${percentage}%` }} /></div>
      </section>

      {percentage === 100 ? <Banner tone="good" title="The project is set up">The starter configuration is operational. Review each item with your organization, replace what does not fit, then run Assurance to find gaps in real project data.</Banner> : <Banner tone="warn" title="Your next missing decision">{next?.text}</Banner>}

      <ol className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {steps.map((step, index) => <li key={step.title} className={`rounded-2xl border bg-surface p-5 shadow-sm ${step.done ? "border-emerald-200" : "border-amber-200"}`}>
          <div className="flex items-start gap-4">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${step.done ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}><step.icon className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-xs font-bold text-slate-400">{index + 1}</span><h2 className="text-sm font-semibold text-slate-900">{step.title}</h2>{step.done ? <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-600" /> : <CircleDashed className="ml-auto h-4 w-4 text-amber-600" />}</div><p className="mt-2 text-xs leading-5 text-slate-500">{step.text}</p><p className="mt-3 text-[11px] font-medium text-slate-400">Where it stands: {step.evidence}</p>{step.done ? null : <p className="mt-1 text-[11px] font-semibold text-amber-700">Still to do: {step.todo}</p>}<Link href={step.href} className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-link">{step.action}<ArrowRight className="h-3.5 w-3.5" /></Link></div>
          </div>
        </li>)}
      </ol>

      {profileGaps.length ? (
        <Card title="Starter profiles" description="Values your project types bring that are not published yet. They are drafted as controlled changes; another administrator approves them.">
          <ul className="space-y-3">
            {profileGaps.map((g) => (
              <li key={g.profile.id} className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm"><span className="font-semibold text-slate-800">{g.profile.name}</span> <span className="text-xs text-slate-500">· {g.missing} value(s) · {g.profile.description}</span></span>
                <ActionForm action={draftProfileAction} submitLabel="Prepare drafts" size="sm" hidden={{ profile: g.profile.id }} className="space-y-0" />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card id="scope" title="Scope statement" description="What the system covers and the quality bar it is measured against.">
        {scope?.scopeStatement ? (
          <div className="mb-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            <p className="font-semibold text-slate-800">{scope.organizationName}</p>
            <p className="mt-1">{scope.scopeStatement}</p>
            <p className="mt-1 text-slate-500">{scope.assessmentLevel} assessment · trusted above {scope.integrityThreshold}% · measured every {scope.measurementIntervalDays} days</p>
          </div>
        ) : null}
        <details open={!scope?.scopeStatement}>
          <summary className="cursor-pointer text-xs font-semibold text-link">{scope?.scopeStatement ? "Change the scope statement" : "State the scope"}</summary>
          <div className="mt-3">
        <ActionForm action={setScopeAction} submitLabel="Publish scope statement">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Organization" required>
              <input name="organizationName" defaultValue={scope?.organizationName ?? ""} className={inputCls} />
            </Field>
            <Field label="How much is measured" hint="Core counts only that each document is identified and under control. Full also counts review, approval, issue, obsolescence and retention — a lower figure, but the whole picture.">
              <select name="assessmentLevel" defaultValue={scope?.assessmentLevel ?? "Full"} className={inputCls}>
                <option value="Core: identity and control">Core — identity and control only</option>
                <option value="Full">Full — everything the app checks</option>
              </select>
            </Field>
            <Field label="Scope statement" required className="sm:col-span-2">
              <input name="scopeStatement" defaultValue={scope?.scopeStatement ?? ""} className={inputCls} placeholder="Whole organization — all controlled information produced or received, any medium" />
            </Field>
            <Field label="Integrity threshold (%)" hint="minimum acceptable result">
              <input type="number" name="integrityThreshold" defaultValue={scope?.integrityThreshold ?? 95} min={50} max={100} className={inputCls} />
            </Field>
            <Field label="Measurement interval (days)" hint="how often assurance runs">
              <input type="number" name="measurementIntervalDays" defaultValue={scope?.measurementIntervalDays ?? 30} min={1} max={365} className={inputCls} />
            </Field>
          </div>
        </ActionForm>
          </div>
        </details>
        {scope ? (
          <p className="mt-3 text-xs text-slate-400">
            Rules version {scope.standardVersion} · in force since {fmtDate(scope.effectiveDate)} · control function: {scope.controlFunctionName}
          </p>
        ) : null}
      </Card>


      <Card id="exceptions" title={`Exceptions register (${exceptions.length})`} description="Agreed departures from the rules, with who allowed them and until when.">
        {exceptions.length ? (
          <ul className="mb-4 divide-y divide-line">
            {exceptions.map((e) => (
              <li key={e.id} className="py-2 text-sm">
                <span className="font-medium text-slate-700">{e.item}</span> <span className="text-slate-400">· clauses {e.clauses}</span>
                <p className="text-xs text-slate-500">{e.reason} — by {e.authority}, from {fmtDate(e.startDate)}{e.reviewPoint ? `, review ${fmtDate(e.reviewPoint)}` : ""}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-xs text-slate-400">No exceptions recorded.</p>
        )}
        <details><summary className="cursor-pointer text-xs font-semibold text-link">+ Record an exception</summary><div className="mt-3"><ActionForm action={addExceptionAction} submitLabel="Record exception" size="sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="What is exempt" required><input name="item" className={inputCls} /></Field>
            <Field label="Clauses exempted" required><input name="clauses" className={inputCls} /></Field>
            <Field label="Reason" required><input name="reason" className={inputCls} /></Field>
            <Field label="Granting authority" required><input name="authority" className={inputCls} /></Field>
            <Field label="Start date" required><input type="date" name="startDate" className={inputCls} /></Field>
            <Field label="Review point"><input type="date" name="reviewPoint" className={inputCls} /></Field>
          </div>
        </ActionForm></div></details>
      </Card>
    </div>
  );
}
