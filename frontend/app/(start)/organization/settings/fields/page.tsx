import { Select } from "@/components/select";
import { keptCopies } from "@/lib/settings/api-admin";
import { KeptCopies } from "../copies";
import { ActionForm } from "@/components/form";
import { inputCls } from "@/components/ui";
import { liberty } from "@/lib/organization/liberty";
import { formCopies } from "@/lib/settings/api-admin";
import { KIND_TAB, type FieldKind } from "@/lib/settings/field-policy";
import { resetFormAction } from "@/lib/organization/forms";
import { FieldsBoard, type Params } from "@/app/(app)/settings/fields/board";
import { ProjectSwitches } from "../switches";

export const dynamic = "force-dynamic";
export const metadata = { title: "Forms & fields" };

/**
 * The organization's Forms & fields (owner: the same card as a project's): every form, opening a project and adding an
 * organization included, the default of every project, changed here by an administrator; the switch says whether
 * projects may change a form for themselves; the projects keeping their own copy of a form are listed, and one form may
 * be put back to the organization's, for a mess, with why.
 */
export default async function OrganizationFieldsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const [switches, copies] = await Promise.all([liberty(), formCopies()]);
  const nameOf = (form: string) => KIND_TAB[form as FieldKind] ?? form;

  return (
    <>
      <FieldsBoard level="organization" sp={sp} />
      <ProjectSwitches items={switches.filter((one) => one.area === "Forms & fields")} title="Projects may change them" />
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Projects with their own</span>
          <span className="text-[11px] text-slate-500">a form changed on the project while forms were free; changes here never reach it</span>
        </div>
        {copies.length ? (
          <ul className="divide-y divide-line">
            {copies.map((one) => (
              <li key={one.id} className="grid grid-cols-1 items-start gap-x-6 gap-y-2 px-5 py-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:px-6">
                <div>
                  <p className="text-[13px] font-semibold text-slate-800"><span className="font-mono">{one.code}</span> · {one.name}</p>
                  <p className="text-[11.5px] text-slate-500">its own {one.forms.map(nameOf).join(", ")}</p>
                </div>
                <details>
                  <summary className="cursor-pointer text-[11.5px] font-semibold text-slate-500 hover:text-slate-800">For a mess only: put a form back to the organization&rsquo;s</summary>
                  <ActionForm action={resetFormAction} submitLabel={`Put it back on ${one.code}`} size="sm" variant="danger" hidden={{ projectId: one.id }}
                    confirmText={`${one.code} loses its own version of that form and uses the organization's again. Answers already given stay on their records. Go ahead?`}
                    className="mt-2 flex flex-wrap items-end gap-2 space-y-0">
                    <label className="w-56">
                      <span className="sr-only">Which form</span>
                      <Select name="form" required className={inputCls}>{one.forms.map((form) => <option key={form} value={form}>{nameOf(form)}</option>)}</Select>
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
        ) : <p className="px-5 py-3 text-xs text-slate-500 sm:px-6">None: every project uses the organization&rsquo;s forms.</p>}
      </section>
      <KeptCopies copies={await keptCopies("FORM:")} />
      </>
  );
}
