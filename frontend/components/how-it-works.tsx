import Link from "next/link";
import { ActionForm } from "@/components/form";
import { ToneChip, inputCls } from "@/components/ui";
import {
  controlFrom,
  policiesFrom,
  MODE_LABEL,
  CONFIRMABLE,
  CONFIRM_KEY,
  PROJECT_KEY,
  effectiveAnswer,
  PROJECT_MODE_LABEL,
  STAMP_KINDS,
  STAMP_COMMENTS_KEY,
  type ControlMode,
  type ProjectMode,
} from "@/lib/settings/control-activities";
import { setControlActivitiesAction, setPolicyAction } from "@/lib/settings/forms-how-it-works";
import { ESCALATE_AFTER_KEY, DEFAULT_ESCALATE_AFTER } from "@/lib/actions/escalation";

/**
 * Who carries out each act, and how the project works: one form for a project (Settings → Control room) and for the
 * organization's defaults for new projects (the organization's page). Each answer says where it comes from: on a
 * project, the defaults or changed here; on the defaults, the app's own or ours.
 */
export function HowItWorks({
  target,
  answers,
  follows,
  base,
}: {
  target: "project" | "defaults";
  /** The answers shown: the project's, or the defaults'. */
  answers: Map<string, string>;
  /** The project has a control function. For the defaults, read as a project that has one. */
  follows: boolean;
  /** For a project: the defaults it is compared with (none: the app's own). */
  base?: Record<string, string> | null;
}) {
  const { projectMode, set, rows } = controlFrom(answers, follows);
  const chosen = policiesFrom(answers);
  const escalateAfter = answers.get(ESCALATE_AFTER_KEY);
  const defaults = target === "defaults";
  const hidden = { target };

  /** Where one answer comes from, as a chip. */
  const from = (key: string) => {
    const value = effectiveAnswer(key, answers.get(key));
    if (defaults) return value !== effectiveAnswer(key, null) ? <ToneChip tone="moving">ours</ToneChip> : <ToneChip tone="idle">the app&rsquo;s</ToneChip>;
    if (value === effectiveAnswer(key, base?.[key])) return <ToneChip tone="idle">{base ? "as the defaults" : "the app’s"}</ToneChip>;
    return <ToneChip tone="moving">changed here</ToneChip>;
  };

  const modes: (ProjectMode | "FOLLOW")[] = defaults ? ["FOLLOW", "CONTROL", "SELF", "CUSTOM"] : ["CONTROL", "SELF", "CUSTOM"];
  const modeText: Record<ProjectMode | "FOLLOW", string> = {
    FOLLOW: "Each new project reads whether somebody holds the control function: Document Control when someone does, the people doing the work when nobody does.",
    CONTROL: "Everything on the list below goes through Document Control. People ask; Document Control carries it out.",
    SELF: "Everything on the list below is done by whoever is doing the work — the author, the reviewer, whoever asked.",
    CUSTOM: "Each act on its own. Put the ones you want with Document Control and leave the rest with the work.",
  };
  const checked = defaults && !set ? "FOLLOW" : projectMode;

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Who carries the acts out</span>
          <span className="text-[11px] text-slate-500">
            {defaults ? "what a new project starts with" : set ? "answered for this project" : `not answered yet: read from the project, which ${follows ? "has" : "has no"} control function`}
          </span>
          <span className="ml-auto">{from(PROJECT_KEY)}</span>
        </div>
        <ActionForm action={setControlActivitiesAction} submitLabel="Save" hidden={hidden} className="space-y-0">
          <div className="space-y-2 px-5 py-4 sm:px-6">
            {modes.map((mode) => (
              <label
                key={mode}
                className="flex cursor-pointer items-start gap-2.5 rounded-md px-3 py-2.5 ring-1 ring-line hover:bg-tint-soft has-checked:bg-tint-soft has-checked:ring-brand-line"
              >
                <input type="radio" name="projectMode" value={mode} defaultChecked={checked === mode} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-semibold text-slate-800">
                    {mode === "FOLLOW" ? "As each project is set up (the app’s default)" : PROJECT_MODE_LABEL[mode]}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-slate-600">{modeText[mode]}</span>
                </span>
              </label>
            ))}
          </div>

          {/* The list decides each act while the answer above is "it depends". On the other answers it is kept as it
              stands, ready for the day it is chosen again. */}
          <ul className="divide-y divide-line border-t border-line">
            {rows.map(({ activity, mode, controlDoes, confirm, off }) => (
              <li key={activity.key} className="space-y-2 px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">
                      {activity.title}
                      {off && !defaults ? <span className="ml-1.5 text-xs font-normal text-slate-500">left out on this project (<Link href="/settings/flow" className="underline">Control room</Link>)</span> : null}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-slate-600">{activity.text}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      <span className="font-semibold text-slate-700">{controlDoes ? "Document Control" : "The people doing the work"}:</span>{" "}
                      {controlDoes ? activity.control : activity.self}
                    </p>
                  </div>
                  <select
                    name={`mode:${activity.key}`}
                    defaultValue={mode === "FOLLOW" ? (follows ? "CONTROL" : "SELF") : mode}
                    className={`${inputCls} w-full sm:w-56`}
                    aria-label={`Who carries out ${activity.title}`}
                  >
                    {(["CONTROL", "SELF"] as ControlMode[]).map((one) => (
                      <option key={one} value={one}>{MODE_LABEL[one]}</option>
                    ))}
                  </select>
                </div>
                {/* With Document Control, a request may also need management's say. */}
                {CONFIRMABLE[activity.key] ? (
                  <label className="flex cursor-pointer items-start gap-2 rounded-md bg-tint-soft px-3 py-2.5 text-xs leading-5 ring-1 ring-line">
                    <input type="checkbox" name={`confirm:${activity.key}`} defaultChecked={confirm} className="mt-1" />
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-slate-800">Requests need management confirmation</span>
                      <span className="block text-slate-600">
                        {CONFIRMABLE[activity.key]} Only with Document Control{controlDoes ? "" : " — not used while the people doing the work carry it out"}.
                        {" "}Whoever holds Manage is proposed first.
                      </span>
                    </span>
                    {from(CONFIRM_KEY(activity.key))}
                  </label>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">
            The acts one by one are used when the answer is &ldquo;it depends on the act&rdquo;.
          </p>
        </ActionForm>
      </section>

      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">How {defaults ? "a project" : "this project"} works</span>
          <span className="text-[11px] text-slate-500">what it means when people act; the app recommends the first answer</span>
        </div>
        <ActionForm action={setPolicyAction} submitLabel="Save" hidden={hidden} className="space-y-0">
          <ul className="divide-y divide-line">
            {chosen.map(({ policy, value }) => (
              <li key={policy.key} className="space-y-2 px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-semibold text-slate-800">{policy.title}</p>
                  {from(policy.key)}
                </div>
                <p className="text-xs leading-5 text-slate-600">{policy.text}</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {policy.options.map((option) => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-start gap-2.5 rounded-md px-3 py-2.5 ring-1 ring-line hover:bg-tint-soft has-checked:bg-tint-soft has-checked:ring-brand-line"
                    >
                      <input type="radio" name={policy.key} value={option.value} defaultChecked={value === option.value} className="mt-0.5" />
                      <span>
                        <span className="block text-[13px] font-semibold text-slate-800">{option.label}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-slate-600">{option.text}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </li>
            ))}
            {/* Which stamps, when the PDF is stamped, and whether a verdict's comments go with its stamp. */}
            <li className="space-y-2 px-5 py-4 sm:px-6">
              <input type="hidden" name="stamps" value="1" />
              <p className="text-sm font-semibold text-slate-800">Which stamps</p>
              <p className="text-xs leading-5 text-slate-600">Used when the PDF is stamped (above). Untick a stamp to leave it off.</p>
              <div className="grid gap-2 md:grid-cols-2">
                {STAMP_KINDS.map((kind) => (
                  <label key={kind.key} className="flex cursor-pointer items-start gap-2.5 rounded-md px-3 py-2 ring-1 ring-line hover:bg-tint-soft has-checked:bg-tint-soft">
                    <input type="checkbox" name={kind.key} defaultChecked={effectiveAnswer(kind.key, answers.get(kind.key)) === "ON"} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-slate-800">{kind.label}</span>
                      <span className="block text-xs text-slate-600">{kind.text}</span>
                    </span>
                    {from(kind.key)}
                  </label>
                ))}
                <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-3 py-2 ring-1 ring-line hover:bg-tint-soft has-checked:bg-tint-soft md:col-span-2">
                  <input type="checkbox" name={STAMP_COMMENTS_KEY} defaultChecked={effectiveAnswer(STAMP_COMMENTS_KEY, answers.get(STAMP_COMMENTS_KEY)) === "ON"} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-slate-800">The comments too</span>
                    <span className="block text-xs text-slate-600">
                      A stamp whose verdict carries comments (accepted with comments, rejected) says so, and the comments are listed on a last page of the PDF.
                    </span>
                  </span>
                  {from(STAMP_COMMENTS_KEY)}
                </label>
              </div>
            </li>
            <li className="space-y-2 px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-semibold text-slate-800">When a discipline does not answer</p>
                {from(ESCALATE_AFTER_KEY)}
              </div>
              <p className="text-xs leading-5 text-slate-600">
                An action&rsquo;s day passed with a discipline&rsquo;s documents missing, and nobody of that discipline confirmed whether the work went
                ahead. After this many working days, its people, management and Document Control are all notified, once. The app&rsquo;s default
                is {DEFAULT_ESCALATE_AFTER}.
              </p>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                Notify after
                <input type="number" name={ESCALATE_AFTER_KEY} min={1} max={60} defaultValue={escalateAfter ?? DEFAULT_ESCALATE_AFTER} className={`${inputCls} w-20`} />
                working days
              </label>
            </li>
          </ul>
        </ActionForm>
      </section>
    </div>
  );
}

/** The way from a project's settings to the organization's defaults, for its administrators. */
export function DefaultsLink() {
  return <Link href="/organization/defaults" className="font-semibold text-link hover:underline">defaults for new projects</Link>;
}
