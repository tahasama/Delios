import { requireOrgAdmin } from "@/lib/core/org-scope";
import { ActionForm } from "@/components/form";
import { orgSettings } from "@/lib/settings/api";
import { setDateFormatAction } from "@/lib/organization/forms";
import { DATE_FORMATS } from "@/lib/core/date-format";

export const dynamic = "force-dynamic";
export const metadata = { title: "How dates read" };

/**
 * How dates read (owner): the organization's one way of writing a day, the same on every screen of every project, no
 * switch. One sheet, the new-document form's way: band, the choice, then the strip with the act.
 */
export default async function DatesPage() {
  await requireOrgAdmin();
  const now = (await orgSettings().catch(() => new Map<string, string>())).get("DATE_FORMAT") ?? "DMY_SHORT";
  return (
    <section id="dates" className="register register-sheet register-sheet-open scroll-mt-24" aria-labelledby="dates-head">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <h2 id="dates-head" className="stencil mr-1 text-slate-500">How dates read</h2>
        <span className="text-[11px] text-slate-500">the organization&rsquo;s, on every screen of every project; the same for everyone</span>
      </div>
      <ActionForm id="dates-form" action={setDateFormatAction} hideSubmit className="asking space-y-4 px-5 py-5 sm:px-6">
        <fieldset className="space-y-2">
          <legend className="stencil mb-1.5 text-slate-500">A day is written</legend>
          <div className="grid grid-cols-1 gap-2 text-xs font-medium text-slate-700 sm:grid-cols-2">
            {DATE_FORMATS.map((one) => (
              <label key={one.code} className="flex items-center gap-1.5">
                <input type="radio" name="format" value={one.code} defaultChecked={one.code === now} required />
                <span className="font-mono text-[13px] text-slate-900">{one.example}</span>
                <span className="text-slate-500">{one.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </ActionForm>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
        <span className="text-[11px] text-slate-500">Exports and the stamp keep their own way of writing dates. A time always reads on 24 hours.</span>
        <button type="submit" form="dates-form" data-on="true" className="ask">Save</button>
      </div>
    </section>
  );
}
