import { requireScope } from "@/lib/scope";
import { api, projectPath } from "@/lib/api/client";
import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { confirmPersonAction, refusePersonAction } from "@/lib/actions/people";

export const dynamic = "force-dynamic";
export const metadata = { title: "People to confirm" };

type Pending = {
  membershipId: string; userId: string; name: string; organization: string | null; function: string; department: string | null;
  since: string; proposedBy: string | null; confirmerId: string | null; confirmerName: string | null; mine: boolean;
};

/**
 * The people added to this project who join once management confirms them.
 * Whoever was named confirms, or anyone holding Manage when nobody was; the
 * others are listed with who they wait for.
 */
export default async function PeopleToConfirmPage() {
  const ctx = await requireScope();
  const rows = await api<Pending[]>(projectPath(ctx, "/people/pending")).catch(() => [] as Pending[]);

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="px-5 pt-6 pb-4 sm:px-6">
          <h1 className="plate-name">People to confirm</h1>
          <p className="plate-meta mt-2">{rows.length ? `${rows.length} waiting to join ${ctx.project.code}` : `Nobody is waiting to join ${ctx.project.code}`}</p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Confirmed, they join the project. Refused, they do not, and whoever added them reads why.</p>
        </div>
      </section>
      {rows.length ? (
        <section className="register register-sheet register-sheet-open">
          <ul className="divide-y divide-line">
            {rows.map((one) => (
              <li key={one.membershipId} className="space-y-3 px-5 py-3.5 sm:px-6">
                <p className="text-xs leading-5 text-slate-700">
                  <span className="text-sm font-semibold text-slate-900">{one.name}</span>
                  {one.organization ? <span className="ml-1.5 text-slate-500">· {one.organization}</span> : null}
                  <span className="block">{one.function}{one.department ? ` · ${one.department}` : ""} — added by {one.proposedBy ?? "someone"}, {fmtDate(one.since)}</span>
                </p>
                {one.mine ? (
                  <div className="flex flex-wrap items-start gap-3">
                    <ActionForm action={confirmPersonAction} submitLabel="Confirm" size="sm" hidden={{ membershipId: one.membershipId }} className="space-y-0" />
                    <details className="min-w-0 flex-1 text-xs">
                      <summary className="cursor-pointer font-semibold text-link">Refuse</summary>
                      <ActionForm action={refusePersonAction} submitLabel="Refuse" variant="secondary" size="sm" hidden={{ membershipId: one.membershipId }} className="mt-2 space-y-3">
                        <Field label="Why" required hint={`${one.proposedBy ?? "Whoever added them"} is told`}>
                          <textarea name="note" required rows={2} className={inputCls} />
                        </Field>
                      </ActionForm>
                    </details>
                  </div>
                ) : (
                  <p className="text-xs text-amber-800">Waiting for {one.confirmerName ?? "management"} to confirm.</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
