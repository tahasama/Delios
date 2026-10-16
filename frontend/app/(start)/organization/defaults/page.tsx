import { requireOrgAdmin } from "@/lib/core/org-scope";
import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { HowItWorks } from "@/components/how-it-works";
import { projectDefaults } from "@/lib/organization/defaults";
import { makeDefaultsAction, resetDefaultsAction } from "@/lib/organization/forms";
import { adminProjects } from "@/lib/settings/api-admin";
import { POLICIES, CONFIRMABLE, CONTROL_ACTIVITIES } from "@/lib/settings/control-activities";
import { DEFAULT_ESCALATE_AFTER } from "@/lib/actions/escalation";
import { fmtDate } from "@/lib/core/utils";
import { OrgHeader } from "../org-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Defaults for new projects" };

/**
 * The configuration a new project of ours starts with (docs/ORGANIZATIONS.md, "Defaults"), edited directly: the same
 * questions as a project's Control room, saved as the defaults. It can start from one project's choices, and go back
 * to the app's own. Copied when a project opens; never changes a project already open.
 */
export default async function DefaultsPage() {
  const scope = await requireOrgAdmin();
  const [defaults, projects] = await Promise.all([projectDefaults(), adminProjects().catch(() => [])]);
  const answers = new Map(Object.entries(defaults?.values ?? {}));
  const source = defaults
    ? `${defaults.fromProject ? `Taken from ${defaults.fromProject}${defaults.edited ? ", then changed here" : ""}` : "Set here"}; last changed ${fmtDate(defaults.at)} by ${defaults.by}.`
    : "None set: a new project starts with the app's own, listed below.";

  return (
    <div className="min-h-screen bg-canvas">
      <OrgHeader scope={scope} back={{ href: "/organization", label: "Organization" }} />
      <main className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        <section className="register register-sheet register-sheet-open">
          <div className="px-5 pt-6 pb-4 sm:px-6">
            <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">{scope.organization.name}</p>
            <h1 className="plate-name mt-1">Defaults for new projects</h1>
            <p className="plate-meta mt-2">{source}</p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              What a project of ours starts with: who carries the acts out, and how it works. Copied when a project opens; the project then
              changes it freely, and can go back to these. Changing them never changes a project already open. A project of another
              organization&rsquo;s follows its owner&rsquo;s.
            </p>
          </div>
        </section>

        <HowItWorks target="defaults" answers={answers} follows />

        <section className="register register-sheet register-sheet-open">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <span className="stencil mr-1 text-slate-500">The app&rsquo;s own defaults</span>
            <span className="text-[11px] text-slate-500">what a project starts with when the organization says nothing; the answers above marked &ldquo;the app&rsquo;s&rdquo;</span>
          </div>
          <ul className="divide-y divide-line">
            <li className="px-5 py-2.5 text-xs leading-5 text-slate-600 sm:px-6">
              <span className="font-semibold text-slate-800">Who carries the acts out:</span> as each project is set up — The control function when somebody
              holds the control function, else the people doing the work
              {CONTROL_ACTIVITIES.some((one) => one.workByDefault) ? <> (except {CONTROL_ACTIVITIES.filter((one) => one.workByDefault).map((one) => one.title.toLowerCase()).join(", ")}, left with the work)</> : null}.
            </li>
            <li className="px-5 py-2.5 text-xs leading-5 text-slate-600 sm:px-6">
              <span className="font-semibold text-slate-800">Confirmation by whoever holds Manage:</span> not asked
              ({Object.keys(CONFIRMABLE).map((key) => CONTROL_ACTIVITIES.find((one) => one.key === key)?.title.toLowerCase() ?? key).join(", ")}).
            </li>
            {POLICIES.map((one) => (
              <li key={one.key} className="px-5 py-2.5 text-xs leading-5 text-slate-600 sm:px-6">
                <span className="font-semibold text-slate-800">{one.title}:</span> {one.options[0].label}.
              </li>
            ))}
            <li className="px-5 py-2.5 text-xs leading-5 text-slate-600 sm:px-6">
              <span className="font-semibold text-slate-800">When a discipline does not answer:</span> notified after {DEFAULT_ESCALATE_AFTER} working days.
            </li>
          </ul>
          <div className="flex flex-wrap items-start gap-2 border-t border-line px-5 py-3 sm:px-6">
            {defaults ? (
              <ActionForm
                action={resetDefaultsAction}
                submitLabel="Reset to the app's defaults"
                variant="secondary"
                size="sm"
                confirmText="The organization's defaults are forgotten; new projects start with the app's own. Projects already open keep theirs. Go ahead?"
              />
            ) : <p className="text-xs text-slate-500">These are the ones used now.</p>}
          </div>
        </section>

        {projects.some((p) => p.status === "ACTIVE") ? (
          <section className="register register-sheet register-sheet-open">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
              <span className="stencil mr-1 text-slate-500">Start from a project</span>
              <span className="text-[11px] text-slate-500">its answers replace the defaults above, all at once</span>
            </div>
            <div className="max-w-md px-5 py-4 sm:px-6">
              <ActionForm action={makeDefaultsAction} submitLabel="Make its choices the defaults" size="sm">
                <Field label="Project" required>
                  <select name="projectId" required defaultValue="" className={inputCls}>
                    <option value="" disabled>Choose…</option>
                    {projects.filter((p) => p.status === "ACTIVE").map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                  </select>
                </Field>
              </ActionForm>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
