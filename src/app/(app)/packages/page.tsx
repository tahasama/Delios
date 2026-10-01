import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { Field, inputCls, Info } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { createPackageAction } from "@/lib/actions/planning";
import { createSupplierPackageAction } from "@/lib/actions/supplier";
import { supplierRows, supplierFigures } from "@/lib/supplier";
import { isController, isAdmin } from "@/lib/auth";
import { departmentsOf } from "@/lib/schedule";
import { getActiveSet } from "@/lib/config";
import { fmtDate } from "@/lib/utils";
import { Download } from "lucide-react";
import { isReadOnly } from "@/lib/auth";
import { holdersOf } from "@/lib/permissions";
import { SearchPick } from "@/components/search-pick";
import { RuleFields } from "./rule-fields";

export const dynamic = "force-dynamic";
export const metadata = { title: "Packages" };

export default async function PackagesPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const staff = isController(user) || isAdmin(user);
  // A supplier only ever sees its own package.
  const supplierOnly = !user.isInternal;
  const requested = (await searchParams).category;
  // Activities live in Schedule & actions now; a package is what we receive from a supplier, or what we hand over.
  const category = supplierOnly ? "SUPPLIER" : requested === "DELIVERY" ? "DELIVERY" : "SUPPLIER";
  const [pkgs, reasons, statuses, users] = await Promise.all([
    db.package.findMany({ where: { category, ...(supplierOnly ? { partyCode: user.partyCode ?? "-" } : {}) }, orderBy: { completionDate: "asc" }, include: { members: { include: { document: { include: { revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1 } } } } } } }),
    getActiveSet("REASONS_FOR_ISSUE"), getActiveSet("STATUSES"),
    holdersOf(ctx, "REVIEW"),
  ]);
  // A status code on its own says nothing to a newcomer: AB is "as-built".
  const statusMeaning = new Map(statuses.map((s) => [s.code, typeof s.props.may === "string" ? `${s.label}: ${s.props.may}` : s.label]));
  const parties = supplierOnly ? [] : await db.party.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const supplierStats = new Map<string, ReturnType<typeof supplierFigures>>();
  if (category === "SUPPLIER") for (const p of pkgs) supplierStats.set(p.id, supplierFigures(await supplierRows(ctx, p)));
  // "For the schedule": each action's documents, read as a package.
  const rows = pkgs.map((pkg) => {
    const ready = pkg.members.filter((member) => member.document.revisions[0]?.statusCode === member.requiredStatus).length;
    const total = pkg.members.length;
    const days = Math.ceil((pkg.completionDate.getTime() - Date.now()) / 86_400_000);
    const state = pkg.closedAt ? "CLOSED" : pkg.shortfall ? "SHORTFALL" : pkg.assessedAt ? "READY" : days < 0 ? "OVERDUE" : "OPEN";
    return { ...pkg, ready, total, days, state };
  });

  const tabs = [
    { code: "SUPPLIER", label: "From suppliers", says: "everything a supplier owes us; they send from it" },
    { code: "DELIVERY", label: "To deliver", says: "documents we hand to an organization by a date, on one transmittal" },
  ] as const;
  const here = tabs.find((one) => one.code === category)!;
  const th = "stencil px-3 py-2 text-left font-normal text-slate-500 first:pl-5 sm:first:pl-6";
  const td = "px-3 py-2.5 align-top first:pl-5 sm:first:pl-6";

  return <div className="space-y-4">
    <section className="register register-sheet register-sheet-open">
      <div className="border-b border-line px-5 pt-6 pb-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="plate-title min-w-0 text-slate-950">Packages</h1>
          <a href="/api/export/packages" className="ask inline-flex items-center gap-1.5"><Download className="h-3.5 w-3.5"/> Export CSV</a>
        </div>
        <p className="mt-1 max-w-2xl text-[11.5px] leading-4 text-slate-500">{supplierOnly ? "What your company is asked to send, and where each document stands." : here.says.charAt(0).toUpperCase() + here.says.slice(1) + "."}</p>
        {supplierOnly ? null : (
          <nav className="seg mt-3 w-fit max-w-full">
            {tabs.map((c) => (
              <Link key={c.code} href={`/packages?category=${c.code}`} aria-current={category === c.code ? "page" : undefined} className="segment">{c.label}</Link>
            ))}
          </nav>
        )}
      </div>

      {category === "SUPPLIER" ? (
        rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-line bg-tint-soft"><tr><th className={th}>Supplier</th><th className={th}>Sent</th><th className={th}>Overdue</th><th className={th}>Waiting on</th><th className={th}>Due</th></tr></thead>
              <tbody className="divide-y divide-line">
                {rows.map((pkg) => {
                  const f = supplierStats.get(pkg.id)!;
                  return (
                    <tr key={pkg.id} className="hover:bg-tint-soft">
                      <td className={td}><Link href={`/packages/${pkg.identifier}`} className="font-semibold text-brand-ink hover:underline">{pkg.recipientName}</Link><span className="block font-mono text-[11px] text-slate-400">{pkg.identifier}</span></td>
                      <td className={`${td} text-xs`}>{f.arrived} of {f.planned} <span className="text-slate-400">({f.submissionProgress}%)</span></td>
                      <td className={`${td} text-xs ${f.notArrivedLate ? "font-semibold text-red-700" : "text-slate-400"}`}>{f.notArrivedLate || "—"}</td>
                      <td className={`${td} text-xs`}>{f.pendingOurs} with us · {f.pendingSupplier} with them</td>
                      <td className={`${td} whitespace-nowrap text-xs`}>{fmtDate(pkg.completionDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="px-5 py-8 text-center text-sm text-slate-400 sm:px-6">{supplierOnly ? "Nothing is expected from you yet. When documents are requested from your company they appear here." : "No supplier packages yet. One lists every document you expect from one supplier; they send from it."}</p>
      ) : rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-line bg-tint-soft"><tr><th className={th}>Package</th><th className={th}>State</th><th className={th}>Ready <Info>Ready: the document&apos;s current released revision carries the status the package asks for.</Info></th><th className={th}>Due</th><th className={th}>Accepted by</th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((pkg) => {
                const percent = pkg.total ? Math.round(pkg.ready / pkg.total * 100) : 0;
                return (
                  <tr key={pkg.id} className="hover:bg-tint-soft">
                    <td className={td}><Link href={`/packages/${pkg.identifier}`} className="font-mono text-[13px] font-semibold text-brand-ink hover:underline">{pkg.identifier}</Link><span className="block max-w-72 truncate text-xs text-slate-500">to {pkg.recipientName}</span></td>
                    <td className={td}><Status state={pkg.state}/></td>
                    <td className={td}><div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-canvas-deep"><div className={`h-full rounded-full ${percent === 100 ? "bg-emerald-500" : "bg-[#d9a441]"}`} style={{ width: `${percent}%` }}/></div><span className="text-xs text-slate-600">{pkg.ready} of {pkg.total} at {pkg.requiredStatus}{statusMeaning.get(pkg.requiredStatus) ? <Info>{`${pkg.requiredStatus} — ${statusMeaning.get(pkg.requiredStatus)}`}</Info> : null}</span></div></td>
                    <td className={`${td} whitespace-nowrap text-xs`}>{fmtDate(pkg.completionDate)}{!pkg.closedAt ? <span className={`block text-[11px] ${pkg.days < 0 ? "text-red-700" : "text-slate-400"}`}>{pkg.days < 0 ? `${Math.abs(pkg.days)} days late` : `in ${pkg.days} days`}</span> : null}</td>
                    <td className={`${td} text-xs`}>{pkg.acceptanceAuthorityName}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="px-5 py-8 text-center text-sm text-slate-400 sm:px-6">No delivery packages yet. One groups documents we hand to an organization together by a date.</p>}
    </section>

    {staff && category === "SUPPLIER" ? (
      <details className="register register-sheet register-sheet-open">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 sm:px-6">
          <span className="text-[13px] text-slate-600">Expecting documents from a new supplier?</span>
          <span className="ask">New supplier package</span>
        </summary>
        <div className="border-t border-line px-5 py-4 sm:px-6">
          <ActionForm action={createSupplierPackageAction} submitLabel="Create">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Supplier" required><select name="partyCode" required className={inputCls} defaultValue=""><option value="" disabled>Choose…</option>{parties.filter((p) => !p.isInternal).map((p) => <option key={p.id} value={p.code}>{p.name}</option>)}</select></Field>
              <Field label="PO" hint="optional — one package per PO"><input name="po" className={inputCls} /></Field>
              <Field label="Everything due by" required><input type="date" name="dueDate" required className={inputCls} /></Field>
              <Field label="Needed at status" required><select name="requiredStatus" required className={inputCls} defaultValue=""><option value="" disabled>Choose…</option>{statuses.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</select></Field>
              <SearchPick single name="acceptanceAuthorityId" required label="Accepted by" hint="someone other than you" items={users.filter((u) => u.id !== user.id).map((person) => ({ id: person.id, name: person.name }))} />
            </div>
            <p className="text-[11px] text-slate-500">Every placeholder whose supplier is this company is in the package automatically.</p>
          </ActionForm>
        </div>
      </details>
    ) : null}

    {!isReadOnly(user) && category === "DELIVERY" ? (
      <details className="register register-sheet register-sheet-open">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 sm:px-6">
          <span className="text-[13px] text-slate-600">Documents to hand over together?</span>
          <span className="ask">New delivery package</span>
        </summary>
        <div className="border-t border-line px-5 py-4 sm:px-6">
          <ActionForm action={createPackageAction} submitLabel="Create package">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Identifier" required hint="unique, never reused"><input name="identifier" required className={inputCls} placeholder="PK-001"/></Field>
              <SearchPick single browse name="recipientPartyId" required label="Delivered to" hint="the organization that receives it" items={parties.map((p) => ({ id: p.id, name: p.name }))} />
              <Field label="Why they get it" required><select name="purpose" required className={inputCls} defaultValue=""><option value="" disabled>Choose…</option>{reasons.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></Field>
              <Field label="Needed at" required><select name="requiredStatus" required className={inputCls} defaultValue=""><option value="" disabled>Choose…</option>{statuses.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</select></Field>
              <Field label="Due" required><input type="date" name="completionDate" required className={inputCls}/></Field>
              <SearchPick single name="compositionOwnerId" required label="Put together by" items={users.map((person) => ({ id: person.id, name: person.name }))} />
              <SearchPick single name="acceptanceAuthorityId" required label="Accepted by" hint="someone else — decides on anything missing" items={users.map((person) => ({ id: person.id, name: person.name }))} />
            </div>
            <div className="rounded-lg bg-tint-soft px-4 py-3">
              <p className="mb-3 flex flex-wrap items-baseline gap-x-2"><span className="stencil text-slate-500">Fills itself with</span><span className="text-[11px] text-slate-400">optional — every document matching all you choose joins, new ones too; you can still add or take out by hand</span></p>
              <RuleFields />
            </div>
          </ActionForm>
        </div>
      </details>
    ) : null}
  </div>;
}

function Status({ state }: { state: string }) { const cls = state === "READY" || state === "CLOSED" ? "bg-emerald-100 text-emerald-800" : state === "OVERDUE" ? "bg-red-100 text-red-800" : state === "SHORTFALL" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"; return <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${cls}`}>{state === "CLOSED" ? "delivered" : state.toLowerCase()}</span>; }
