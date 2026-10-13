import { requireScope } from "@/lib/scope";
import { PageHeader, Card, Chip } from "@/components/ui";
import { AssuranceTabs } from "@/app/(app)/conformance/tabs";
import { PREVENTED } from "@/lib/checks/prevented";
import { CATALOG } from "@/lib/checks/catalog";
import { POLICIES, SKIPPABLE, SKIP_KEY, CONTROL_ACTIVITIES, policy } from "@/lib/control-activities";
import { projectSettings } from "@/lib/api/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Default rules" };

/**
 * What the application refuses, as distinct from what it checks.
 *
 * Two kinds sit here. Some rules hold on every project and cannot be turned
 * off; others are the project's own answer to a genuine choice, and the page
 * reads the answer in force rather than describing both. A rule nobody can see
 * the setting of is a rule nobody can rely on.
 */
export default async function DefaultRulesPage() {
  const ctx = await requireScope();

  const settled = await Promise.all(
    POLICIES.map(async (p) => {
      const value = await policy(ctx, p.key);
      const chosen = p.options.find((o) => o.value === value) ?? p.options[0];
      return { key: p.key, title: p.title, question: p.text, chosen, isDefault: !value };
    }),
  );

  // The project's answers live in its settings: SKIP:<act> is OFF where the act is switched off.
  const answers = await projectSettings(ctx.projectId);
  const skips = Object.keys(SKIPPABLE).map(SKIP_KEY).filter((key) => answers.get(key) === "OFF").map((key) => ({ key }));
  const switchedOff = skips
    .map((s) => {
      const key = s.key.replace("SKIP:", "");
      return { key, title: CONTROL_ACTIVITIES.find((a) => a.key === key)?.title ?? key, off: SKIPPABLE[key]?.off ?? "" };
    })
    .filter((s) => s.off);

  const byWhere = [...new Set(PREVENTED.map((r) => r.where))];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Default rules"
        subtitle={`What the application refuses outright, and what this project has settled where there was a choice. None of it is among the ${CATALOG.length} checks: there is nothing to find, because the act that would create the condition does not complete.`}
      />
      <AssuranceTabs current="/conformance/rules" />

      <div className="max-w-4xl space-y-4">
        <Card title="Settled on this project" description="Each one is a real choice between two honest ways of working. This is the answer in force.">
          <ul className="divide-y divide-line">
            {settled.map((s) => (
              <li key={s.key} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="text-[13px] leading-5 text-slate-800">{s.title}</p>
                  {s.isDefault ? <Chip className="bg-slate-100 text-slate-500 ring-slate-300">as it comes</Chip> : null}
                </div>
                <p className="mt-0.5 text-[11.5px] leading-[1.45] text-slate-500">
                  <span className="font-semibold text-slate-700">{s.chosen.label.replace(" (recommended)", "").replace(" — recommended", "")}.</span>{" "}
                  {s.chosen.text}
                </p>
              </li>
            ))}
          </ul>
        </Card>

        {switchedOff.length ? (
          <Card title="Left out here" description="Acts this organization has switched off, on its own responsibility. Nothing below is enforced.">
            <ul className="divide-y divide-line">
              {switchedOff.map((s) => (
                <li key={s.key} className="py-2.5 first:pt-0 last:pb-0">
                  <p className="text-[13px] leading-5 text-slate-800">{s.title}</p>
                  <p className="mt-0.5 text-[11.5px] leading-[1.45] text-slate-500">{s.off}</p>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {byWhere.map((where) => (
          <Card key={where} title={where} description="Refused on every project; not a setting.">
            <ul className="divide-y divide-line">
              {PREVENTED.filter((r) => r.where === where).map((r) => (
                <li key={r.condition} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                  <div className="min-w-0">
                    <p className="text-[13px] leading-5 text-slate-800">{r.condition}</p>
                    <p className="mt-0.5 text-[11.5px] leading-[1.45] text-slate-500">{r.prevented}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}

        <p className="max-w-prose text-[11px] leading-4 text-slate-400">
          None of this is counted in the measured result. A condition that cannot arise has no documents carrying it, so
          folding it into the percentage would raise the number without telling you anything about the register.
        </p>
      </div>
    </div>
  );
}
