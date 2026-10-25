import Link from "next/link";
import { Copy, RotateCcw } from "lucide-react";
import { Select } from "@/components/select";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { ActionForm } from "@/components/form";
import { Field, ToneChip, inputCls } from "@/components/ui";
import { Choice } from "@/app/(app)/settings/flow/choice";
import { projectDefaults, isDefaultsAnswer } from "@/lib/organization/defaults";
import { libertyOrFail } from "@/lib/organization/liberty";
import { makeDefaultsAction, putBackDefaultsAction, resetDefaultsAction } from "@/lib/organization/forms";
import { setOrgScheduleDaysAction, setRoomAnswerAction } from "@/lib/settings/forms-how-it-works";
import { adminProjects, keptCopies, organizationDays } from "@/lib/settings/api-admin";
import {
  controlFrom, effectiveAnswer, roomItemOf, CONTROL_ACTIVITIES, CONFIRMABLE, CONFIRM_KEY, POLICIES, PEOPLE_KEY,
  PEOPLE_MODE_LABEL, PROJECT_KEY, PROJECT_MODE_LABEL, SKIPPABLE,
} from "@/lib/settings/control-activities";
import { ESCALATE_AFTER_KEY, DEFAULT_ESCALATE_AFTER, NOTIFY_AT_KEY, DEFAULT_NOTIFY_AT, NOTIFY_AT_TITLE } from "@/lib/actions/escalation";
import { fmtDate } from "@/lib/core/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Defaults for new projects" };

const clean = (label: string) => label.replace(/ — recommended$/, "").replace(/ \(recommended\)$/, "");
const FOLLOW_LABEL = "As each project is set up";
/** The kind a copy of the defaults is kept under (backend `OrganizationDefaults.Kind`). */
const KEPT = "DEFAULTS";
const APP_DAYS = 7;

/**
 * What a new project of ours starts with (docs/ORGANIZATIONS.md, "Defaults"), the whole of it on one page, in the app's
 * one way of answering (owner): each answer a `Choice`, its answers side by side, "From now on… Instead of…" before it
 * is saved, the same as the organization's Control room, which holds the same answers step by step. An answer we
 * changed says so, with the app's own beside it. The plate starts the defaults from a project, or puts them back to the
 * app's own, each asked in a sheet of its own under it. Copied when a project opens; never changes one already open.
 */
export default async function DefaultsPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  await requireOrgAdmin();
  const { open: opening } = await searchParams;
  // A failed read is said by the page (organization/error.tsx), never read as "no projects" or "the app's own".
  const [defaults, projects, switches, days, kept] = await Promise.all([
    projectDefaults({ orFail: true }), adminProjects(), libertyOrFail(), organizationDays(), keptCopies(KEPT),
  ]);
  const answers = new Map(Object.entries(defaults?.values ?? {}));
  const reading = controlFrom(answers, true);
  const app = controlFrom(new Map(), true);
  const row = (key: string, from = reading) => from.rows.find((one) => one.activity.key === key);
  const actValue = (key: string, from = reading) => (row(key, from)?.off ? "OFF" : row(key, from)?.controlDoes ? "CONTROL" : "SELF");
  const open = projects.filter((p) => p.status === "ACTIVE");
  const ours = Object.keys(defaults?.values ?? {}).filter(isDefaultsAnswer).length;
  const room = switches.filter((one) => one.area === "Control room");
  const free = room.filter((one) => one.free).length;
  const source = defaults
    ? defaults.fromProject ? `Taken from ${defaults.fromProject}${defaults.edited ? ", then changed here" : ""}` : "Set here"
    : "The app's own";
  const mode = reading.set ? reading.projectMode : "FOLLOW";
  const hidden = (key: string) => ({ key, target: "defaults" });

  /** Beside an answer: "ours" with the app's own when we changed it, and that projects may not change it where fixed. */
  const mark = (key: string, changed: boolean, appSays: string) => {
    const fixed = room.some((one) => one.key === (roomItemOf(key) ?? key) && !one.free);
    if (!changed && !fixed) return null;
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 align-middle font-normal">
        {changed ? <><ToneChip tone="moving">ours</ToneChip><span className="text-[11px] text-slate-500">the app&rsquo;s: {appSays}</span></> : null}
        {fixed ? <span className="text-[11px] text-slate-500">· the same on every project</span> : null}
      </span>
    );
  };
  const band = (title: string, said: string) => (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
      <h2 className="stencil mr-1 text-slate-500">{title}</h2>
      <span className="text-[11px] text-slate-500">{said}</span>
    </div>
  );
  const strip = (form: string, act: string) => (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
      <Link href="/organization/defaults" scroll={false} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
      <button type="submit" form={form} data-on="true" className="ask">{act}</button>
    </div>
  );

  const modeOptions = [
    { value: "FOLLOW", label: FOLLOW_LABEL, text: "Each new project reads whether somebody holds the control function: the control function when someone does, the people doing the work when nobody does." },
    { value: "CONTROL", label: PROJECT_MODE_LABEL.CONTROL, text: "Every act below goes through the control function. People ask; the control function carries it out." },
    { value: "SELF", label: PROJECT_MODE_LABEL.SELF, text: "Every act below is done by whoever is doing the work: the author, the reviewer, whoever asked." },
    { value: "CUSTOM", label: "It depends on the act", text: "Each act on its own, as set below." },
  ];
  const modeSaid = (value: string) => modeOptions.find((one) => one.value === value)?.label.toLowerCase() ?? "";

  return (
    <div className="space-y-4">
      {/* The plate: what the defaults are, its two acts, then the figures that say where they stand. */}
      <header className="register register-sheet register-sheet-open">
        <div className="flex flex-col gap-4 px-5 pt-5 pb-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="min-w-0">
            <h1 className="plate-title text-slate-950">Defaults for new projects</h1>
            <p className="plate-meta mt-1.5 max-w-2xl font-normal">
              What a project of ours starts with: who carries each act out, and how it works. Copied when the project opens; projects
              already open keep their own, and another organization&rsquo;s project follows its owner. The same answers, step by step, are in
              the <Link href="/organization/settings/flow" className="font-semibold text-link hover:underline">Control room</Link>; which ones a
              project may change is on <Link href="/organization/settings/may-change" className="font-semibold text-link hover:underline">What projects may change</Link>.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link href="/organization/defaults?open=from#from" scroll={false} aria-current={opening === "from" ? "true" : undefined} className="ask">
              <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Start from a project
            </Link>
            {defaults ? (
              <Link href="/organization/defaults?open=reset#reset" scroll={false} aria-current={opening === "reset" ? "true" : undefined} className="ask">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Back to the app&rsquo;s own
              </Link>
            ) : null}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
          {[
            { term: "Where they come from", value: source, said: defaults ? `last changed ${fmtDate(defaults.at)} by ${defaults.by}` : "nothing changed by the organization yet" },
            { term: "Answers of our own", value: String(ours), said: ours ? "differ from the app's own, marked “ours”" : "every answer is the app's own" },
            { term: "Who carries the acts out", value: modeOptions.find((one) => one.value === mode)?.label ?? "", said: mode === "CUSTOM" ? "each act as set below" : "every act the same way" },
            { term: "Projects may change", value: `${free} of ${room.length}`, said: "answers; the rest are the same on every project" },
          ].map((f) => (
            <div key={f.term} className="bg-surface px-5 py-3 sm:px-6">
              <dt className="stencil text-slate-500">{f.term}</dt>
              <dd className="mt-1 text-[13px] font-medium text-slate-900">{f.value}</dd>
              <dd className="text-[11px] text-slate-500">{f.said}</dd>
            </div>
          ))}
        </dl>
      </header>

      {/* Starting from a project: a sheet of its own, opened from the plate; it becomes the form, and is the question. */}
      {opening === "from" ? (
        <section id="from" className="register register-sheet register-sheet-open scroll-mt-24" aria-labelledby="from-head">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <h2 id="from-head" className="stencil mr-1 text-slate-500">Start from a project</h2>
            <span className="text-[11px] text-slate-500">its answers on this page become the defaults, all at once; nothing else of it comes</span>
          </div>
          {open.length ? (
            <>
              <ActionForm id="defaults-from" action={makeDefaultsAction} hideSubmit className="asking space-y-4 px-5 py-5 sm:px-6">
                <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                  <Field label="Project" required hint="open projects of ours">
                    <Select name="projectId" required defaultValue="" className={inputCls}>
                      <option value="" disabled>Choose…</option>
                      {open.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Why" required hint="kept with the defaults it replaces">
                    <input name="reason" required maxLength={300} autoComplete="off" className={inputCls} />
                  </Field>
                </div>
                <div className="choice-confirm space-y-1 rounded-md px-3 py-2.5">
                  <p className="text-xs leading-5 text-slate-700">
                    <span className="font-semibold text-slate-900">From now on: </span>
                    new projects start with that project&rsquo;s answers to every question below.
                  </p>
                  <p className="text-xs leading-5 text-slate-500">
                    Instead of: {defaults ? `the defaults as they stand, ${source.toLowerCase()}, ${ours} ${ours === 1 ? "answer" : "answers"} of our own, kept below and may be put back` : "the app's own answers"}.
                    Projects already open keep theirs.
                  </p>
                </div>
              </ActionForm>
              {strip("defaults-from", "Make its answers the defaults")}
            </>
          ) : (
            <p className="px-5 py-4 text-xs leading-5 text-slate-600 sm:px-6">No project of ours is open, so there is none to start from. The answers below can be changed one by one.</p>
          )}
        </section>
      ) : null}

      {/* Back to the app's own: asked in its sheet, saying plainly that nothing of ours is kept. */}
      {opening === "reset" && defaults ? (
        <section id="reset" className="register register-sheet register-sheet-open scroll-mt-24" aria-labelledby="reset-head">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <h2 id="reset-head" className="stencil mr-1 text-slate-500">Back to the app&rsquo;s own</h2>
            <span className="text-[11px] text-slate-500">every answer below goes back to the app&rsquo;s own; ours are kept</span>
          </div>
          <ActionForm id="defaults-reset" action={resetDefaultsAction} hideSubmit className="asking space-y-4 px-5 py-5 sm:px-6">
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <Field label="Why" required hint="kept with the defaults it puts away">
                <input name="reason" required maxLength={300} autoComplete="off" className={inputCls} />
              </Field>
            </div>
            <div className="choice-confirm space-y-1 rounded-md px-3 py-2.5">
              <p className="text-xs leading-5 text-slate-700">
                <span className="font-semibold text-slate-900">From now on: </span>new projects start with the app&rsquo;s own answers.
              </p>
              <p className="text-xs leading-5 text-slate-500">
                Instead of: ours, {source.toLowerCase()}, {ours} {ours === 1 ? "answer" : "answers"} of our own. They are kept below, and may be
                put back. Projects already open keep theirs.
              </p>
            </div>
          </ActionForm>
          {strip("defaults-reset", "Go back to the app's own")}
        </section>
      ) : null}

      {/* Who carries each act out: the answer for all of them, then each act, its confirmation under it. */}
      <section id="who-does-what" className="register register-sheet register-sheet-open scroll-mt-24">
        {band("Who carries the acts out", "the answer above sets every act; changing one act on its own makes it “it depends on the act”")}
        <ul className="divide-y divide-line px-5 py-4 sm:px-6">
          <Choice title="Who carries the acts out" options={modeOptions} value={mode} action={setRoomAnswerAction} hidden={hidden(PROJECT_KEY)}
            mark={mark(PROJECT_KEY, reading.set, FOLLOW_LABEL.toLowerCase())} />
        </ul>
        <ul className="divide-y divide-line border-t border-line px-5 py-4 sm:px-6">
          {CONTROL_ACTIVITIES.flatMap((act) => {
            const people = act.key === PEOPLE_KEY;
            const options = [
              { value: "CONTROL", label: people ? PEOPLE_MODE_LABEL.CONTROL : "The control function", text: act.control },
              { value: "SELF", label: people ? PEOPLE_MODE_LABEL.SELF : "The people doing the work", text: act.self },
              ...(SKIPPABLE[act.key] ? [{ value: "OFF", label: "Left out", text: SKIPPABLE[act.key].off }] : []),
            ];
            const value = actValue(act.key);
            const appValue = actValue(act.key, app);
            const said = (v: string) => options.find((one) => one.value === v)?.label.toLowerCase() ?? "";
            const items = [
              <Choice key={act.key} title={act.title} options={options} value={value} action={setRoomAnswerAction} hidden={hidden(act.key)}
                mark={mark(act.key, value !== appValue, said(appValue))} />,
            ];
            if (CONFIRMABLE[act.key]) {
              const key = CONFIRM_KEY(act.key);
              const confirm = effectiveAnswer(key, answers.get(key));
              const appConfirm = effectiveAnswer(key, null);
              items.push(
                <Choice key={key} title={`${act.title}: confirmed by whoever holds Manage`} value={confirm} action={setRoomAnswerAction} hidden={hidden(key)}
                  options={[
                    { value: "ON", label: "Yes", text: CONFIRMABLE[act.key] },
                    { value: "OFF", label: "No", text: people ? "Nobody confirms: they are on the project at once." : "Nobody confirms: the control function applies it." },
                  ]}
                  mark={mark(key, confirm !== appConfirm, appConfirm === "ON" ? "yes" : "no")} />,
              );
            }
            return items;
          })}
        </ul>
      </section>

      {/* How a project works: each question its answers side by side, the app's opinion first. */}
      <section id="policies" className="register register-sheet register-sheet-open scroll-mt-24">
        {band("How a project works", "what it means when people act; the app recommends the first answer")}
        <ul className="divide-y divide-line px-5 py-4 sm:px-6">
          {POLICIES.map((policy) => {
            const options = policy.options.map((one) => ({ value: one.value, label: clean(one.label), text: one.text }));
            const value = effectiveAnswer(policy.key, answers.get(policy.key));
            const appValue = effectiveAnswer(policy.key, null);
            return (
              <Choice key={policy.key} title={policy.title} options={options} value={value} action={setRoomAnswerAction} hidden={hidden(policy.key)}
                mark={mark(policy.key, value !== appValue, options.find((one) => one.value === appValue)?.label.toLowerCase() ?? "")} />
            );
          })}
          <Choice title="A discipline still silent after the action's day is notified again, with whoever holds Manage and the control function, after"
            value={answers.get(ESCALATE_AFTER_KEY) ?? String(DEFAULT_ESCALATE_AFTER)} unit="working days" min={1} max={60}
            action={setRoomAnswerAction} hidden={hidden(ESCALATE_AFTER_KEY)}
            mark={mark(ESCALATE_AFTER_KEY, !!answers.get(ESCALATE_AFTER_KEY) && answers.get(ESCALATE_AFTER_KEY) !== String(DEFAULT_ESCALATE_AFTER), `${DEFAULT_ESCALATE_AFTER} working days`)} />
          <Choice title={NOTIFY_AT_TITLE}
            value={answers.get(NOTIFY_AT_KEY) ?? String(DEFAULT_NOTIFY_AT)} unit=":00, the project's time" min={0} max={23}
            action={setRoomAnswerAction} hidden={hidden(NOTIFY_AT_KEY)}
            mark={mark(NOTIFY_AT_KEY, !!answers.get(NOTIFY_AT_KEY) && answers.get(NOTIFY_AT_KEY) !== String(DEFAULT_NOTIFY_AT), `${String(DEFAULT_NOTIFY_AT).padStart(2, "0")}:00`)} />
        </ul>
      </section>

      {/* The days around an action: the organization's, read live by every project that did not change its own. */}
      <section id="days" className="register register-sheet register-sheet-open scroll-mt-24">
        {band("The days around an action", "every project reads these as they stand, unless it changed its own where free; changing them reads each project's actions again")}
        <ul className="divide-y divide-line px-5 py-4 sm:px-6">
          <Choice title="A document is needed before the action's day" value={String(days.lead)} unit="days" min={0} max={365} field="leadDays"
            action={setOrgScheduleDaysAction} hidden={{}} mark={mark("LEAD_DAYS", days.lead !== APP_DAYS, `${APP_DAYS} days`)} />
          <Choice title="The action is at risk from" value={String(days.risk)} unit="days before" min={0} max={365} field="riskDays"
            action={setOrgScheduleDaysAction} hidden={{}} mark={mark("RISK_WINDOW", days.risk !== APP_DAYS, `${APP_DAYS} days`)} />
        </ul>
        <p className="border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">
          Unless the requirements list gives a document its own. A project&rsquo;s own days are on its Control room; here they are the organization&rsquo;s.
        </p>
      </section>

      <p className="text-xs text-slate-500">
        Where a new project&rsquo;s site starts (country, time zone, days off) is on the organization&rsquo;s{" "}
        <Link href="/organization/settings/calendar#place" className="font-semibold text-link hover:underline">Calendar</Link>.
      </p>

      {/* What replacing the defaults kept (owner: a reset keeps a copy): each as it was, when, by whom, why, and its way back. */}
      {kept.length ? (
        <section id="kept" className="register register-sheet register-sheet-open scroll-mt-24">
          {band("Kept when replaced", "the defaults as they were before each was replaced; one may be put back")}
          <ul className="divide-y divide-line">
            {kept.map((one) => (
              <li key={one.id} className="grid grid-cols-1 items-start gap-x-6 gap-y-2 px-5 py-3 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] sm:px-6">
                <div>
                  <p className="text-[13px] font-semibold text-slate-800">Kept {fmtDate(one.keptAt)}</p>
                  <p className="text-xs leading-5 text-slate-600">by {one.keptByName}: {one.reason}</p>
                </div>
                {one.putBackAt ? (
                  <p className="text-xs leading-5 text-slate-600">Put back {fmtDate(one.putBackAt)}, by {one.putBackByName}: {one.putBackReason}</p>
                ) : (
                  <details className="group">
                    <summary className="ask w-fit cursor-pointer list-none">Put these back as the defaults</summary>
                    <ActionForm action={putBackDefaultsAction} submitLabel="Put them back" size="sm" hidden={{ copyId: one.id }}
                      confirmText={`From now on: new projects start with the defaults as they were on ${fmtDate(one.keptAt)}. Instead of: the defaults as they stand, which are kept in their turn. Go ahead?`}
                      className="mt-2 flex flex-wrap items-end gap-2 space-y-0">
                      <label className="min-w-64 flex-1">
                        <span className="sr-only">Why</span>
                        <input name="reason" required maxLength={300} placeholder="Why they come back" className={inputCls} />
                      </label>
                    </ActionForm>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
