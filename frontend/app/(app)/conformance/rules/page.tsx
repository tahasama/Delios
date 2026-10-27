import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { DataTable, Th, Td } from "@/components/ui";
import { AssuranceHead } from "@/app/(app)/conformance/head";
import { PREVENTED } from "@/lib/conformance/checks/prevented";
import { CATALOG } from "@/lib/conformance/checks/catalog";
import { POLICIES, SKIPPABLE, SKIP_KEY, CONTROL_ACTIVITIES, policy } from "@/lib/settings/control-activities";
import { projectSettings } from "@/lib/settings/api";

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
export default async function DefaultRulesPage({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  // What is refused, in tabs by where it happens (the order the list gives).
  const areas = [...new Set(PREVENTED.map((r) => r.where))];
  const askedArea = (await searchParams).area;
  const area = askedArea && areas.includes(askedArea) ? askedArea : null;
  const refused = area ? PREVENTED.filter((r) => r.where === area) : PREVENTED;
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

  return (
    <div className="space-y-4">
      <AssuranceHead
        current="/conformance/rules"
        lead={`What the application refuses outright, and what this project has settled where there was a choice. None of it is among the ${CATALOG.length} checks: the act that would create the condition does not complete.`}
      />

      <div className="space-y-4">
        <section className="register register-sheet register-sheet-open">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <span className="stencil mr-1 text-slate-500">Settled on this project</span>
            <span className="text-[11px] text-slate-500">where there is a real choice, the answer used here (Settings → Control room)</span>
          </div>
          <ul className="divide-y divide-line">
            {settled.map((s) => (
              <li key={s.key} className="grid grid-cols-1 gap-x-6 gap-y-1 px-5 py-2.5 text-xs sm:grid-cols-[18rem_minmax(0,1fr)] sm:px-6">
                <span className="font-semibold text-slate-800">{s.title}{s.isDefault ? <span className="ml-2 font-normal text-slate-400">as it comes</span> : null}</span>
                <span className="leading-5 text-slate-600"><span className="font-semibold text-slate-700">{s.chosen.label.replace(" (recommended)", "").replace(" — recommended", "")}.</span> {s.chosen.text}</span>
              </li>
            ))}
            {switchedOff.map((s) => (
              <li key={s.key} className="grid grid-cols-1 gap-x-6 gap-y-1 px-5 py-2.5 text-xs sm:grid-cols-[18rem_minmax(0,1fr)] sm:px-6">
                <span className="font-semibold text-slate-800">{s.title}<span className="ml-2 font-normal text-amber-700">left out here</span></span>
                <span className="leading-5 text-slate-600">{s.off}</span>
              </li>
            ))}
          </ul>
        </section>

        <section data-dt-frame className="register register-sheet">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <span className="stencil mr-1 text-slate-500">Refused on every project</span>
            <span className="text-[11px] text-slate-500">not a setting: the act that would cause it does not go through, with the answer it gets</span>
          </div>
          <nav aria-label="Where it happens" className="tabs px-3 pt-1.5 sm:px-4">
            <Link href="/conformance/rules" scroll={false} aria-current={!area ? "page" : undefined} className="tab">All <span className="tab-n">{PREVENTED.length}</span></Link>
            {areas.map((one) => (
              <Link key={one} href={`/conformance/rules?${new URLSearchParams({ area: one })}`} scroll={false} aria-current={area === one ? "page" : undefined} className="tab">
                {one} <span className="tab-n">{PREVENTED.filter((r) => r.where === one).length}</span>
              </Link>
            ))}
          </nav>
          <DataTable className="rounded-none border-0 shadow-none" id="default-rules" exportName="default-rules"
            head={<tr><Th>Where</Th><Th>What cannot happen</Th><Th>What happens instead</Th><Th>Refused with</Th></tr>}>
            {refused.map((r) => (
              <tr key={r.condition}>
                <Td className="whitespace-nowrap text-xs font-semibold text-slate-700">{r.where}</Td>
                <Td className="max-w-80 text-[13px] text-slate-800">{r.condition}</Td>
                <Td className="max-w-md text-xs leading-5 text-slate-600">{r.prevented}</Td>
                <Td className="font-mono text-[11px] text-slate-500">{r.code ?? <span className="text-slate-300">—</span>}</Td>
              </tr>
            ))}
          </DataTable>
        </section>

        <p className="max-w-prose text-[11px] leading-4 text-slate-400">
          None of this is counted in the measured result: a condition that cannot arise has no documents carrying it.
        </p>
      </div>
    </div>
  );
}
