import { Select } from "@/components/select";
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

export const dynamic = "force-dynamic";
export const metadata = { title: "Defaults for new projects" };

/**
 * The configuration a new project of ours starts with (docs/ORGANIZATIONS.md, "Defaults"), edited directly: the same
 * questions as a project's Control room, saved as the defaults. It can start from one project's choices, and go back
 * to the app's own. Copied when a project opens; never changes a project already open.
 */
export default async function DefaultsPage() {
  await requireOrgAdmin();
  const [defaults, projects] = await Promise.all([projectDefaults(), adminProjects().catch(() => [])]);
  const answers = new Map(Object.entries(defaults?.values ?? {}));
  const source = defaults
    ? defaults.fromProject ? `Taken from ${defaults.fromProject}${defaults.edited ? ", then changed here" : ""}` : "Set here"
    : "The app's own";
  const open = projects.filter((p) => p.status === "ACTIVE");

  return (
    <>
      <header className="register register-sheet register-sheet-open">
        <div className="px-5 pt-5 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">Defaults for new projects</h1>
          <p className="plate-meta mt-1.5 font-normal">
            What a project of ours starts with: who carries the acts out, and how it works. Copied when a project opens; the project then
            changes what is free, and can go back to these.
          </p>
        </div>
        <dl className="grid grid-cols-1 divide-y divide-line border-t border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Where they come from</dt>
            <dd className="mt-1 text-[13px] font-medium text-slate-900">{source}</dd>
            <dd className="text-[11px] text-slate-500">{defaults ? `last changed ${fmtDate(defaults.at)} by ${defaults.by}` : "nothing set by the organization yet"}</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Projects already open</dt>
            <dd className="mt-1 text-[13px] font-medium text-slate-900">Keep their own</dd>
            <dd className="text-[11px] text-slate-500">changing these never changes them</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Another organization&rsquo;s project</dt>
            <dd className="mt-1 text-[13px] font-medium text-slate-900">Follows its owner</dd>
            <dd className="text-[11px] text-slate-500">we take part as it is set up there</dd>
          </div>
        </dl>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <HowItWorks target="defaults" answers={answers} follows />
        </div>

        <aside className="space-y-4 xl:sticky xl:top-5">
          {open.length ? (
            <section className="register register-sheet register-sheet-open">
              <div className="border-b border-line bg-tint-soft px-4 py-2.5">
                <span className="stencil text-slate-500">Start from a project</span>
                <p className="mt-0.5 text-[11px] leading-4 text-slate-500">its answers replace the defaults, all at once</p>
              </div>
              <div className="px-4 py-4">
                <ActionForm action={makeDefaultsAction} submitLabel="Make its choices the defaults" size="sm">
                  <Field label="Project" required>
                    <Select name="projectId" required defaultValue="" className={inputCls}>
                      <option value="" disabled>Choose…</option>
                      {open.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                    </Select>
                  </Field>
                </ActionForm>
              </div>
            </section>
          ) : null}

          <section className="register register-sheet register-sheet-open">
            <div className="border-b border-line bg-tint-soft px-4 py-2.5">
              <span className="stencil text-slate-500">The app&rsquo;s own defaults</span>
              <p className="mt-0.5 text-[11px] leading-4 text-slate-500">what a project starts with when we say nothing; marked &ldquo;the app&rsquo;s&rdquo; beside</p>
            </div>
            <dl className="divide-y divide-line">
              <div className="px-4 py-2.5">
                <dt className="text-[11.5px] font-semibold text-slate-800">Who carries the acts out</dt>
                <dd className="text-[11.5px] leading-[1.45] text-slate-600">
                  The control function where somebody holds it, else the people doing the work
                  {CONTROL_ACTIVITIES.some((one) => one.workByDefault) ? <> (except {CONTROL_ACTIVITIES.filter((one) => one.workByDefault).map((one) => one.title.toLowerCase()).join(", ")}, left with the work)</> : null}.
                </dd>
              </div>
              <div className="px-4 py-2.5">
                <dt className="text-[11.5px] font-semibold text-slate-800">Confirmation by whoever holds Manage</dt>
                <dd className="text-[11.5px] leading-[1.45] text-slate-600">
                  Not asked ({Object.keys(CONFIRMABLE).map((key) => CONTROL_ACTIVITIES.find((one) => one.key === key)?.title.toLowerCase() ?? key).join(", ")}).
                </dd>
              </div>
              {POLICIES.map((one) => (
                <div key={one.key} className="px-4 py-2.5">
                  <dt className="text-[11.5px] font-semibold text-slate-800">{one.title}</dt>
                  <dd className="text-[11.5px] leading-[1.45] text-slate-600">{one.options[0].label}.</dd>
                </div>
              ))}
              <div className="px-4 py-2.5">
                <dt className="text-[11.5px] font-semibold text-slate-800">When a discipline does not answer</dt>
                <dd className="text-[11.5px] leading-[1.45] text-slate-600">Notified after {DEFAULT_ESCALATE_AFTER} working days.</dd>
              </div>
            </dl>
            <div className="border-t border-line px-4 py-3">
              {defaults ? (
                <ActionForm
                  action={resetDefaultsAction}
                  submitLabel="Reset to the app's defaults"
                  variant="secondary"
                  size="sm"
                  confirmText="The organization's defaults are forgotten; new projects start with the app's own. Projects already open keep theirs. Go ahead?"
                />
              ) : <p className="text-[11.5px] text-slate-500">These are the ones used now.</p>}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
