import { Select } from "@/components/select";
import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { Field, inputCls, Info, ToneChip, DataTable, Th, Td } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { Asked, Added } from "@/components/policy-fields";
import { formPolicy } from "@/lib/settings/field-policy";
import { createPackageAction } from "@/lib/packages/forms";
import { createSupplierPackageAction } from "@/lib/packages/forms-supplier";
import { supplierRows, packageCounts, packageStage } from "@/lib/packages/supplier";
import { isController, isAdmin, standsInForControl } from "@/lib/core/auth";
import { getActiveSet } from "@/lib/settings/config";
import { fmtDate } from "@/lib/core/utils";
import { isReadOnly } from "@/lib/core/auth";
import { SearchPick } from "@/components/search-pick";
import { RuleFields } from "./rule-fields";
import { statusList, shortfallOf } from "@/lib/packages/package-rule";
import { packagesOf, ourPeople, packageParties, packagesAtTop, packageByNumber } from "@/lib/packages/api";
import { PackageTree, treeOf } from "./arborescence";
import { PackageDock, PackageTick, PackageTickAll } from "./package-dock";

export const dynamic = "force-dynamic";
export const metadata = { title: "Packages" };

/** How many packages the list shows at first, and adds at each "Load more". */
const PACKAGES_FIRST = 50;

export default async function PackagesPage({ searchParams }: { searchParams: Promise<{ category?: string; from?: string; docs?: string; view?: string; parent?: string; show?: string }> }) {
  const ctx = await requireScope();
  const packagePolicy = await formPolicy(ctx, "PACKAGE");
  const { user } = ctx;
  const staff = isController(user) || isAdmin(user) || standsInForControl(user);
  // A supplier only ever sees its own package.
  const supplierOnly = !user.isInternal;
  const sp = await searchParams;
  const requested = sp.category;
  // A supplier package delivered: a new delivery package starts with its documents.
  const fromPackage = sp.from ?? null;
  const carried = (sp.docs ?? "").split(",").map((one) => one.trim()).filter(Boolean);
  // Activities live in Schedule & actions now; a package is what we receive from a supplier, or what we hand over.
  // Outside readers see the packages that concern them — theirs to deliver, or
  // addressed to them — and nothing else; the tenant client sees to that.
  const category = requested === "DELIVERY" ? "DELIVERY" : "SUPPLIER";
  const kind = category === "SUPPLIER" ? "SUPPLY" : "DELIVERY";
  // Two ways to read packages that hold packages (owner): the list of those at the top, each drilled into from its page,
  // or the whole tree; both open the same package page. The list reads only the packages at the top, a page at a time.
  const view = sp.view === "tree" ? "tree" : "list";
  const shown = Math.min(Math.max(Number(sp.show) || PACKAGES_FIRST, PACKAGES_FIRST), 5000);
  const paged = view === "list" && user.isInternal;
  const [read, statuses, users] = await Promise.all([
    paged ? packagesAtTop(ctx, kind, shown + 1) : packagesOf(ctx, kind),
    getActiveSet("STATUSES"),
    // Anyone on the project may put a package together or accept it.
    ourPeople(ctx),
  ]);
  // Another organization's people: what is asked of them (a supplier's package shared with them), and what was
  // delivered to them, of either kind, read only (owner: "the same view of the package the sender has").
  const theirs = supplierOnly
    ? category === "DELIVERY"
      ? [...read, ...(await packagesOf(ctx, "SUPPLY"))].filter((one) => one.deliveredToUs)
      : read.filter((one) => !one.deliveredToUs)
    : read;
  const more = paged && theirs.length > shown;
  const pkgs = more ? theirs.slice(0, shown) : theirs;
  // A status code on its own says nothing to a newcomer: AB is "as-built".
  const statusMeaning = new Map(statuses.map((s) => [s.code, typeof s.props.may === "string" ? `${s.label}: ${s.props.may}` : s.label]));
  // Our own organization first: a package may be an internal handover.
  const parties = supplierOnly ? [] : await packageParties(ctx);
  const supplierStats = new Map<string, ReturnType<typeof packageCounts>>();
  // Where each supplier's package stands as a whole, in the reader's words.
  const supplierStages = new Map<string, ReturnType<typeof packageStage>>();
  // Each document is due on its own date: the package shows the soonest still not sent in.
  const nextDue = new Map<string, Date | null>();
  if (category === "SUPPLIER") for (const p of pkgs) {
    const lines = await supplierRows(ctx, p);
    nextDue.set(p.id, lines.filter((one) => one.state === "NOT_SENT" && one.due).map((one) => one.due!).sort((a, b) => a.getTime() - b.getTime())[0] ?? null);
    supplierStats.set(p.id, packageCounts(p, lines));
    supplierStages.set(p.id, packageStage(p, lines, supplierOnly ? "theirs" : "ours"));
  }
  // "For the schedule": each action's documents, read as a package.
  const rows = pkgs.map((pkg) => {
    const ready = pkg.members.filter((member) => member.ready).length;
    const total = pkg.members.length;
    const days = pkg.completionDate ? Math.ceil((new Date(pkg.completionDate).getTime() - Date.now()) / 86_400_000) : 0;
    const state = pkg.acceptedAt ? "ACCEPTED" : pkg.closedAt ? "CLOSED" : shortfallOf(pkg) ? "SHORTFALL" : pkg.assessedAt ? "READY" : days < 0 ? "OVERDUE" : "OPEN";
    return { ...pkg, ready, total, days, state };
  });

  const seen = new Set(pkgs.map((one) => one.id));
  const atTop = (one: { place?: { parentId: string | null } | null }) => !one.place?.parentId || !seen.has(one.place.parentId);
  const shownRows = view === "list" && !paged ? rows.filter(atTop) : rows;
  const nested = paged ? pkgs.some((one) => (one.place?.branches.length ?? 0) > 0) : pkgs.some((one) => !atTop(one));
  // A new package inside another one ("New package in it" on its page): the package it goes in, of this kind.
  const asked = sp.parent ? await packageByNumber(ctx, sp.parent) : null;
  const parent = asked && asked.kind === kind ? asked : null;
  const moreHref = (() => {
    const params = new URLSearchParams();
    if (requested) params.set("category", requested);
    params.set("show", String(shown + PACKAGES_FIRST));
    return `/packages?${params}`;
  })();
  const inside = (count: number) => count ? <span className="block text-[11px] text-slate-500">{count} package{count === 1 ? "" : "s"} in it</span> : null;

  const tabs = [
    { code: "SUPPLIER", label: "Supplier packages", says: "exchanged with a supplier: its placeholders, what it sends, our check and review, handed back and forth; delivered on a transmittal once complete" },
    { code: "DELIVERY", label: "Our packages", says: "our documents filed together, made, reviewed and released in our space; delivered on a transmittal once complete, to whom we choose then" },
  ] as const;
  const outsideTabs = [
    { code: "SUPPLIER", label: "Asked of you", says: "what your company is asked to send, and where each document stands" },
    { code: "DELIVERY", label: "Delivered to you", says: "packages delivered to your company: read as their sender reads them; ask about them by an information transmittal" },
  ] as const;
  const shownTabs = supplierOnly ? outsideTabs : tabs;
  const here = shownTabs.find((one) => one.code === category)!;

  return <div className="space-y-4">
    <section data-dt-frame className="register register-sheet">
      <div className="border-b border-line px-5 pt-5 pb-2.5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="plate-title min-w-0 text-slate-950">Packages</h1>
          {/* The package for everything (owner): every document's files in one zip, filed by the tree or as chosen. */}
          {user.isInternal && (isController(user) || isAdmin(user)) ? <Link href="/full-download" className="ask">Full download</Link> : null}
        </div>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">{here.says.charAt(0).toUpperCase() + here.says.slice(1) + "."}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <nav className="seg w-fit max-w-full">
            {shownTabs.map((c) => (
              <Link key={c.code} href={`/packages?category=${c.code}${view === "tree" ? "&view=tree" : ""}`} aria-current={category === c.code ? "page" : undefined} className="segment">{c.label}</Link>
            ))}
          </nav>
          {/* The list of packages at the top, or the whole tree (owner: both). */}
          <nav className="seg ml-auto w-fit" aria-label="How the packages read">
            <Link href={`/packages?category=${category}`} aria-current={view === "list" ? "page" : undefined} className="segment">List</Link>
            <Link href={`/packages?category=${category}&view=tree`} aria-current={view === "tree" ? "page" : undefined} className="segment">Tree</Link>
          </nav>
        </div>
        {view === "list" && nested ? <p className="mt-2 text-[11px] text-slate-500">Packages sitting in another are reached from its page, or read them all in the tree.</p> : null}
      </div>

      {view === "tree" ? (
        rows.length ? <PackageTree nodes={treeOf(pkgs)} />
          : <p className="px-5 py-8 text-center text-sm text-slate-400 sm:px-6">No packages yet.</p>
      ) : category === "SUPPLIER" ? (
        shownRows.length ? (
          <DataTable className="rounded-none border-0 shadow-none" id="supplier-packages" exportName="supplier-packages" head={supplierOnly
            ? <tr><Th className="w-10"><PackageTickAll ids={shownRows.map((one) => one.id)} /></Th><Th>Package</Th><Th>Where it stands</Th><Th>With you</Th><Th>With us</Th><Th>Released</Th><Th>Overdue</Th><Th>Next due</Th></tr>
            : <tr><Th className="w-10"><PackageTickAll ids={shownRows.map((one) => one.id)} /></Th><Th>Supplier</Th><Th>Where it stands</Th><Th title="Ours to send to the supplier">Not sent yet</Th><Th title="The supplier holds them: to send, correct or revise">With the supplier</Th><Th title="We hold them: to check, to send for review, or in review">With us</Th><Th>Released</Th><Th>Overdue</Th><Th>Next due</Th></tr>}>
                {shownRows.map((pkg) => {
                  const f = supplierStats.get(pkg.id)!;
                  const where = supplierStages.get(pkg.id)!;
                  return (
                    <tr key={pkg.id}>
                      <Td className="w-10"><PackageTick id={pkg.id} number={pkg.number} /></Td>
                      <Td><Link href={`/packages/${pkg.number}`} className="font-semibold text-brand-ink hover:underline">{pkg.title ?? pkg.names.to}</Link><span className="block font-mono text-[11px] text-slate-400">{pkg.number}</span>{inside(pkg.place?.branches.length ?? 0)}</Td>
                      <Td className={`text-xs`}>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ${where.tone}`}>{where.word}</span>
                      </Td>
                      {supplierOnly ? null : <Td className="text-xs tabular-nums">{f.notSent ? `${f.notSent} of ${f.total}` : <span className="text-slate-400">none</span>}</Td>}
                      <Td className="text-xs tabular-nums">{f.withThem} of {f.total}</Td>
                      <Td className="text-xs tabular-nums">{f.withUs} of {f.total}{f.toCheck ? <span className="block text-[11px] text-slate-500">{f.toCheck} to check</span> : null}</Td>
                      <Td className="text-xs tabular-nums">{f.released} of {f.total}</Td>
                      <Td className={`text-xs ${f.late ? "font-semibold text-red-700" : "text-slate-400"}`}>{f.late || "—"}</Td>
                      <Td className={`whitespace-nowrap text-xs`}>{nextDue.get(pkg.id) ? <>next {fmtDate(nextDue.get(pkg.id)!)}</> : <span className="text-slate-400">—</span>}</Td>
                    </tr>
                  );
                })}
          </DataTable>
        ) : <p className="px-5 py-8 text-center text-sm text-slate-400 sm:px-6">{supplierOnly ? "Nothing is expected from you yet. When documents are requested from your company they appear here." : "No supplier packages yet. One lists every document you expect from one supplier; they send from it."}</p>
      ) : shownRows.length ? (
        <DataTable className="rounded-none border-0 shadow-none" id="delivery-packages" exportName="delivery-packages" head={<tr><Th className="w-10"><PackageTickAll ids={shownRows.map((one) => one.id)} /></Th><Th>Package</Th><Th>State</Th><Th title="Ready: the document's current released revision carries the status the package asks for.">Ready</Th><Th>Due</Th><Th>Accepted by</Th></tr>}>
              {shownRows.map((pkg) => {
                const percent = pkg.total ? Math.round(pkg.ready / pkg.total * 100) : 0;
                return (
                  <tr key={pkg.id}>
                    <Td className="w-10"><PackageTick id={pkg.id} number={pkg.number} /></Td>
                    <Td><Link href={`/packages/${pkg.number}`} className="font-mono text-[13px] font-semibold text-brand-ink hover:underline">{pkg.number}</Link><span className="block max-w-80 truncate text-[13px] text-slate-800">{pkg.title ?? `Delivery to ${pkg.names.to}`}</span><span className="block max-w-80 truncate text-xs text-slate-500">to {pkg.names.to}</span>{inside(pkg.place?.branches.length ?? 0)}</Td>
                    <Td><Status state={pkg.state}/></Td>
                    <Td><div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-canvas-deep"><div className={`bar-build h-full rounded-full ${percent === 100 ? "bg-emerald-500" : "bg-gold"}`} style={{ width: `${percent}%` }}/></div><span className="text-xs text-slate-600">{pkg.ready} of {pkg.total} at {pkg.requiredStatuses.join(" or ")}<Info>{pkg.requiredStatuses.map((code) => `${code} — ${statusMeaning.get(code) ?? code}`).join("\n")}</Info></span></div></Td>
                    <Td className={`whitespace-nowrap text-xs`}>{fmtDate(pkg.completionDate)}{!pkg.closedAt ? <span className={`block text-[11px] ${pkg.days < 0 ? "text-red-700" : "text-slate-400"}`}>{pkg.days < 0 ? `${Math.abs(pkg.days)} days late` : `in ${pkg.days} days`}</span> : null}</Td>
                    <Td className={`text-xs`}>{pkg.names.acceptors}</Td>
                  </tr>
                );
              })}
        </DataTable>
      ) : <p className="px-5 py-8 text-center text-sm text-slate-400 sm:px-6">No packages of ours yet. One files our documents together, to deliver them once complete.</p>}
      {more ? (
        <div className="border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">
          {`The first ${pkgs.length}, soonest due first. `}
          <Link href={moreHref} className="font-semibold text-link hover:underline">Load more</Link>
        </div>
      ) : null}
    </section>

    {/* The bottom bar for the packages ticked (owner: the ticks did nothing). */}
    {view === "list" && shownRows.length ? (
      <PackageDock
        packages={shownRows.map((one) => ({ id: one.id, number: one.number, title: one.title ?? one.names.to, open: !one.closedAt && one.state === "OPEN",
          inTree: !!one.place?.parentId, members: one.members.length, supplier: one.supplierPartyId,
          sent: one.transmittals.some((t) => t.items > 0) || !!one.sharedAt }))}
        targets={pkgs.filter((one) => !one.closedAt && one.state === "OPEN").map((one) => ({ id: one.id, number: one.number, title: one.title ?? one.names.to, supplier: one.supplierPartyId }))}
        manage={staff && !supplierOnly}
        deliver={staff && !supplierOnly}
      />
    ) : null}

    {staff && category === "SUPPLIER" ? (
      <details id="new" className="register register-sheet register-sheet-open" open={!!parent}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 sm:px-6">
          <span className="text-[13px] text-slate-600">{parent ? <>A package inside <span className="font-mono font-semibold">{parent.number}</span> · {parent.title}, for {parent.supplier ?? parent.names.to}.</> : "Expecting documents from a new supplier?"}</span>
          <span className="ask">New supplier package</span>
        </summary>
        <div className="border-t border-line px-5 py-4 sm:px-6">
          <ActionForm action={createSupplierPackageAction} submitLabel="Create" hidden={parent ? { parentId: parent.id, partyCode: parent.names.supplierCode ?? "" } : undefined}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {parent ? (
                <Field label="Name" required hint="what this part holds, e.g. Mechanical, Datasheets"><input name="title" required className={inputCls} /></Field>
              ) : (
                <Field label="Supplier" required><Select name="partyCode" required className={inputCls} defaultValue=""><option value="" disabled>Choose…</option>{parties.filter((p) => !p.isInternal).map((p) => <option key={p.id} value={p.code}>{p.name}</option>)}</Select></Field>
              )}
              <Field label="PO" hint="optional — one package per PO"><input name="po" className={inputCls} /></Field>
              <Field label="Needed at status" hint="optional — each document goes as it is asked"><Select name="requiredStatus" className={inputCls} defaultValue=""><option value="">None</option>{statuses.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</Select></Field>
            </div>
            <p className="text-[11px] text-slate-500">Every placeholder whose supplier is this company is in the package automatically. Each document is due on its own planned date.</p>
          </ActionForm>
        </div>
      </details>
    ) : null}

    {!isReadOnly(user) && !supplierOnly && category === "DELIVERY" ? (
      <details id="new" className="register register-sheet register-sheet-open" open={carried.length > 0 || !!parent}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 sm:px-6">
          <span className="text-[13px] text-slate-600">{parent ? <>A package inside <span className="font-mono font-semibold">{parent.number}</span> · {parent.title}.</> : fromPackage ? `Deliver ${fromPackage}: its ${carried.length} document${carried.length === 1 ? "" : "s"} go in this delivery package.` : "Documents to file together?"}</span>
          <span className="ask">New package</span>
        </summary>
        <div className="border-t border-line px-5 py-4 sm:px-6">
          {fromPackage ? (
            <p className="mb-3 text-[12px] text-slate-600">
              Or add them to a package of ours already open:{" "}
              <Link href={`/packages/add?${new URLSearchParams({ docs: carried.join(",") })}`} className="font-semibold text-link hover:underline">choose it</Link>.
              Each is delivered at the status the package needs, checked as any delivery is.
            </p>
          ) : null}
          <ActionForm action={createPackageAction} submitLabel="Create package" hidden={{ ...(fromPackage ? { from: fromPackage } : {}), ...(parent ? { parentId: parent.id } : {}) }}>
            {carried.map((id) => <input key={id} type="hidden" name="documentId" value={id} />)}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Asked policy={packagePolicy} field="title" hint="numbered PK-… when created" className="md:col-span-2">
                {({ required }) => <input name="title" required={required} className={inputCls} defaultValue={fromPackage ? `${fromPackage} — handover` : undefined} placeholder="Operations handover — pump house" />}
              </Asked>
              <Asked policy={packagePolicy} field="completionDate">
                {({ required }) => <input type="date" name="completionDate" required={required} className={inputCls} defaultValue={parent?.completionDate?.slice(0, 10)} />}
              </Asked>
              <Asked policy={packagePolicy} field="description" hint="what it is for, anything the recipient should know" className="md:col-span-2">
                {({ required }) => <textarea name="description" required={required} rows={2} className={inputCls} />}
              </Asked>
              {/* Under "Due": what it needs, beside the description. */}
              <SearchPick browse name="requiredStatus" initial={parent?.requiredStatuses} required label="Needed at" hint="ready at any of them; it also says why they get it" items={statuses.map((item) => ({ id: item.code, name: item.code, detail: item.label }))} />
              <SearchPick name="compositionOwnerId" initial={parent?.ownerIds} required label="Put together by" hint="one or several — they add and take out its documents; the control function does the rest" items={users.map((person) => ({ id: person.id, name: person.name, detail: person.functionName }))} />
              <SearchPick name="acceptanceAuthorityId" initial={parent?.acceptorIds} required label="Accepted by" hint="one or several, not those putting it together — any one of them accepts at the end and decides on anything missing" items={users.map((person) => ({ id: person.id, name: person.name, detail: person.functionName }))} />
              <Added fields={packagePolicy.own} />
            </div>
            <div className="rounded-md bg-tint-soft px-3 py-2.5 ring-1 ring-line">
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
  return <ToneChip inRegister tone={tone}>{state === "CLOSED" ? "delivered" : state.toLowerCase()}</ToneChip>;
}
