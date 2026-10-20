import { requireOrgAdmin } from "@/lib/core/org-scope";
import { inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { setStateNamesAction } from "@/lib/settings/forms-how-it-works";
import { STATE_NAMES, STATE_NAME_MAX, stateNames } from "@/lib/core/state-names";

export const dynamic = "force-dynamic";
export const metadata = { title: "What the states are called" };

/**
 * What the states are called: the organization's words, the same on every project (owner: moved here from a project's
 * page, which said "this project only"). Only the name changes, never what the state does; a name left empty goes back
 * to the app's.
 */
export default async function StateNamesPage() {
  await requireOrgAdmin();
  const names = await stateNames();
  return (
    <section id="state-names" className="register register-sheet register-sheet-open scroll-mt-24" aria-labelledby="state-names-head">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <h2 id="state-names-head" className="stencil mr-1 text-slate-500">What the states are called</h2>
        <span className="text-[11px] text-slate-500">the organization&rsquo;s words, on every project; only the name changes, never what the state does</span>
      </div>
      <ActionForm action={setStateNamesAction} submitLabel="Save names" className="space-y-0" footerClassName="border-t border-line px-5 py-3 sm:px-6">
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
              <input name={`name:${one.code}`} defaultValue={names[one.code]} maxLength={STATE_NAME_MAX} aria-label={`Name for ${one.default}`} className={inputCls} />
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">Leave a name empty to go back to the app&rsquo;s.</p>
      </ActionForm>
    </section>
  );
}
