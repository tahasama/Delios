import { Select } from "@/components/select";
import Link from "next/link";
import { SwitchControl } from "@/components/switch";
import { ActionForm } from "@/components/form";
import { ToneChip, inputCls } from "@/components/ui";
import { cn } from "@/lib/core/utils";
import {
  controlFrom,
  policiesFrom,
  MODE_LABEL,
  CONFIRMABLE,
  CONFIRM_KEY,
  SKIPPABLE,
  SKIP_KEY,
  PEOPLE_KEY,
  PEOPLE_MODE_LABEL,
  PROJECT_KEY,
  effectiveAnswer,
  PROJECT_MODE_LABEL,
  STAMP_KINDS,
  STAMP_COMMENTS_KEY,
  STAMP_SHOWS,
  POLICIES,
  roomItemOf,
  type ControlMode,
  type ProjectMode,
} from "@/lib/settings/control-activities";
import { setControlActivitiesAction, setPolicyAction } from "@/lib/settings/forms-how-it-works";
import { ESCALATE_AFTER_KEY, DEFAULT_ESCALATE_AFTER } from "@/lib/actions/escalation";

/** Where the answers on a form are read from, to mark the ones changed. */
export type AnswerSource = {
  target: "project" | "defaults";
  answers: Map<string, string>;
  /** For a project: the defaults it is compared with (none: the app's own). */
  base?: Record<string, string> | null;
  /** For a project: the answers the organization keeps fixed (their switches' keys), read only here. */
  fixed?: string[];
};

const FIXED_NOTE = "The organization keeps this the same on every project: an administrator changes it in the organization’s Settings.";
const sheetHead = "flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6";
const footer = "border-t border-line px-5 py-3 sm:px-6";

/** On a project, whether the organization keeps this answer the same on every project. */
export function isFixedAnswer(source: AnswerSource, key: string): boolean {
  return source.target === "project" && (source.fixed ?? []).includes(roomItemOf(key) ?? key);
}

/**
 * Where one answer comes from, as a chip, only where it is not simply the default: "changed here" (a project), "ours"
 * (the defaults), "the organization's" (kept fixed). An answer as the defaults carries nothing; the sheet says so once.
 */
export function AnswerFrom({ source, of }: { source: AnswerSource; of: string }) {
  const { target, answers, base } = source;
  if (isFixedAnswer(source, of)) return <ToneChip tone="idle">the organization&rsquo;s</ToneChip>;
  const value = effectiveAnswer(of, answers.get(of));
  if (target === "defaults") return value !== effectiveAnswer(of, null) ? <ToneChip tone="moving">ours</ToneChip> : null;
  if (value === effectiveAnswer(of, base?.[of])) return null;
  return <ToneChip tone="moving">changed here</ToneChip>;
}

/** What an unmarked answer is, said once at the head of a sheet. */
function unmarked(source: AnswerSource) {
  if (source.target === "defaults") return "an answer changed from the app’s own is marked “ours”";
  return `an answer changed from ${source.base ? "the organization’s defaults" : "the app’s own"} is marked “changed here”`;
}

/** One question about how the project works, its answers side by side, the app's opinion first. */
export function PolicyChoice({ source, policyKey }: { source: AnswerSource; policyKey: string }) {
  const policy = POLICIES.find((one) => one.key === policyKey);
  if (!policy) return null;
  const value = policiesFrom(source.answers).find((one) => one.policy.key === policyKey)?.value;
  const fixed = isFixedAnswer(source, policyKey);
  return (
    <fieldset disabled={fixed} className="min-w-0 space-y-2 disabled:opacity-70">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold text-slate-800">{policy.title}</p>
        <AnswerFrom source={source} of={policyKey} />
      </div>
      <p className="text-xs leading-5 text-slate-600">{policy.text}</p>
      {fixed ? <p className="text-[11px] leading-5 text-slate-500">{FIXED_NOTE}</p> : null}
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
    </fieldset>
  );
}

/** Which stamps, when the PDF is stamped, and whether a verdict's comments go with its stamp. */
export function StampChoices({ source }: { source: AnswerSource }) {
  const fixed = isFixedAnswer(source, "POLICY_PDF_STAMP");
  return (
    <fieldset disabled={fixed} className="min-w-0 space-y-2 disabled:opacity-70">
      <input type="hidden" name="stamps" value="1" />
      <p className="text-sm font-semibold text-slate-800">A review's stamp</p>
      <p className="text-xs leading-5 text-slate-600">
        Put on the PDF when its review is decided: an engagement, so it shows what you choose. The standing verdict always leads.
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        {[...STAMP_KINDS, ...STAMP_SHOWS].map((kind) => (
          <label key={kind.key} className="flex cursor-pointer items-start gap-2.5 rounded-md px-3 py-2 ring-1 ring-line hover:bg-tint-soft has-checked:bg-tint-soft">
            <SwitchControl name={kind.key} defaultChecked={effectiveAnswer(kind.key, source.answers.get(kind.key)) === "ON"} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-slate-800">{kind.label}</span>
              <span className="block text-xs text-slate-600">{kind.text}</span>
            </span>
            <AnswerFrom source={source} of={kind.key} />
          </label>
        ))}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-3 py-2 ring-1 ring-line hover:bg-tint-soft has-checked:bg-tint-soft md:col-span-2">
          <SwitchControl name={STAMP_COMMENTS_KEY} defaultChecked={effectiveAnswer(STAMP_COMMENTS_KEY, source.answers.get(STAMP_COMMENTS_KEY)) === "ON"} className="mt-0.5" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-slate-800">Why: the comments</span>
            <span className="block text-xs text-slate-600">
              A verdict that carries comments (accepted with comments, rejected) says so on the stamp, and the comments are listed on a last page of the PDF.
            </span>
          </span>
          <AnswerFrom source={source} of={STAMP_COMMENTS_KEY} />
        </label>
      </div>
    </fieldset>
  );
}

/** Which stamps are on, in words, for whoever only reads. */
export function stampsSaid(answers: Map<string, string>): string {
  const on = STAMP_KINDS.filter((kind) => effectiveAnswer(kind.key, answers.get(kind.key)) === "ON").map((kind) => kind.label.toLowerCase());
  const shows = STAMP_SHOWS.filter((one) => effectiveAnswer(one.key, answers.get(one.key)) === "ON").map((one) => one.label.toLowerCase());
  const comments = effectiveAnswer(STAMP_COMMENTS_KEY, answers.get(STAMP_COMMENTS_KEY)) === "ON";
  return `${on.length ? `A review's stamp when ${on.join(", ")}: the standing verdict${shows.length ? `, ${shows.join(", ")}` : ""}` : "No review is stamped"}${on.length && comments ? "; the comments on a last page" : ""}.`;
}

/** The answer chosen to one question, in words, for whoever only reads. */
export function policySaid(answers: Map<string, string>, policyKey: string): string {
  const row = policiesFrom(answers).find((one) => one.policy.key === policyKey);
  return row?.policy.options.find((one) => one.value === row.value)?.label.replace(/ — recommended$/, "").replace(/ \(recommended\)$/, "") ?? "";
}

/**
 * Who carries out each act, and how the project works: one form for a project (Settings → Control room) and for the
 * organization's defaults for new projects (the organization's page). An answer changed from the defaults is marked.
 *
 * Read only, every answer is plain words.
 */
export function HowItWorks({
  target,
  answers,
  follows,
  base,
  fixed = [],
  readOnly = false,
}: AnswerSource & {
  /** The project has a control function. For the defaults, read as a project that has one. */
  follows: boolean;
  /** Whoever may not change it reads every answer in words. */
  readOnly?: boolean;
}) {
  const source: AnswerSource = { target, answers, base, fixed };
  const { projectMode, set, rows } = controlFrom(answers, follows);
  const defaults = target === "defaults";
  const hidden = { target };
  const policiesHere = POLICIES;
  const stampsHere = true;
  const escalateAfter = answers.get(ESCALATE_AFTER_KEY) ?? String(DEFAULT_ESCALATE_AFTER);
  const whoFixed = isFixedAnswer(source, "WHO_DOES_WHAT");

  const modes: (ProjectMode | "FOLLOW")[] = defaults ? ["FOLLOW", "CONTROL", "SELF", "CUSTOM"] : ["CONTROL", "SELF", "CUSTOM"];
  const modeText: Record<ProjectMode | "FOLLOW", string> = {
    FOLLOW: "Each new project reads whether somebody holds the control function: the control function when someone does, the people doing the work when nobody does.",
    CONTROL: "Every act below goes through the control function. People ask; the control function carries it out.",
    SELF: "Every act below is done by whoever is doing the work: the author, the reviewer, whoever asked.",
    CUSTOM: "Each act on its own. Put the ones you want with the control function and leave the rest with the work.",
  };
  const checked = defaults && !set ? "FOLLOW" : projectMode;
  const carrier = (key: string, controlDoes: boolean) =>
    key === PEOPLE_KEY ? PEOPLE_MODE_LABEL[controlDoes ? "CONTROL" : "SELF"] : controlDoes ? "The control function" : "The people doing the work";
  const confirmTitle = (key: string) => (key === PEOPLE_KEY ? "Confirmation by whoever holds Manage is necessary" : "Requests need confirming by whoever holds Manage");

  const whoHead = (
    <div className={sheetHead}>
      <h2 className="stencil mr-1 text-slate-500">Who carries the acts out</h2>
      <span className="text-[11px] text-slate-500">
        {defaults ? "what a new project starts with" : set ? "answered for this project" : `not answered yet: read from the project, which ${follows ? "has a" : "has no"} control function`}
        {readOnly ? "" : ` · ${unmarked(source)}`}
      </span>
      <span className="ml-auto"><AnswerFrom source={source} of={PROJECT_KEY} /></span>
    </div>
  );
  const howHead = (
    <div className={sheetHead}>
      <h2 className="stencil mr-1 text-slate-500">How {defaults ? "a project" : "this project"} works</h2>
      <span className="text-[11px] text-slate-500">
        what it means when people act; the app recommends the first answer
        {readOnly ? "" : ` · ${unmarked(source)}`}
      </span>
    </div>
  );

  // Read only: the same answers, in words.
  if (readOnly) {
    return (
      <div className="space-y-4">
        <section id="who-does-what" className="register register-sheet register-sheet-open scroll-mt-24">
          {whoHead}
          <p className="px-5 pt-3 text-[13px] font-medium text-slate-900 sm:px-6">{PROJECT_MODE_LABEL[projectMode]}</p>
          <ul className="divide-y divide-line">
            {rows.map(({ activity, controlDoes, confirm, off }) => (
              <li key={activity.key} className="px-5 py-2.5 text-xs leading-5 text-slate-600 sm:px-6">
                <span className="font-semibold text-slate-800">{activity.title}: </span>
                {off ? "left out on this project." : <>{carrier(activity.key, controlDoes).toLowerCase()}. {controlDoes ? activity.control : activity.self}</>}
                {CONFIRMABLE[activity.key] ? ` ${confirmTitle(activity.key)}: ${confirm ? "yes" : "no"}.` : ""}
              </li>
            ))}
          </ul>
        </section>
        {policiesHere.length || stampsHere ? (
          <section id="policies" className="register register-sheet register-sheet-open scroll-mt-24">
            {howHead}
            <ul className="divide-y divide-line">
              {policiesHere.map((one) => (
                <li key={one.key} className="px-5 py-2.5 text-xs leading-5 text-slate-600 sm:px-6">
                  <span className="font-semibold text-slate-800">{one.title}: </span>{policySaid(answers, one.key)}.
                </li>
              ))}
              {stampsHere ? <li className="px-5 py-2.5 text-xs leading-5 text-slate-600 sm:px-6">{stampsSaid(answers)}</li> : null}
              <li className="px-5 py-2.5 text-xs leading-5 text-slate-600 sm:px-6">
                <span className="font-semibold text-slate-800">When a discipline does not answer: </span>
                everyone concerned is notified after {escalateAfter} working days.
              </li>
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section id="who-does-what" className="register register-sheet register-sheet-open scroll-mt-24">
        {whoHead}
        <ActionForm action={setControlActivitiesAction} submitLabel="Save" hidden={hidden} className="space-y-0" footerClassName={footer}
          confirmText={defaults ? undefined : "Who carries out each act on this project changes as chosen here. Go ahead?"}>
          <fieldset disabled={whoFixed} className="min-w-0 disabled:opacity-70">
            {whoFixed ? <p className="px-5 pt-3 text-[11px] leading-5 text-slate-500 sm:px-6">{FIXED_NOTE}</p> : null}
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

            {/* Each act decides only while the answer above is "it depends"; on the other answers it is kept as it
                stands, ready for the day it is chosen again. */}
            <ul className="divide-y divide-line border-t border-line">
              {rows.map(({ activity, controlDoes, confirm, off }) => (
                <li key={activity.key} className="space-y-2 px-5 py-3.5 sm:px-6">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800">
                          {activity.title}
                          {off && !defaults ? <span className="ml-1.5 text-xs font-normal text-slate-500">left out on this project</span> : null}
                        </p>
                        <p className="mt-0.5 text-xs leading-5 text-slate-600">{activity.text}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          <span className="font-semibold text-slate-700">{carrier(activity.key, controlDoes)}:</span> {controlDoes ? activity.control : activity.self}
                        </p>
                      </div>
                      <Select
                        name={`mode:${activity.key}`}
                        defaultValue={controlDoes ? "CONTROL" : "SELF"}
                        className={cn(inputCls, "w-full sm:w-56")}
                        aria-label={`Who carries out ${activity.title}`}
                      >
                        {(["CONTROL", "SELF"] as ControlMode[]).map((one) => (
                          <option key={one} value={one}>{activity.key === PEOPLE_KEY ? PEOPLE_MODE_LABEL[one] : MODE_LABEL[one]}</option>
                        ))}
                      </Select>
                    </div>
                  {/* An act whose absence leaves the record whole may be left out altogether. */}
                  {SKIPPABLE[activity.key] ? (
                    <label className="flex cursor-pointer items-start gap-2 rounded-md bg-tint-soft px-3 py-2.5 text-xs leading-5 ring-1 ring-line">
                      <input type="hidden" name={`skipping:${activity.key}`} value="1" />
                      <SwitchControl name={`use:${activity.key}`} defaultChecked={!off} className="mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold text-slate-800">Used on this {defaults ? "new project" : "project"}</span>
                        <span className="block text-slate-600">Switched off: {SKIPPABLE[activity.key].off}</span>
                      </span>
                      <AnswerFrom source={source} of={SKIP_KEY(activity.key)} />
                    </label>
                  ) : null}
                  {/* A request may also need the say of whoever holds Manage. */}
                  {CONFIRMABLE[activity.key] ? (
                    <label className="flex cursor-pointer items-start gap-2 rounded-md bg-tint-soft px-3 py-2.5 text-xs leading-5 ring-1 ring-line">
                      <SwitchControl name={`confirm:${activity.key}`} defaultChecked={confirm} className="mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold text-slate-800">{confirmTitle(activity.key)}</span>
                        <span className="block text-slate-600">
                          {CONFIRMABLE[activity.key]}
                          {activity.key === PEOPLE_KEY
                            ? " Switched off: not necessary, they are on at once."
                            : controlDoes ? " It applies while the control function carries this out." : " It applies only once the control function carries this out; for now the people doing the work do."}
                          {" "}Whoever holds Manage is proposed first.
                        </span>
                      </span>
                      <AnswerFrom source={source} of={CONFIRM_KEY(activity.key)} />
                    </label>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">
              The acts one by one are used when the answer is &ldquo;it depends on the act&rdquo;.
            </p>
          </fieldset>
        </ActionForm>
      </section>

      <section id="policies" className="register register-sheet register-sheet-open scroll-mt-24">
        {howHead}
        <ActionForm action={setPolicyAction} submitLabel="Save" hidden={hidden} className="space-y-0" footerClassName={footer}>
          <ul className="divide-y divide-line">
            {policiesHere.map((one) => (
              <li key={one.key} className="px-5 py-4 sm:px-6"><PolicyChoice source={source} policyKey={one.key} /></li>
            ))}
            {stampsHere ? <li className="px-5 py-4 sm:px-6"><StampChoices source={source} /></li> : null}
            <li className="px-5 py-4 sm:px-6">
              <fieldset disabled={isFixedAnswer(source, ESCALATE_AFTER_KEY)} className="min-w-0 space-y-2 disabled:opacity-70">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-semibold text-slate-800">When a discipline does not answer</p>
                  <AnswerFrom source={source} of={ESCALATE_AFTER_KEY} />
                </div>
                <p className="text-xs leading-5 text-slate-600">
                  An action&rsquo;s day passed with a discipline&rsquo;s documents missing, and nobody of that discipline confirmed whether the work went
                  ahead. After this many working days, its people, whoever holds Manage and the control function are all notified, once. The app&rsquo;s default
                  is {DEFAULT_ESCALATE_AFTER}.
                </p>
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <span className="shrink-0">Notify after</span>
                  <input type="number" name={ESCALATE_AFTER_KEY} min={1} max={60} defaultValue={escalateAfter} className={cn(inputCls, "w-20")} />
                  <span className="shrink-0">working days</span>
                </label>
                {isFixedAnswer(source, ESCALATE_AFTER_KEY) ? <p className="text-[11px] leading-5 text-slate-500">{FIXED_NOTE}</p> : null}
              </fieldset>
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
