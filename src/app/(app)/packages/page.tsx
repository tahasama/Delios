import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { Field, inputCls, Info, ToneChip, DataTable, Th, Td } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { Asked, Added } from "@/components/policy-fields";
import { formPolicy } from "@/lib/field-policy";
import { createPackageAction } from "@/lib/actions/planning";
import { createSupplierPackageAction } from "@/lib/actions/supplier";
import { supplierRows, packageCounts, packageStage } from "@/lib/supplier";
import { isController, isAdmin } from "@/lib/auth";
import { departmentsOf } from "@/lib/schedule";
import { getActiveSet } from "@/lib/config";
import { fmtDate } from "@/lib/utils";
import { Download } from "lucide-react";
import { isReadOnly } from "@/lib/auth";
import { SearchPick } from "@/components/search-pick";
import { RuleFields } from "./rule-fields";
import { meetsStatus, statusList } from "@/lib/package-rule";
import { legacyPackages, ourPeople, packageParties } from "@/lib/api/packages";

export const dynamic = "force-dynamic";
export const metadata = { title: "Packages" };

export default async function PackagesPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const ctx = await requireScope();
  const packagePolicy = await formPolicy(ctx, "PACKAGE");
  const { user } = ctx;
  const staff = isController(user) || isAdmin(user);
  // A supplier only ever sees its own package.
  const supplierOnly = !user.isInternal;
  const requested = (await searchParams).category;
  // Activities live in Schedule & actions now; a package is what we receive from a supplier, or what we hand over.
  // Outside readers see the packages that concern them — theirs to deliver, or
  // addressed to them — and nothing else; the tenant client sees to that.
  const category = requested === "DELIVERY" ? "DELIVERY" : "SUPPLIER";
  const [pkgs, reasons, statuses, users] = await Promise.all([
    legacyPackages(ctx, category),
    getActiveSet("REASONS_FOR_ISSUE"), getActiveSet("STATUSES"),
    // Anyone on the project may put a package together or accept it.
    ourPeople(ctx),
  ]);
  // A status code on its own says nothing to a newcomer: AB is "as-built".
  const statusMeaning = new Map(statuses.map((s) => [s.code, typeof s.props.may === "string" ? `${s.label}: ${s.props.may}` : s.label]));
  // Our own organization first: a package may be an internal handover.
  const parties = supplierOnly ? [] : await packageParties(ctx);
  const supplierStats = new Map<string, ReturnType<typeof packageCounts>>();
  // Where each supplier's package stands as a whole, in the reader's words.
  const supplierStages = new Map<string, ReturnType<typeof packageStage>>();
  if (category === "SUPPLIER") for (const p of pkgs) {
    const lines = await supplierRows(ctx, p);
    supplierStats.set(p.id, packageCounts(p, lines));
    supplierStages.set(p.id, packageStage(p, lines, supplierOnly ? "theirs" : "ours"));
  }
  // "For the schedule": each action's documents, read as a package.
  const rows = pkgs.map((pkg) => {
    const ready = pkg.members.filter((member) => meetsStatus(member.document.revisions[0]?.statusCode, member.requiredStatus)).length;
    const total = pkg.members.length;
    const days = pkg.completionDate ? Math.ceil((pkg.completionDate.getTime() - Date.now()) / 86_400_000) : 0;
    const state = pkg.acceptedAt ? "ACCEPTED" : pkg.closedAt ? "CLOSED" : pkg.shortfall ? "SHORTFALL" : pkg.assessedAt ? "READY" : days < 0 ? "OVERDUE" : "OPEN";
    return { ...pkg, ready, total, days, state };
  });

  const tabs = [
    { code: "SUPPLIER", label: "From suppliers", says: "everything a supplier owes us; they send from it" },
    { code: "DELIVERY", label: "To deliver", says: "documents we hand to an organization by a date, on one transmittal" },
  ] as const;
  const here = tabs.find((one) => one.code === category)!;

  return <div className="space-y-4">
    <section className="register register-sheet register-sheet-open">
      <div className="border-b border-line px-5 pt-5 pb-2.5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="plate-title min-w-0 text-slate-950">Packages</h1>
          <a href="/api/export/packages" className="ask inline-flex items-center gap-1.5"><Download className="h-3.5 w-3.5"/> Export CSV</a>
        </div>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">{supplierOnly ? "What your company is asked to send, and where each document stands." : here.says.charAt(0).toUpperCase() + here.says.slice(1) + "."}</p>
        {(
          <nav className="seg mt-3 w-fit max-w-full">
            {tabs.map((c) => (
              <Link key={c.code} href={`/packages?category=${c.code}`} aria-current={category === c.code ? "page" : undefined} className="segment">{c.label}</Link>
            ))}
          </nav>
        )}
      </div>

      {category === "SUPPLIER" ? (
        rows.length ? (
          <DataTable className="rounded-none border-0 shadow-none" id="supplier-packages" exportName="supplier-packages" head={supplierOnly
            ? <tr><Th>Package</Th><Th>Where it stands</Th><Th>Transmitted</Th><Th>Overdue</Th><Th>With you</Th><Th>Due</Th></tr>
            : <tr><Th>Supplier</Th><Th>Where it stands</Th><Th>Sent to supplier</Th><Th>Received</Th><Th>Overdue</Th><Th>Held</Th><Th>Due</Th></tr>}>
                {rows.map((pkg) => {
                  const f = supplierStats.get(pkg.id)!;
                  const where = supplierStages.get(pkg.id)!;
                  return (
                    <tr key={pkg.id}>
                      <Td><Link href={`/packages/${pkg.identifier}`} className="font-semibold text-brand-ink hover:underline">{pkg.title ?? pkg.recipientName}</Link><span className="block font-mono text-[11px] text-slate-400">{pkg.identifier}</span></Td>
                      <Td className={`text-xs`}>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ${where.tone}`}>{where.word}</span>
                        {where.notAsked ? <span className="mt-1 block text-[11px] text-slate-500">{where.notAsked} not sent to supplier yet</span> : null}
                      </Td>
                      {supplierOnly ? null : <Td className="text-xs">{f.sent} of {f.total}</Td>}
                      <Td className="text-xs">{f.received} of {supplierOnly ? f.sent : f.total}</Td>
                      <Td className={`text-xs ${f.late ? "font-semibold text-red-700" : "text-slate-400"}`}>{f.late || "—"}</Td>
                      <Td className="text-xs">{supplierOnly ? f.withThem : `${f.withThem} by them · ${f.withUs} by us`}</Td>
                      <Td className={`whitespace-nowrap text-xs`}>{fmtDate(pkg.completionDate)}</Td>
                    </tr>
                  );
                })}
          </DataTable>
        ) : <p className="px-5 py-8 text-center text-sm text-slate-400 sm:px-6">{supplierOnly ? "Nothing is expected from you yet. When documents are requested from your company they appear here." : "No supplier packages yet. One lists every document you expect from one supplier; they send from it."}</p>
      ) : rows.length ? (
        <DataTable className="rounded-none border-0 shadow-none" id="delivery-packages" exportName="delivery-packages" head={<tr><Th>Package</Th><Th>State</Th><Th title="Ready: the document's current released revision carries the status the package asks for.">Ready</Th><Th>Due</Th><Th>Accepted by</Th></tr>}>
              {rows.map((pkg) => {
                const percent = pkg.total ? Math.round(pkg.ready / pkg.total * 100) : 0;
                return (
                  <tr key={pkg.id}>
                    <Td><Link href={`/packages/${pkg.identifier}`} className="font-mono text-[13px] font-semibold text-brand-ink hover:underline">{pkg.identifier}</Link><span className="block max-w-80 truncate text-[13px] text-slate-800">{pkg.title ?? `Delivery to ${pkg.recipientName}`}</span><span className="block max-w-80 truncate text-xs text-slate-500">to {pkg.recipientName}</span></Td>
                    <Td><Status state={pkg.state}/></Td>
                    <Td><div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-canvas-deep"><div className={`h-full rounded-full ${percent === 100 ? "bg-emerald-500" : "bg-[#d9a441]"}`} style={{ width: `${percent}%` }}/></div><span className="text-xs text-slate-600">{pkg.ready} of {pkg.total} at {statusList(pkg.requiredStatus).join(" or ")}<Info>{statusList(pkg.requiredStatus).map((code) => `${code} — ${statusMeaning.get(code) ?? code}`).join("\n")}</Info></span></div></Td>
                    <Td className={`whitespace-nowrap text-xs`}>{fmtDate(pkg.completionDate)}{!pkg.closedAt ? <span className={`block text-[11px] ${pkg.days < 0 ? "text-red-700" : "text-slate-400"}`}>{pkg.days < 0 ? `${Math.abs(pkg.days)} days late` : `in ${pkg.days} days`}</span> : null}</Td>
                    <Td className={`text-xs`}>{pkg.acceptanceAuthorityName}</Td>
                  </tr>
                );
              })}
        </DataTable>
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
              <SearchPick name="acceptanceAuthorityId" required label="Accepted by" hint="one or several, not you — any one of them accepts" items={users.filter((u) => u.id !== user.id).map((person) => ({ id: person.id, name: person.name }))} />
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
              <Asked policy={packagePolicy} field="title" hint="numbered PK-… when created" className="md:col-span-2">
                {({ required }) => <input name="title" required={required} className={inputCls} placeholder="Operations handover — pump house" />}
              </Asked>
              <Asked policy={packagePolicy} field="completionDate">
                {({ required }) => <input type="date" name="completionDate" required={required} className={inputCls} />}
              </Asked>
              <Asked policy={packagePolicy} field="description" hint="what it is for, anything the recipient should know" className="md:col-span-3">
                {({ required }) => <textarea name="description" required={required} rows={2} className={inputCls} />}
              </Asked>
              <Added fields={packagePolicy.own} />
              <SearchPick browse name="recipientPartyIds" required label="Delivered to" hint="one or several — us too, for an internal handover" items={parties.map((p) => ({ id: p.id, name: p.isInternal ? `${p.name} (us)` : p.name }))} />
              <SearchPick browse name="purpose" required label="Why they get it" hint="one or several" items={reasons.map((item) => ({ id: item.code, name: item.label, detail: item.code }))} />
              <SearchPick browse name="requiredStatus" required label="Needed at" hint="one or several — ready at any of them" items={statuses.map((item) => ({ id: item.code, name: item.code, detail: item.label }))} />
              <SearchPick name="compositionOwnerId" required label="Put together by" hint="one or several" items={users.map((person) => ({ id: person.id, name: person.name, detail: person.functionName }))} />
              <SearchPick name="acceptanceAuthorityId" required label="Accepted by" hint="one or several, not those putting it together — any one of them accepts at the end and decides on anything missing" items={users.map((person) => ({ id: person.id, name: person.name, detail: person.functionName }))} />
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

function Status({ state }: { state: string }) {
  const tone = state === "READY" || state === "CLOSED" || state === "ACCEPTED" ? "done" : state === "OVERDUE" ? "refused" : state === "SHORTFALL" ? "waiting" : "idle";
  return <ToneChip tone={tone}>{state === "CLOSED" ? "delivered" : state.toLowerCase()}</ToneChip>;
}
