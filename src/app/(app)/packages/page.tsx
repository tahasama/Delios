import Link from "next/link";
import { api } from "@/lib/api/client";
import type { ListValue, PackageSummary } from "@/lib/api/types";
import { requireSession, projectPath } from "@/lib/session";
import { LISTS } from "@/lib/lists";
import { packageLists } from "./lists";
import { CreateForm, SupplyForm } from "./forms";
import { day, PACKAGE_STATES } from "./states";

export const dynamic = "force-dynamic";
export const metadata = { title: "Packages" };

const TABS = [
  { code: "SUPPLY", label: "From suppliers", says: "What a supplier owes us: its placeholders, asked for on a transmittal and sent back on theirs." },
  { code: "DELIVERY", label: "To deliver", says: "Documents we hand over together, each at the status it needs, by a date." },
] as const;

/**
 * Packages, of two kinds. From suppliers: what one supplier owes us, which its
 * own people see too. To deliver: documents we hand to one or several
 * organizations together, each at a status, by a date.
 */
export default async function PackagesPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const session = await requireSession();
  // Another organization sees only what it owes us.
  const kind = !session.user.isInternal || (await searchParams).kind !== "DELIVERY" ? "SUPPLY" : "DELIVERY";
  const tab = TABS.find((t) => t.code === kind)!;
  const mayCreate = session.user.isInternal && (session.can("CREATE") || session.can("TRANSMIT") || session.can("CONTROL"));
  const [packages, lists, reasons] = await Promise.all([
    api<PackageSummary[]>(projectPath(session, "/packages")).then((all) => all.filter((p) => p.kind === kind)),
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
        <p className="mt-1 max-w-2xl text-[11.5px] leading-4 text-slate-500">{session.user.isInternal ? tab.says : "What your company is asked to send us, and where each document stands."}</p>
        {session.user.isInternal ? (
          <nav className="seg mt-3 w-fit max-w-full">
            {TABS.map((t) => <Link key={t.code} href={`/packages?kind=${t.code}`} aria-current={t.code === kind ? "page" : undefined} className="segment">{t.label}</Link>)}
          </nav>
        ) : null}
      </div>
      {packages.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-line bg-tint-soft"><tr><th className={th}>Package</th><th className={th}>State</th><th className={th}>Documents</th><th className={th}>{kind === "SUPPLY" ? "Supplier" : "Why"}</th><th className={th}>Due</th></tr></thead>
            <tbody className="divide-y divide-line">
              {packages.map((p) => {
                const state = PACKAGE_STATES[p.state] ?? { label: p.state.toLowerCase(), tone: "bg-slate-100 text-slate-600" };
                const late = p.state === "OPEN" && !!p.completionDate && p.completionDate < today;
                return (
                  <tr key={p.id} className="hover:bg-tint-soft">
                    <td className={td}><Link href={`/packages/${p.id}`} className="font-mono text-[13px] font-semibold text-brand-ink hover:underline">{p.number}</Link><span className="block max-w-80 truncate text-[13px] text-slate-800">{p.title}</span></td>
                    <td className={td}><span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${late ? "bg-red-100 text-red-800" : state.tone}`}>{late ? "overdue" : state.label}</span></td>
                    <td className={`${td} text-xs`}>{p.members}{p.hasRule ? <span className="block text-[11px] text-slate-400">fills itself by a rule</span> : null}</td>
                    <td className={`${td} text-xs`}>{kind === "SUPPLY" ? <>{p.supplier}{p.purchaseOrder ? <span className="block text-[11px] text-slate-400">{p.purchaseOrder}</span> : null}</> : reason(p.reason)}</td>
                    <td className={`${td} whitespace-nowrap text-xs ${late ? "font-semibold text-red-700" : ""}`}>{day(p.completionDate) || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="px-5 py-8 text-center text-sm text-slate-400 sm:px-6">{kind === "SUPPLY"
        ? session.user.isInternal ? "No supply packages yet. One holds every placeholder a supplier owes us." : "Nothing is asked of your company yet."
        : "No delivery packages yet. One groups documents we hand to an organization together by a date."}</p>}
    </section>

    {lists ? (
      <details className="register register-sheet register-sheet-open">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 sm:px-6">
          <span className="text-[13px] text-slate-600">{kind === "SUPPLY" ? "Expecting documents from a supplier?" : "Documents to hand over together?"}</span>
          <span className="ask">{kind === "SUPPLY" ? "New supply package" : "New delivery package"}</span>
        </summary>
        <div className="border-t border-line px-5 py-4 sm:px-6">
          {kind === "SUPPLY"
            ? <SupplyForm statuses={lists.statuses} reasons={lists.reasons} people={lists.people} suppliers={lists.parties} orders={lists.orders} rule={lists.rule} me={session.user.id} />
            : <CreateForm statuses={lists.statuses} reasons={lists.reasons} people={lists.people} parties={lists.parties} rule={lists.rule} me={session.user.id} />}
        </div>
      </details>
    ) : null}
  </div>;
}
