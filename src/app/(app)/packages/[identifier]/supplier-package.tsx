import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { isController, isAdmin } from "@/lib/auth";
import { Chip, DataTable, Th, Td } from "@/components/ui";
import { FileTally } from "./file-tally";
import { removePackageMemberAction, addPackageMemberAction, setPackageRuleAction } from "@/lib/actions/planning";
import { parseExcluded, parseFilter, ownerIds } from "@/lib/package-rule";
import { NextStepBody, type StepItem } from "@/app/(app)/documents/[id]/next-step";
import { RevisionChecklist } from "@/components/revision-checklist";
import { RuleFields } from "../rule-fields";
import { manageItems } from "../manage-items";
import { ActionForm } from "@/components/form";
import { submitSupplierPackageAction } from "@/lib/actions/supplier";
import { supplierRows, supplierFigures, STATE_LABEL, WITH_SUPPLIER, type SupplierState } from "@/lib/supplier";
import { fmtDate } from "@/lib/utils";
import { ArrowLeft, Download } from "lucide-react";

const TONE: Record<SupplierState, string> = {
  NOT_SENT: "bg-slate-100 text-slate-700 ring-slate-200",
  AWAITING_CHECK: "bg-sky-100 text-sky-800 ring-sky-200",
  REJECTED: "bg-red-100 text-red-800 ring-red-200",
  TO_ROUTE: "bg-indigo-100 text-indigo-800 ring-indigo-200",
  IN_REVIEW: "bg-amber-100 text-amber-800 ring-amber-200",
  RETURNED: "bg-orange-100 text-orange-800 ring-orange-200",
  APPROVED: "bg-emerald-100 text-emerald-800 ring-emerald-200",
};

/**
 * Everything one supplier owes us, and where each item stands. The supplier
 * attaches files here and sends them; that is the only way they arrive.
 */
export async function SupplierPackage({ pkg }: { pkg: { id: string; compositionOwnerId: string; compositionOwnerIds: string | null; identifier: string; partyCode: string | null; recipientName: string; completionDate: Date; requiredStatus: string; title: string | null; description: string | null; membershipFilter: string | null; membershipExcluded: string | null; membershipRule: string | null } }) {
  const ctx = await requireScope();
  const { user } = ctx;
  const staff = isController(user) || isAdmin(user);
  const isSupplier = !!user.partyCode && user.partyCode === pkg.partyCode;
  const rows = await supplierRows(ctx, pkg);
  const f = supplierFigures(rows);
  const org = (await ctx.db.scopeConfig.findFirst())?.organizationName ?? "us";
  const canSendRow = (s: SupplierState) => isSupplier && WITH_SUPPLIER.includes(s);

  const table = (
    <div>
      <DataTable className="rounded-none border-0 shadow-none" id={isSupplier ? "supplier-package-own" : "supplier-package"} head={<tr><Th>Document</Th><Th>Submit by</Th><Th>Status</Th><Th>{isSupplier ? "Your file" : "Next"}</Th></tr>}>
          {rows.map((r) => (
            <tr key={r.doc.id}>
              <Td>
                <Link href={`/documents/${r.doc.id}`} className="font-mono text-[13px] font-semibold text-brand-ink hover:underline">{r.doc.docNumber}</Link>
                {r.revision ? <span className="ml-1.5 font-mono text-xs text-slate-400">rev {r.revision.value}</span> : null}
                <span className="block max-w-80 truncate text-xs text-slate-500">{r.doc.title}</span>
              </Td>
              <Td className="whitespace-nowrap text-xs">
                {fmtDate(r.due)}
                {r.revision?.submittedAt ? <span className={`block text-[11px] ${r.arrivedOnTime ? "text-emerald-700" : "text-red-700"}`}>sent {fmtDate(r.revision.submittedAt)}{r.arrivedOnTime ? "" : " — late"}</span>
                  : r.late ? <span className="block text-[11px] text-red-700">overdue</span> : null}
              </Td>
              <Td>
                <Chip className={TONE[r.state]}>{STATE_LABEL[r.state]}{r.state === "RETURNED" && r.outcome ? ` · ${r.outcome}` : ""}</Chip>
                {r.reason ? <p className="mt-1 max-w-72 text-[11px] text-slate-600">“{r.reason}”</p> : null}
              </Td>
              <Td className="text-xs">
                {canSendRow(r.state) ? (
                  <input type="file" name={`file_${r.doc.id}`} className="block w-56 text-xs" />
                ) : staff && r.state === "AWAITING_CHECK" && r.transmittal ? (
                  <Link href={`/transmittals/${r.transmittal.id}`} className="font-semibold text-link hover:underline">Check {r.transmittal.number} →</Link>
                ) : staff && r.state === "TO_ROUTE" && r.transmittal ? (
                  <Link href={`/transmittals/${r.transmittal.id}`} className="font-semibold text-link hover:underline">Send for review →</Link>
                ) : r.state === "APPROVED" ? (
                  <span className="text-emerald-700">done{r.revision?.statusCode ? ` · ${r.revision.statusCode}` : ""}</span>
                ) : WITH_SUPPLIER.includes(r.state) ? (
                  <span className="text-slate-400">with {pkg.recipientName}</span>
                ) : (
                  <span className="text-slate-400">with {org}</span>
                )}
              </Td>
            </tr>
          ))}
      </DataTable>
      {!rows.length ? <p className="mt-2 rounded-2xl border border-dashed border-line-strong px-5 py-8 text-center text-sm text-slate-400">No documents are expected from {pkg.recipientName} yet. Create placeholders with {pkg.recipientName} as the supplier and they appear here.</p> : null}
    </div>
  );

  const waiting = rows.filter((r) => canSendRow(r.state)).length;
  // What Document Control can do to the package itself: narrow it, take
  // documents out or put them back, rename it, delete it.
  const excluded = parseExcluded(pkg.membershipExcluded);
  // The rule a supplier package was made with only names the supplier; a
  // narrowing rule is one with a filter behind it.
  const narrowed = parseFilter(pkg.membershipFilter) ? pkg.membershipRule : null;
  const outDocs = excluded.length ? await ctx.db.document.findMany({ where: { id: { in: excluded } }, orderBy: { docNumber: "asc" }, select: { id: true, docNumber: true, title: true } }) : [];
  // Admin, Document Control, or whoever created the package.
  const mayManage = staff || ownerIds(pkg).includes(user.id);
  const manage: StepItem[] = mayManage ? [
    {
      key: "remove",
      label: "Take documents out",
      body: (
        <ActionForm action={removePackageMemberAction} submitLabel="Take the ticked documents out" size="sm" variant="secondary" hidden={{ packageId: pkg.id }}>
          <div className="-mx-5 border-y border-line sm:-mx-6">
            <RevisionChecklist name="documentId" rows={rows.map((r) => ({ id: r.doc.id, number: r.doc.docNumber, rev: r.revision?.value ?? "—", status: r.revision?.statusCode ?? null, title: r.doc.title }))} />
          </div>
        </ActionForm>
      ),
    },
    ...(outDocs.length ? [{
      key: "back",
      label: `Put back (${outDocs.length} taken out)`,
      body: (
        <ActionForm action={addPackageMemberAction} submitLabel="Put the ticked documents back" size="sm" hidden={{ packageId: pkg.id }}>
          <div className="-mx-5 border-y border-line sm:-mx-6">
            <RevisionChecklist name="documentId" rows={outDocs.map((d) => ({ id: d.id, number: d.docNumber, rev: "—", status: null, title: d.title }))} />
          </div>
        </ActionForm>
      ),
    }] : []),
    {
      key: "rule",
      label: narrowed ? "Change the rule" : "Narrow by a rule",
      body: (
        <ActionForm action={setPackageRuleAction} submitLabel="Save the rule" size="sm" hidden={{ packageId: pkg.id }}>
          <p className="text-xs text-slate-500">Only documents from {pkg.recipientName} that match all you choose stay in the package — for example only Electrical, or only technical datasheets. New ones that match join by themselves. Clear every choice to take everything from them again.</p>
          <RuleFields supplier initial={parseFilter(pkg.membershipFilter)} />
        </ActionForm>
      ),
    },
    ...manageItems(pkg, { mayEdit: true, mayDelete: true }),
  ] : [];

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col-reverse gap-3 px-5 pt-6 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">{pkg.identifier}</p>
            <h1 className="plate-name mt-1 min-w-0">{isSupplier ? `What ${org} expects from you` : pkg.title ?? `From ${pkg.recipientName}`}</h1>
            <p className="plate-meta mt-2">
              {f.planned} document{f.planned === 1 ? "" : "s"} &middot; everything by {fmtDate(pkg.completionDate)} &middot; needed at <span className="font-mono font-semibold text-slate-700">{pkg.requiredStatus}</span>
            </p>
            <p className="mt-1 max-w-3xl text-[11.5px] leading-4 text-slate-400">
              {isSupplier
                ? `Attach a file next to each document you deliver, then send. ${org} checks it and either accepts it for review or returns it with a reason.`
                : `Every document whose supplier is ${pkg.recipientName}${narrowed ? ` — only those ${narrowed.replace(/^every document /, "")} —` : ""} is in this package${excluded.length ? `, less ${excluded.length} taken out` : ""}. The supplier sends from here; nothing else counts as arrived.`}
            </p>
            {pkg.description ? <p className="mt-1.5 max-w-3xl text-[13px] leading-5 text-slate-600">{pkg.description}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2 lg:justify-end">
            {pkg.partyCode ? <a href={`/api/requirements/sheet?sender=${encodeURIComponent(pkg.partyCode)}`} className="ask inline-flex items-center gap-1.5"><Download className="h-3.5 w-3.5" /> Delivery list</a> : null}
            {staff ? <Link href="/packages" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Packages</Link> : null}
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-line sm:grid-cols-4">
          <Figure label="Sent" value={`${f.arrived} of ${f.planned}`} hint={`${f.submissionProgress}% · ${f.notArrivedLate} overdue`} />
          <Figure label="On time" value={`${f.onSchedule}%`} hint={`${f.late} late`} />
          <Figure label="Waiting on" value={`${f.pendingOurs} us · ${f.pendingSupplier} them`} hint="review vs supplier" />
          <Figure label="Approved first time" value={`${f.firstTime}%`} hint={`${f.approved} approved`} />
        </div>
      </section>

      {manage.length ? (
        <section className="register register-sheet register-sheet-open">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <span className="stencil text-slate-600">The package</span>
          </div>
          <NextStepBody
            items={manage}
            status={<p className="text-[13px] text-slate-600">{narrowed ? <>Only documents from {pkg.recipientName} {narrowed.replace(/^every document /, "")}.</> : <>Everything from {pkg.recipientName}.</>}{excluded.length ? <> {excluded.length} taken out by hand.</> : null}</p>}
          />
        </section>
      ) : null}

      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil text-slate-600">{isSupplier ? "Send documents" : "Documents"}</span>
          <span className="text-[11px] text-slate-500">{f.pendingSupplier} with {isSupplier ? "you" : pkg.recipientName} · {f.pendingOurs} with {isSupplier ? org : "us"}</span>
        </div>
        {isSupplier ? (
          <ActionForm action={submitSupplierPackageAction} submitLabel={`Send to ${org}`} hidden={{ packageId: pkg.id }}>
            {table}
            <div className="px-5 sm:px-6">{waiting ? <FileTally waiting={waiting} /> : <p className="text-[12px] text-slate-500">Nothing is waiting on you right now.</p>}</div>
          </ActionForm>
        ) : table}
      </section>
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="border-line px-5 py-3 not-last:border-r sm:px-6">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
      <p className="text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}
