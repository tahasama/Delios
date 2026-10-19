import { keptCopies } from "@/lib/settings/api-admin";
import { KeptCopies } from "../copies";
import { ActionForm } from "@/components/form";
import { inputCls } from "@/components/ui";
import { liberty } from "@/lib/organization/liberty";
import { listCopies } from "@/lib/settings/api-admin";
import { organizationSets } from "@/lib/settings/config";
import { resetListAction } from "@/lib/organization/forms";
import { ListsBoard, type Params } from "@/app/(app)/settings/config/board";
import { ProjectSwitches } from "../switches";

export const dynamic = "force-dynamic";
export const metadata = { title: "Types & sets" };

/**
 * The organization's Types & sets (owner: the same card as a project's): its lists, the default of every project,
 * changed here by an administrator; each list's switch says whether projects may change it; the projects that keep
 * their own copy of a list are listed, and one list may be put back to the organization's, for a mess, with why.
 */
export default async function OrganizationTypesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const [switches, copies, sets] = await Promise.all([liberty(), listCopies(), organizationSets()]);
  const titleOf = (key: string) => sets.find((one) => one.key === key)?.title ?? key;

  return (
    <>
      <ListsBoard level="organization" sp={sp} />
      <ProjectSwitches items={switches.filter((one) => one.area === "Types & sets")} title="Which lists projects may change" />
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Projects with their own</span>
          <span className="text-[11px] text-slate-500">a list changed on the project while it was free; changes here never touch it</span>
        </div>
        {copies.length ? (
          <ul className="divide-y divide-line">
            {copies.map((one) => (
              <li key={one.id} className="grid grid-cols-1 items-start gap-x-6 gap-y-2 px-5 py-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:px-6">
                <div>
                  <p className="text-[13px] font-semibold text-slate-800"><span className="font-mono">{one.code}</span> · {one.name}</p>
                  <p className="text-[11.5px] text-slate-500">its own {one.lists.map(titleOf).join(", ")}</p>
                </div>
                <details>
                  <summary className="cursor-pointer text-[11.5px] font-semibold text-slate-500 hover:text-slate-800">For a mess only: put a list back to the organization&rsquo;s</summary>
                  <ActionForm action={resetListAction} submitLabel={`Put it back on ${one.code}`} size="sm" variant="danger" hidden={{ projectId: one.id }}
                    confirmText={`${one.code} loses its own copy of that list and uses the organization's again. What its documents carry stays as it is. Go ahead?`}
                    className="mt-2 flex flex-wrap items-end gap-2 space-y-0">
                    <label className="w-56">
                      <span className="sr-only">Which list</span>
                      <select name="list" required className={inputCls}>{one.lists.map((key) => <option key={key} value={key}>{titleOf(key)}</option>)}</select>
                    </label>
                    <label className="min-w-64 flex-1">
                      <span className="sr-only">Why</span>
                      <input name="reason" required maxLength={300} placeholder="Why, told to its control function" className={inputCls} />
                    </label>
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
        ) : <p className="px-5 py-3 text-xs text-slate-500 sm:px-6">None: every project uses the organization&rsquo;s lists.</p>}
      </section>
      <KeptCopies copies={await keptCopies("LIST:")} />
      </>
  );
}
