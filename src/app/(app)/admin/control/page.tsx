import { SETUP_PAGES, maySetup } from "../setup-pages";
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, Chip, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import {
  controlSettings,
  policies,
  MODE_LABEL,
  NOT_SWITCHABLE,
  PROJECT_MODE_LABEL,
  type ControlMode,
  type ProjectMode,
} from "@/lib/control-activities";
import { setControlActivitiesAction, setPolicyAction } from "@/lib/actions/control-activities";

export const dynamic = "force-dynamic";
export const metadata = { title: "Who does what" };

/**
 * Which acts Document Control carries out, and which the people doing the work
 * carry out themselves.
 *
 * One question for the project, with three answers: one side, the other side, or
 * "it depends on the act" — and then a line per act. Until it is answered the app
 * reads the project itself: somebody holds the control function, or nobody does.
 * What is chosen here decides which buttons people see, not only what the server
 * allows.
 */
export default async function ControlActivitiesPage() {
  const ctx = await requireScope();
  const { user: me } = ctx;
  const page = SETUP_PAGES.find((one) => one.href === "/admin/control")!;
  if (!maySetup(me, page)) return <PageHeader title="Who does what" subtitle="Administrators only." />;
  const [{ follows, projectMode, set, rows }, chosen] = await Promise.all([controlSettings(ctx), policies(ctx)]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Who does what"
        subtitle="Some acts can be carried out by Document Control, or by the people doing the work. Say which, and the buttons follow."
      />

      <Card
        title="Who carries these acts out?"
        description={set
          ? undefined
          : `Nobody has said yet, so the app reads the project: it ${follows ? "has a control function, so Document Control carries them out" : "has no control function, so the people doing the work carry them out"}.`}
      >
        <ActionForm action={setControlActivitiesAction} submitLabel="Save">
          <div className="space-y-2">
            {(["CONTROL", "SELF", "CUSTOM"] as ProjectMode[]).map((mode) => (
              <label
                key={mode}
                className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line px-3.5 py-3 hover:bg-slate-50 has-[:checked]:border-brand-line has-[:checked]:bg-tint-soft"
              >
                <input type="radio" name="projectMode" value={mode} defaultChecked={projectMode === mode} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{PROJECT_MODE_LABEL[mode]}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-slate-600">
                    {mode === "CONTROL"
                      ? "Everything on the list below goes through Document Control. People ask; Document Control carries it out."
                      : mode === "SELF"
                        ? "Everything on the list below is done by whoever is doing the work — the author, the reviewer, whoever asked."
                        : "Each act on its own. Put the ones you want with Document Control and leave the rest with the work."}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {/* The list decides each act while the answer above is "it depends".
              On the other two answers it is kept as it stands, ready for the day
              the administrator comes back to it. */}
          <ul className="mt-4 space-y-3 border-t border-line pt-4">
            {rows.map(({ activity, mode, controlDoes }) => (
              <li key={activity.key} className="rounded-xl border border-line px-3.5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{activity.title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-slate-600">{activity.text}</p>
                    <p className="mt-1.5 text-xs leading-5 text-slate-700">
                      <Chip className={controlDoes ? "bg-tint text-brand-ink ring-brand-line" : "bg-slate-100 text-slate-600 ring-slate-200"}>
                        {controlDoes ? "Document Control" : "The people doing the work"}
                      </Chip>
                      <span className="ml-2">{controlDoes ? activity.control : activity.self}</span>
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
              </li>
            ))}
          </ul>
          <p className="text-[11px] leading-4 text-slate-500">
            These lines are used when the answer is “it depends on the act”.
          </p>
        </ActionForm>
      </Card>

      <Card
        title="How this project works"
        description="Two questions that are not about who does something, but about what it means when they do. The app has an opinion; the project may disagree."
      >
        <ActionForm action={setPolicyAction} submitLabel="Save">
          <div className="space-y-4">
            {chosen.map(({ policy, value, set: answered }) => (
              <fieldset key={policy.key}>
                <legend className="text-sm font-semibold text-slate-900">{policy.title}</legend>
                <p className="mt-0.5 mb-2 text-xs leading-5 text-slate-600">
                  {policy.text}
                  {answered ? null : <span className="ml-1 text-slate-400">Nobody has answered this yet, so the first is in force.</span>}
                </p>
                <div className="space-y-2">
                  {policy.options.map((option) => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line px-3.5 py-3 hover:bg-slate-50 has-[:checked]:border-brand-line has-[:checked]:bg-tint-soft"
                    >
                      <input type="radio" name={policy.key} value={option.value} defaultChecked={value === option.value} className="mt-0.5" />
                      <span>
                        <span className="block text-[13px] font-semibold text-slate-900">{option.label}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-slate-600">{option.text}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </ActionForm>
      </Card>

      <Card title="Acts that stay where they are" description="Not everything is a choice, and the reasons are short.">
        <ul className="space-y-1.5 text-xs leading-5 text-slate-600">
          {NOT_SWITCHABLE.map((one) => <li key={one}>· {one}</li>)}
        </ul>
      </Card>
    </div>
  );
}
