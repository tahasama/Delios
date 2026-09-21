import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { isController, isAdmin } from "@/lib/auth";
import { PageHeader, Chip, Banner } from "@/components/ui";
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
export async function SupplierPackage({ pkg }: { pkg: { id: string; identifier: string; partyCode: string | null; recipientName: string; completionDate: Date; requiredStatus: string } }) {
  const ctx = await requireScope();
  const { user } = ctx;
  const staff = isController(user) || isAdmin(user);
  const isSupplier = !!user.partyCode && user.partyCode === pkg.partyCode;
  const rows = await supplierRows(ctx, pkg);
  const f = supplierFigures(rows);
  const org = (await ctx.db.scopeConfig.findFirst())?.organizationName ?? "us";
  const canSendRow = (s: SupplierState) => isSupplier && WITH_SUPPLIER.includes(s);

  const table = (
    <div className="scroll-thin overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-100 text-sm">
        <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
          <tr><th className="px-4 py-2.5">Document</th><th className="px-4 py-2.5">Submit by</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">{isSupplier ? "Your file" : "Next"}</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.doc.id} className="align-top">
              <td className="px-4 py-3">
                <Link href={`/documents/${r.doc.id}`} className="font-mono text-[13px] font-semibold text-[#1e3a5f] hover:underline">{r.doc.docNumber}</Link>
                {r.revision ? <span className="ml-1.5 font-mono text-xs text-slate-400">rev {r.revision.value}</span> : null}
                <span className="block max-w-80 truncate text-xs text-slate-500">{r.doc.title}</span>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-xs">
                {fmtDate(r.due)}
                {r.revision?.submittedAt ? <span className={`block text-[11px] ${r.arrivedOnTime ? "text-emerald-700" : "text-red-700"}`}>sent {fmtDate(r.revision.submittedAt)}{r.arrivedOnTime ? "" : " — late"}</span>
                  : r.late ? <span className="block text-[11px] text-red-700">overdue</span> : null}
              </td>
              <td className="px-4 py-3">
                <Chip className={TONE[r.state]}>{STATE_LABEL[r.state]}{r.state === "RETURNED" && r.outcome ? ` · ${r.outcome}` : ""}</Chip>
                {r.reason ? <p className="mt-1 max-w-72 text-[11px] text-slate-600">“{r.reason}”</p> : null}
              </td>
              <td className="px-4 py-3 text-xs">
                {canSendRow(r.state) ? (
                  <input type="file" name={`file_${r.doc.id}`} className="block w-56 text-xs" />
                ) : staff && r.state === "AWAITING_CHECK" && r.transmittal ? (
                  <Link href={`/transmittals/${r.transmittal.id}`} className="font-semibold text-[#315f83] hover:underline">Check {r.transmittal.number} →</Link>
                ) : staff && r.state === "TO_ROUTE" && r.transmittal ? (
                  <Link href={`/transmittals/${r.transmittal.id}`} className="font-semibold text-[#315f83] hover:underline">Send for review →</Link>
                ) : r.state === "APPROVED" ? (
                  <span className="text-emerald-700">done{r.revision?.statusCode ? ` · ${r.revision.statusCode}` : ""}</span>
                ) : WITH_SUPPLIER.includes(r.state) ? (
                  <span className="text-slate-400">with {pkg.recipientName}</span>
                ) : (
                  <span className="text-slate-400">with {org}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? <p className="px-5 py-8 text-center text-sm text-slate-400">No documents are expected from {pkg.recipientName} yet. Create placeholders with {pkg.recipientName} as the supplier and they appear here.</p> : null}
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${pkg.recipientName} — documents`}
        subtitle={`${pkg.identifier} · everything due by ${fmtDate(pkg.completionDate)} · needed at ${pkg.requiredStatus}`}
        actions={<>{pkg.partyCode ? <a href={`/api/requirements/sheet?sender=${encodeURIComponent(pkg.partyCode)}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Download className="h-4 w-4" /> Delivery list</a> : null}<Link href="/packages" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Packages</Link></>}
      />

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 shadow-sm sm:grid-cols-4">
        <Figure label="Sent" value={`${f.arrived} of ${f.planned}`} hint={`${f.submissionProgress}% · ${f.notArrivedLate} overdue`} />
        <Figure label="On time" value={`${f.onSchedule}%`} hint={`${f.late} late`} />
        <Figure label="Waiting on" value={`${f.pendingOurs} us · ${f.pendingSupplier} them`} hint="review vs supplier" />
        <Figure label="Approved first time" value={`${f.firstTime}%`} hint={`${f.approved} approved`} />
      </section>

      {isSupplier ? (
        <>
          <Banner tone="info" title="How to send">Attach a file next to each document you are delivering, then press Send. {org} checks it and either accepts it for review or returns it with a reason.</Banner>
          <ActionForm action={submitSupplierPackageAction} submitLabel={`Send to ${org}`} hidden={{ packageId: pkg.id }}>
            {table}
          </ActionForm>
        </>
      ) : table}
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
      <p className="text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}
