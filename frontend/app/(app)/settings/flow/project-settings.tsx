import { liberty } from "@/lib/organization/liberty";
import { requireScope } from "@/lib/core/scope";
import { isAdmin } from "@/lib/core/auth";
import { inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { HowItWorks, DefaultsLink } from "@/components/how-it-works";
import { holders, projectSettings } from "@/lib/settings/api";
import { NOT_SWITCHABLE } from "@/lib/settings/control-activities";
import { setStateNamesAction, resetProjectToDefaultsAction } from "@/lib/settings/forms-how-it-works";
import { STATE_NAMES, STATE_NAME_MAX, stateNames } from "@/lib/core/state-names";
import { projectDefaults } from "@/lib/organization/defaults";
import { fmtDate } from "@/lib/core/utils";

/**
 * What the project has settled: who carries each act out, what releasing and
 * the rest of it mean here, and the organization's own words for the states.
 *
 * It used to be a screen of its own called "Who does what", beside a Control
 * room that already showed the same acts and let you switch them. One flow,
 * one page: the deck shows how a document moves, these panels decide it. The
 * same form edits the organization's defaults for new projects; each answer
 * says whether it is the default's or changed here, and the project can go
 * back to the defaults in one step.
 */
export async function ProjectSettings({ readOnly = false }: { readOnly?: boolean }) {
  const ctx = await requireScope();
  const [answers, controllers, names, defaults, switches] = await Promise.all([
    projectSettings(ctx.projectId).catch(() => new Map<string, string>()),
    holders(ctx.projectId, "CONTROL").catch(() => []),
    stateNames(ctx),
    projectDefaults().catch(() => null),
    liberty(),
  ]);
  // What the organization keeps the same on every project: shown, never chosen here (backend ROOM_FIXED).
  const fixed = switches.filter((one) => one.area === "Control room" && !one.free).map((one) => one.key);
  const admin = isAdmin(ctx.user);

  return (
    // Read only for whoever may not change it: every answer shows, nothing can be chosen or saved.
    <fieldset disabled={readOnly} className="min-w-0 space-y-4">
      <div id="how-it-works" className="scroll-mt-24">
        <HowItWorks target="project" answers={answers} follows={controllers.length > 0} base={defaults?.values ?? null}
          fixed={fixed} />
      </div>

      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Back to the defaults</span>
          <span className="text-[11px] text-slate-500">
            {defaults
              ? `the organization's defaults for new projects, set ${fmtDate(defaults.at)} by ${defaults.by}`
              : "the organization has set no defaults: the app's own stand in"}
          </span>
        </div>
        <div className="space-y-3 px-5 py-4 sm:px-6">
          <p className="text-xs leading-5 text-slate-600">
            Every answer above marked &ldquo;changed here&rdquo; goes back to {defaults ? "the organization's default" : "the app's own"}. What the project is,
            and checks ticked off on it, stay as they are. The record says who did it.
          </p>
          <ActionForm
            action={resetProjectToDefaultsAction}
            submitLabel={defaults ? "Reset to the organization's defaults" : "Reset to the app's defaults"}
            variant="secondary"
            size="sm"
            confirmText="Every answer on this page goes back to the defaults. Go ahead?"
          />
        </div>
        {admin ? (
          <p className="border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">
            The <DefaultsLink /> are changed on the organization&rsquo;s page; changing them never changes a project already open.
          </p>
        ) : null}
      </section>

      {/* The organization's words for the states. What each one does is not
          on offer — only what it is called. They are the organization's, on every project. */}
      <section id="state-names" className="register register-sheet register-sheet-open scroll-mt-24">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">What the states are called</span>
          <span className="text-[11px] text-slate-500">the organization&rsquo;s words, on every project; only the name changes, never what the state does</span>
        </div>
        <ActionForm action={setStateNamesAction} submitLabel="Save names" className="space-y-0">
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
                  defaultValue={names[one.code] !== one.default ? names[one.code] : ""}
                  placeholder={one.default}
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

      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Acts that stay where they are</span>
          <span className="text-[11px] text-slate-500">not everything is a choice, and the reasons are short</span>
        </div>
        <ul className="divide-y divide-line">
          {NOT_SWITCHABLE.map((one) => <li key={one} className="px-5 py-2.5 text-xs leading-5 text-slate-600 sm:px-6">{one}</li>)}
        </ul>
      </section>
    </fieldset>
  );
}
