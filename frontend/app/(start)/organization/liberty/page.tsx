import Link from "next/link";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { Switch } from "@/components/switch";
import { liberty } from "@/lib/organization/liberty";
import { setLibertyAction } from "@/lib/organization/forms";
import { fmtDate } from "@/lib/core/utils";
import { OrgHeader } from "../org-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "What projects may change" };

/**
 * Two levels of settings (owner): the organization's is the default of every project; each setting has one switch here,
 * Fixed (every project uses the organization's) or Free (a project may take its own copy and change it). Worked out by
 * the backend (`Settings/Liberty.cs`). A switch made stricter never undoes what a project already changed.
 */
export default async function LibertyPage() {
  const scope = await requireOrgAdmin();
  const items = await liberty();
  const areas = [...new Set(items.map((one) => one.area))];
  const free = items.filter((one) => one.free).length;

  return (
    <div className="min-h-screen bg-canvas">
      <OrgHeader scope={scope} back={{ href: "/organization", label: "Organization" }} />
      <main className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        <section className="register register-sheet register-sheet-open">
          <div className="px-5 pt-6 pb-4 sm:px-6">
            <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">{scope.organization.name}</p>
            <h1 className="plate-name mt-1">What projects may change</h1>
            <p className="plate-meta mt-2">{free} free · {items.length - free} fixed</p>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
              Every project starts from the organization&rsquo;s settings. <span className="font-semibold text-slate-700">Fixed</span>: every
              project uses the organization&rsquo;s as it is, and only an administrator changes it, here for all of them.{" "}
              <span className="font-semibold text-slate-700">Free</span>: a project may take its own copy and change it; the
              organization&rsquo;s later changes never touch that copy. Making one fixed later never undoes what a project already changed:
              it stays, read as changed before the rule.
            </p>
          </div>
        </section>

        {areas.map((area) => (
          <section key={area} className="register register-sheet register-sheet-open">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
              <span className="stencil mr-1 text-slate-500">{area}</span>
              <span className="ml-auto text-[11px] text-slate-500">Projects may change it</span>
            </div>
            <ul className="divide-y divide-line">
              {items.filter((one) => one.area === area).map((one) => (
                <li key={one.key} className="flex items-center gap-4 px-5 py-2.5 sm:px-6">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-slate-800">{one.title}</p>
                    <p className="text-[11.5px] leading-4 text-slate-500">
                      {one.locked ?? one.why}
                      {one.changedAt
                        ? <> · changed {fmtDate(one.changedAt)} by {one.changedBy}{one.free === one.freeByDefault ? "" : `, the app starts it ${one.freeByDefault ? "free" : "fixed"}`}</>
                        : null}
                    </p>
                  </div>
                  <span className={`w-12 text-right text-[11.5px] font-semibold ${one.free ? "text-emerald-700" : "text-slate-600"}`}>{one.free ? "Free" : "Fixed"}</span>
                  <form action={setLibertyAction}>
                    <input type="hidden" name="key" value={one.key} />
                    <input type="hidden" name="free" value={one.free ? "0" : "1"} />
                    <Switch on={one.free} disabled={!!one.locked} label={one.free ? `Fix ${one.title} for every project` : `Let projects change ${one.title}`} />
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="text-[11.5px] leading-5 text-slate-500">
          Always the organization&rsquo;s, with no switch: the organizations we work with and who they are, sign-in &amp; security, what is kept
          about people&rsquo;s activity, the audit trail, and the <Link href="/organization/defaults" className="font-semibold text-link hover:underline">defaults for new projects</Link>.
          Always the project&rsquo;s: what the project is, the organizations and people on it, who answers for each, who acts as the control
          function, the distribution matrix, and checks switched off with why.
        </p>
      </main>
    </div>
  );
}
