import { ActionForm } from "@/components/form";
import { inputCls } from "@/components/ui";
import { fmtDate } from "@/lib/core/utils";
import { resetProjectAction } from "@/lib/organization/forms";

type Copy = { id: string; code: string; name: string; since: string; by: string };

/** The cards a project may have its own copy of, in words. */
const WORDS = { numbering: "numbering", revisions: "revision naming", routes: "review routes" } as const;

/**
 * The projects that took their own copy of a card (where projects may change it), since when and by whom, each with its
 * reset (owner: in the organization's Settings only, for special messes): back to the organization's, always with why;
 * the project's control function is told. Nothing a project gave (numbers, records) changes.
 */
export function ProjectCopies({ what, copies }: { what: keyof typeof WORDS; copies: Copy[] }) {
  return (
    <section className="register register-sheet register-sheet-open">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span className="stencil mr-1 text-slate-500">Projects with their own</span>
        <span className="text-[11px] text-slate-500">changed on the project while it was free; changes here never touch them</span>
      </div>
      {copies.length ? (
        <ul className="divide-y divide-line">
          {copies.map((one) => (
            <li key={one.id} className="grid grid-cols-1 items-start gap-x-6 gap-y-2 px-5 py-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:px-6">
              <div>
                <p className="text-[13px] font-semibold text-slate-800"><span className="font-mono">{one.code}</span> · {one.name}</p>
                <p className="text-[11.5px] text-slate-500">its own since {fmtDate(one.since)}, by {one.by}</p>
              </div>
              <details>
                <summary className="cursor-pointer text-[11.5px] font-semibold text-slate-500 hover:text-slate-800">For a mess only: put it back to the organization&rsquo;s</summary>
                <ActionForm action={resetProjectAction} submitLabel={`Put ${one.code} back`} size="sm" variant="danger" hidden={{ what, projectId: one.id }}
                  confirmText={`${one.code} loses its own ${WORDS[what]} and uses the organization's again. What it already gave stays as it is. Go ahead?`}
                  className="mt-2 flex flex-wrap items-end gap-2 space-y-0">
                  <label className="min-w-64 flex-1">
                    <span className="sr-only">Why</span>
                    <input name="reason" required maxLength={300} placeholder="Why, told to its control function" className={inputCls} />
                  </label>
                </ActionForm>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-3 text-xs text-slate-500 sm:px-6">None: every project uses the organization&rsquo;s.</p>
      )}
    </section>
  );
}
