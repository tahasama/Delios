import { inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { HowItWorks, DefaultsLink, type AnswerSource } from "@/components/how-it-works";
import { NOT_SWITCHABLE } from "@/lib/settings/control-activities";
import { setStateNamesAction, resetProjectToDefaultsAction, setScheduleDaysAction } from "@/lib/settings/forms-how-it-works";
import { DEFAULT_LEAD_DAYS } from "@/lib/actions/schedule";
import { DEFAULT_RISK_DAYS } from "@/lib/actions/action-state";
import { STATE_NAMES, STATE_NAME_MAX, type StateNames } from "@/lib/core/state-names";
import { cn, fmtDate } from "@/lib/core/utils";

const sheetHead = "flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6";
const footer = "border-t border-line px-5 py-3 sm:px-6";

/**
 * What the project has settled that is not decided on a step of the flow: who carries out the acts drawn on no step,
 * the days around an action, the organization's words for the states, and the way back to the defaults. Whoever may
 * not change it reads the answers in words; the forms only they would use (state names, reset) are left out.
 */
export function ProjectSettings({ source, follows, placed, names, defaults, schedule, riskFixed, admin, readOnly }: {
  source: AnswerSource;
  follows: boolean;
  placed: { acts: Record<string, { title: string; href: string }>; policies: string[] };
  names: StateNames;
  defaults: { at: string; by: string } | null;
  schedule: { defaultLeadDays: number | null; riskWindowDays: number | null } | null;
  riskFixed: boolean;
  admin: boolean;
  readOnly: boolean;
}) {
  const lead = schedule?.defaultLeadDays ?? DEFAULT_LEAD_DAYS;
  const risk = schedule?.riskWindowDays ?? DEFAULT_RISK_DAYS;
  return (
    <div className="space-y-4">
      <div id="how-it-works" className="scroll-mt-24">
        <HowItWorks {...source} follows={follows} placed={placed} readOnly={readOnly} />
      </div>

      {/* The days around an action: needed before its day, at risk from. Kept with the project's schedule. */}
      <section id="action-days" className="register register-sheet register-sheet-open scroll-mt-24">
        <div className={sheetHead}>
          <h2 className="stencil mr-1 text-slate-500">The days around an action</h2>
          <span className="text-[11px] text-slate-500">
            {schedule ? "for every action of the project's schedule" : "once the project's schedule is named (Schedule)"}
          </span>
        </div>
        {schedule && !readOnly ? (
          <ActionForm action={setScheduleDaysAction} submitLabel="Save" className="space-y-0" footerClassName={footer}>
            <div className="space-y-3 px-5 py-4 sm:px-6">
              <p className="text-xs leading-5 text-slate-600">
                A document an action needs is due this many days before the action&rsquo;s day, unless the requirements list gives its own;
                the action is at risk from this many days before it while a document is still missing, unless the document has its own window.
              </p>
              <div className="flex flex-wrap gap-x-8 gap-y-3">
                <label className="text-xs text-slate-700">
                  <span className="mb-1.5 block h-4 font-medium leading-4">Needed before the action&rsquo;s day</span>
                  <span className="flex items-center gap-2">
                    <input type="number" name="leadDays" min={0} max={365} defaultValue={lead} className={cn(inputCls, "w-20")} />
                    days
                  </span>
                </label>
                <label className="text-xs text-slate-700">
                  <span className="mb-1.5 block h-4 font-medium leading-4">At risk from</span>
                  <span className="flex items-center gap-2">
                    <input type="number" name="riskDays" min={0} max={365} defaultValue={risk} readOnly={riskFixed} className={cn(inputCls, "w-20")} />
                    days before
                  </span>
                </label>
              </div>
              {riskFixed ? <p className="text-[11px] leading-5 text-slate-500">The organization keeps the risk window the same on every project: an administrator changes it in the organization&rsquo;s Settings.</p> : null}
            </div>
          </ActionForm>
        ) : (
          <p className="px-5 py-4 text-xs leading-5 text-slate-600 sm:px-6">
            Each document is needed {lead} days before its action, and the action is at risk from {risk} days before
            {schedule ? "." : <>, until the project&rsquo;s schedule is named; then they can be changed here.</>}
          </p>
        )}
      </section>

      {/* The organization's words for the states. What each one does is not on offer — only what it is called. */}
      {readOnly ? null : (
        <section id="state-names" className="register register-sheet register-sheet-open scroll-mt-24">
          <div className={sheetHead}>
            <h2 className="stencil mr-1 text-slate-500">What the states are called</h2>
            <span className="text-[11px] text-slate-500">the organization&rsquo;s words, on every project; only the name changes, never what the state does</span>
          </div>
          <ActionForm action={setStateNamesAction} submitLabel="Save names" className="space-y-0" footerClassName={footer}>
            <ul className="divide-y divide-line">
              {STATE_NAMES.map((one) => (
                <li key={one.code} className="grid grid-cols-1 items-center gap-x-4 gap-y-1.5 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_16rem] sm:px-6">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">
                      {one.default}
                      {names[one.code] !== one.default ? <span className="ml-1.5 text-xs font-normal text-slate-500">renamed</span> : null}
                    </p>
                    <p className="text-xs leading-5 text-slate-600">{one.means}</p>
                  </div>
                  <input
                    name={`name:${one.code}`}
                    defaultValue={names[one.code]}
                    maxLength={STATE_NAME_MAX}
                    aria-label={`Name for ${one.default}`}
                    className={inputCls}
                  />
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">Leave a name empty to go back to the default.</p>
          </ActionForm>
        </section>
      )}

      <section className="register register-sheet register-sheet-open">
        <div className={sheetHead}>
          <h2 className="stencil mr-1 text-slate-500">Acts that stay where they are</h2>
          <span className="text-[11px] text-slate-500">not everything is a choice, and the reasons are short</span>
        </div>
        <ul className="divide-y divide-line">
          {NOT_SWITCHABLE.map((one) => <li key={one} className="px-5 py-2.5 text-xs leading-5 text-slate-600 sm:px-6">{one}</li>)}
        </ul>
      </section>

      {readOnly ? null : (
        <section id="defaults" className="register register-sheet register-sheet-open scroll-mt-24">
          <div className={sheetHead}>
            <h2 className="stencil mr-1 text-slate-500">Back to the defaults</h2>
            <span className="text-[11px] text-slate-500">
              {defaults
                ? `the organization's defaults for new projects, set ${fmtDate(defaults.at)} by ${defaults.by}`
                : "the organization has set no defaults: the app's own stand in"}
            </span>
          </div>
          <ActionForm
            action={resetProjectToDefaultsAction}
            submitLabel={defaults ? "Reset to the organization's defaults" : "Reset to the app's defaults"}
            variant="secondary"
            size="sm"
            confirmText="Every answer on this page goes back to the defaults. Go ahead?"
            className="space-y-3 px-5 py-4 sm:px-6"
          >
            <p className="text-xs leading-5 text-slate-600">
              Every answer marked &ldquo;changed here&rdquo;, on the steps and below, goes back to {defaults ? "the organization's default" : "the app's own"}.
              What the project is, and checks switched off on it, stay as they are. The record says who did it.
            </p>
          </ActionForm>
          {admin ? (
            <p className="border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">
              The <DefaultsLink /> are changed on the organization&rsquo;s page; changing them never changes a project already open.
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}
