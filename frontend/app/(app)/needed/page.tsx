import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { redirect } from "next/navigation";
import { api, projectPath } from "@/lib/client";
import { getMe } from "@/lib/account/api";
import { fmtDate } from "@/lib/core/utils";
import { SUPPLIER_STAGES, supplierStamp, type SupplierStage } from "@/lib/core/state-names";
import { plannedState, plannedProgress } from "@/lib/actions/planned-state";

export const dynamic = "force-dynamic";
export const metadata = { title: "Where your documents are needed" };

type Need = {
  documentId: string; number: string; title: string; neededBy: string | null; requiredStatuses: string[];
  revision: string | null; stage: string | null; hasReleased: boolean; withSupplier: boolean | null; riskDays: number | null;
};
type Action = { code: string; name: string; start: string | null; finish: string | null; dateToConfirm: boolean; needs: Need[] };

/**
 * What another organization sees of our schedule: the actions that need its documents, and in each only its own
 * documents, with where each stands and whether it is on time. Nothing else of the plan: no other documents, no
 * disciplines, no confirmations, no reasons why an action moved or was postponed.
 */
export default async function NeededPage() {
  const ctx = await requireScope();
  if (ctx.user.isInternal) redirect("/actions");
  const [actions, me] = await Promise.all([
    api<Action[]>(projectPath(ctx, "/supplier-schedule")).catch(() => [] as Action[]),
    getMe(),
  ]);
  const org = me?.tenant.name ?? "us";
  const stageOf = (s: string | null) => (s && (SUPPLIER_STAGES as readonly string[]).includes(s) ? (s as SupplierStage) : null);
  // Where a document is against the day it is needed: ready, submitted, overdue, at risk, days left — as on our side.
  const sayOf = (need: Need, action: Action) => {
    const stage = stageOf(need.stage);
    if (action.dateToConfirm) return null;
    return plannedState(need.neededBy, plannedProgress(need.hasReleased, stage === "RECEIVED" || stage === "IN_REVIEW" ? "RECEIVED" : null, stage), need.riskDays ?? undefined);
  };
  const late = actions.flatMap((a) => a.needs.map((n) => sayOf(n, a))).filter((said) => said?.word.startsWith("overdue")).length;

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="px-5 pt-6 pb-3 sm:px-6">
          <h1 className="plate-title text-slate-950">Where your documents are needed</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            The work of {org} that waits on your documents: each action, its date, and only your documents it needs, with where each stands.
            {actions.length ? ` ${actions.length} action${actions.length === 1 ? "" : "s"}${late ? `, ${late} document${late === 1 ? "" : "s"} overdue` : ""}.` : ""}
          </p>
        </div>
      </section>

      {actions.length ? actions.map((action) => (
        <section key={action.code} className="register register-sheet register-sheet-open">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <span className="stencil mr-1 text-slate-500">{action.name}</span>
            <span className="text-[11px] text-slate-500">
              {action.dateToConfirm ? "date to be confirmed" : action.start ? `${fmtDate(new Date(action.start))}${action.finish && action.finish !== action.start ? ` to ${fmtDate(new Date(action.finish))}` : ""}` : "no date yet"}
              {" "}· {action.needs.length} of your documents
            </span>
          </div>
          <ul className="divide-y divide-line">
            {action.needs.map((need) => {
              const stage = stageOf(need.stage);
              const stamp = stage ? supplierStamp(stage, "theirs", need.withSupplier) : null;
              const said = sayOf(need, action);
              return (
                <li key={need.documentId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-5 py-3 sm:px-6">
                  <p className="min-w-0 text-sm text-slate-800">
                    <Link href={`/documents/${need.documentId}`} className="font-mono font-semibold text-brand-ink hover:underline">{need.number}</Link>
                    {need.revision ? <span className="ml-1.5 font-mono text-xs text-slate-400">rev {need.revision}</span> : null}
                    {stamp ? <span className="stamp ml-2 text-sky-700">{stamp}</span> : null}
                    <span className="block text-xs text-slate-500">{need.title}{need.requiredStatuses.length ? ` · needed at ${need.requiredStatuses.join(" or ")}` : ""}</span>
                  </p>
                  <p className="shrink-0 text-right text-xs text-slate-600">
                    {action.dateToConfirm ? "date to be confirmed" : need.neededBy ? <>needed by {fmtDate(new Date(need.neededBy))}</> : "no date yet"}
                    {said ? <span className={`block text-[11px] ${said.tone}`}>{said.word}</span> : null}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )) : (
        <section className="register register-sheet register-sheet-open px-5 py-8 text-center text-sm text-slate-400 sm:px-6">
          No action of {org} waits on your documents yet. When one does, it appears here with its date.
        </section>
      )}
    </div>
  );
}
