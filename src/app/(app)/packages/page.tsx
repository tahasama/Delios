import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader, Field, inputCls, DataTable, Th, Td, EmptyState, Info } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { createPackageAction } from "@/lib/actions/planning";
import { createSupplierPackageAction } from "@/lib/actions/supplier";
import { supplierRows, supplierFigures } from "@/lib/supplier";
import { isController, isAdmin } from "@/lib/auth";
import { departmentsOf } from "@/lib/schedule";
import { getActiveSet } from "@/lib/config";
import { fmtDate } from "@/lib/utils";
import { Download, FilePlus2 } from "lucide-react";
import { isReadOnly } from "@/lib/auth";
import { holdersOf } from "@/lib/permissions";
import { SearchPick } from "@/components/search-pick";

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
  const parties = staff ? await db.party.findMany({ where: { isInternal: false }, orderBy: { name: "asc" } }) : [];
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

  return <div className="space-y-6">
    <PageHeader title="Packages" actions={<a href="/api/export/packages" className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Download className="h-4 w-4"/> Export CSV</a>} />

    {supplierOnly ? null : (
      <nav className="flex gap-1 rounded-xl bg-slate-100 p-1 sm:w-fit">
        {(["SUPPLIER", "DELIVERY"] as const).map((c) => (
          <Link key={c} href={`/packages?category=${c}`} className={`rounded-lg px-3 py-2 text-xs font-semibold ${category === c ? "bg-surface text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{c === "SUPPLIER" ? "From suppliers" : "To deliver"}</Link>
        ))}
      </nav>
    )}

    {category === "SUPPLIER" ? (
      rows.length ? (
        <DataTable head={<tr><Th>Supplier</Th><Th>Sent</Th><Th>Overdue</Th><Th>Waiting on</Th><Th>Due</Th></tr>}>
          {rows.map((pkg) => {
            const f = supplierStats.get(pkg.id)!;
            return (
              <tr key={pkg.id}>
                <Td><Link href={`/packages/${pkg.identifier}`} className="font-semibold text-brand-ink hover:underline">{pkg.recipientName}</Link><span className="block font-mono text-[11px] text-slate-400">{pkg.identifier}</span></Td>
                <Td className="text-xs">{f.arrived} of {f.planned} <span className="text-slate-400">({f.submissionProgress}%)</span></Td>
                <Td className={`text-xs ${f.notArrivedLate ? "font-semibold text-red-700" : "text-slate-400"}`}>{f.notArrivedLate || "—"}</Td>
                <Td className="text-xs">{f.pendingOurs} with us · {f.pendingSupplier} with them</Td>
                <Td className="whitespace-nowrap text-xs">{fmtDate(pkg.completionDate)}</Td>
              </tr>
            );
          })}
        </DataTable>
      ) : <EmptyState title={supplierOnly ? "Nothing is expected from you yet" : "No supplier packages yet"} body={supplierOnly ? "When documents are requested from your company they appear here." : "A supplier package lists every document you expect from one supplier. They upload and send from it."} />
    ) : rows.length ? (
      <DataTable head={<tr><Th>Package</Th><Th>Status</Th><Th title="Ready means the document's current released revision carries the status the package asks for, released on or before the package date.">Documents ready <Info>Ready: the document&apos;s current released revision carries the status the package asks for. Not ready means it was never released, it is at another status, or a newer revision has replaced it.</Info></Th><Th>Due</Th><Th>Accepted by</Th></tr>}>
        {rows.map((pkg) => {
          const percent = pkg.total ? Math.round(pkg.ready / pkg.total * 100) : 0;
          return (
            <tr key={pkg.id}>
              <Td><Link href={`/packages/${pkg.identifier}`} className="font-mono text-[13px] font-semibold text-brand-ink hover:underline">{pkg.identifier}</Link><span className="block max-w-72 truncate text-xs text-slate-500">{pkg.recipientName}</span></Td>
              <Td><Status state={pkg.state}/></Td>
              <Td><div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${percent === 100 ? "bg-emerald-500" : "bg-[#d9a441]"}`} style={{ width: `${percent}%` }}/></div><span className="text-xs text-slate-600">{pkg.ready} of {pkg.total} at {pkg.requiredStatus}{statusMeaning.get(pkg.requiredStatus) ? <Info>{`${pkg.requiredStatus} — ${statusMeaning.get(pkg.requiredStatus)}`}</Info> : null}</span></div></Td>
              <Td className="whitespace-nowrap text-xs">{fmtDate(pkg.completionDate)}{!pkg.closedAt ? <span className={`block text-[11px] ${pkg.days < 0 ? "text-red-700" : "text-slate-400"}`}>{pkg.days < 0 ? `${Math.abs(pkg.days)} days late` : `in ${pkg.days} days`}</span> : null}</Td>
              <Td className="text-xs">{pkg.acceptanceAuthorityName}</Td>
            </tr>
          );
        })}
      </DataTable>
    ) : <EmptyState title="No delivery packages yet" body="A delivery package groups documents we must hand over together by a date." />}

    {staff && category === "SUPPLIER" ? (
      <details className="rounded-2xl border border-line bg-surface px-5 py-3 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-brand-ink">+ New supplier package</summary>
        <div className="mt-3 max-w-2xl">
          <ActionForm action={createSupplierPackageAction} submitLabel="Create">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Supplier" required><select name="partyCode" required className={inputCls} defaultValue=""><option value="" disabled>Choose…</option>{parties.map((p) => <option key={p.id} value={p.code}>{p.name}</option>)}</select></Field>
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

    {!isReadOnly(user) && category === "DELIVERY" ? <details className="group rounded-2xl border border-line bg-surface shadow-sm"><summary className="flex cursor-pointer list-none items-center justify-between px-6 py-5"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-tint text-link"><FilePlus2 className="h-5 w-5"/></span><div><p className="text-sm font-semibold text-slate-900">Create a package</p><p className="mt-1 text-xs text-slate-500">Define its purpose, composition rule, date and independent acceptance authority.</p></div></div><span className="text-xs font-semibold text-link group-open:hidden">Open form</span></summary><div className="border-t border-line px-6 py-5"><ActionForm action={createPackageAction} submitLabel="Create package"><div className="grid grid-cols-1 gap-4 md:grid-cols-3"><Field label="Identifier" required hint="unique, never reused"><input name="identifier" required className={inputCls} placeholder="PK-001"/></Field><Field label="Purpose" required><select name="purpose" required className={inputCls} defaultValue=""><option value="" disabled>Select…</option>{reasons.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></Field><Field label="Type" required><select name="type" required className={inputCls} defaultValue="DEFINED"><option value="DEFINED">Defined composition</option><option value="ACCUMULATED">Rule-based accumulated</option></select></Field><Field label="Membership rule" className="md:col-span-3" hint="required for an accumulated package"><input name="membershipRule" className={inputCls} placeholder="Every document tagged to WT-401 at IFC"/></Field><Field label="Recipient" required><input name="recipientName" required className={inputCls}/></Field><Field label="Completion date" required><input type="date" name="completionDate" required className={inputCls}/></Field><Field label="Required status" required><select name="requiredStatus" required className={inputCls} defaultValue=""><option value="" disabled>Select…</option>{statuses.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</select></Field><SearchPick single name="compositionOwnerId" required label="Composition owner" items={users.map((person) => ({ id: person.id, name: person.name }))} /><SearchPick single name="acceptanceAuthorityId" required label="Acceptance authority" hint="must be independent" items={users.map((person) => ({ id: person.id, name: person.name }))} /></div></ActionForm></div></details> : null}
  </div>;
}

function Status({ state }: { state: string }) { const cls = state === "READY" || state === "CLOSED" ? "bg-emerald-100 text-emerald-800" : state === "OVERDUE" ? "bg-red-100 text-red-800" : state === "SHORTFALL" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"; return <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${cls}`}>{state.toLowerCase()}</span>; }
