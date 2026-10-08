import Link from "next/link";
import { api } from "@/lib/api/client";
import type { ListValue, PackageSummary } from "@/lib/api/types";
import { requireSession, projectPath } from "@/lib/session";
import { LISTS } from "@/lib/lists";
import { packageLists } from "./lists";
import { CreateForm } from "./forms";
import { day, PACKAGE_STATES } from "./states";

export const dynamic = "force-dynamic";
export const metadata = { title: "Packages" };

/**
 * Packages: documents we hand to one or several organizations together, each
 * at a status, by a date. Put together, checked, delivered on transmittals,
 * then accepted.
 */
export default async function PackagesPage() {
  const session = await requireSession();
  const mayCreate = session.user.isInternal && (session.can("CREATE") || session.can("TRANSMIT") || session.can("CONTROL"));
  const [packages, lists, reasons] = await Promise.all([
    api<PackageSummary[]>(projectPath(session, "/packages")),
    mayCreate ? packageLists(session) : null,
    api<Record<string, ListValue[]>>("/api/values", { query: { sets: LISTS.reasonsForIssue } }),
  ]);
  const reason = (code: string) => reasons[LISTS.reasonsForIssue]?.find((v) => v.code === code)?.label ?? code;
  const th = "stencil px-3 py-2 text-left font-normal text-slate-500 first:pl-5 sm:first:pl-6";
  const td = "px-3 py-2.5 align-top first:pl-5 sm:first:pl-6";
  const today = new Date().toISOString().slice(0, 10);

  return <div className="space-y-4">
    <section className="register register-sheet register-sheet-open">
      <div className="border-b border-line px-5 pt-6 pb-3 sm:px-6">
        <h1 className="plate-title min-w-0 text-slate-950">Packages</h1>
        <p className="mt-1 max-w-2xl text-[11.5px] leading-4 text-slate-500">Documents we hand over together, each at the status it needs, by a date.</p>
      </div>
      {packages.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-line bg-tint-soft"><tr><th className={th}>Package</th><th className={th}>State</th><th className={th}>Documents</th><th className={th}>Why</th><th className={th}>Due</th></tr></thead>
            <tbody className="divide-y divide-line">
              {packages.map((p) => {
                const state = PACKAGE_STATES[p.state] ?? { label: p.state.toLowerCase(), tone: "bg-slate-100 text-slate-600" };
                const late = p.state === "OPEN" && !!p.completionDate && p.completionDate < today;
                return (
                  <tr key={p.id} className="hover:bg-tint-soft">
                    <td className={td}><Link href={`/packages/${p.id}`} className="font-mono text-[13px] font-semibold text-brand-ink hover:underline">{p.number}</Link><span className="block max-w-80 truncate text-[13px] text-slate-800">{p.title}</span></td>
                    <td className={td}><span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${late ? "bg-red-100 text-red-800" : state.tone}`}>{late ? "overdue" : state.label}</span></td>
                    <td className={`${td} text-xs`}>{p.members}{p.hasRule ? <span className="block text-[11px] text-slate-400">fills itself by a rule</span> : null}</td>
                    <td className={`${td} text-xs`}>{reason(p.reason)}</td>
                    <td className={`${td} whitespace-nowrap text-xs ${late ? "font-semibold text-red-700" : ""}`}>{day(p.completionDate) || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="px-5 py-8 text-center text-sm text-slate-400 sm:px-6">No packages yet. One groups documents we hand to an organization together by a date.</p>}
    </section>

    {lists ? (
      <details className="register register-sheet register-sheet-open">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 sm:px-6">
          <span className="text-[13px] text-slate-600">Documents to hand over together?</span>
          <span className="ask">New package</span>
        </summary>
        <div className="border-t border-line px-5 py-4 sm:px-6">
          <CreateForm statuses={lists.statuses} reasons={lists.reasons} people={lists.people} parties={lists.parties} rule={lists.rule} me={session.user.id} />
        </div>
      </details>
    ) : null}
  </div>;
}
