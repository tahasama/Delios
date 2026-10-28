import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { Select } from "@/components/select";
import { issueInvoiceAction, invoicePaidAction, voidInvoiceAction } from "@/lib/console/forms";
import { INVOICE_TONE, INVOICE_WORDS, PAID_BY, money, type BillingDetails, type InvoiceRow, type Plan } from "@/lib/console/types";
import { cn, fmtDate } from "@/lib/core/utils";
import { Nothing, Sheet } from "../../parts";

/**
 * An organization's billing in the console: who its invoices are made out to (its own administrators keep it), every
 * invoice with its PDF, a payment recorded when it arrives (the period paid moves on by itself), a mistake voided with
 * why, and a new invoice, its first line filled from its plan and paid users.
 */
export function Billing({ tenantId, details, invoices, plan, users }: {
  tenantId: string; details: BillingDetails | null; invoices: InvoiceRow[]; plan: Plan | null; users: number;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const inMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const open = invoices.filter((i) => i.state === "ISSUED");
  return (
    <Sheet title="Billing" said={open.length ? `${open.length} waiting for payment: ${open.map((i) => money(i.total, i.currency)).join(", ")}` : "nothing waiting for payment"}>
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 border-line lg:border-r">
          <div className="border-b border-line px-5 py-3 text-[12px] text-slate-700 sm:px-6">
            <p className="stencil mb-1 text-slate-500">Billed to</p>
            {details ? (
              <p className="whitespace-pre-line">{[details.legalName, details.address, details.country, details.taxNumber ? `Tax number: ${details.taxNumber}` : null,
                details.email ? `Invoices to ${details.email}` : null].filter(Boolean).join("\n")}</p>
            ) : <p className="text-amber-700">Not given yet: its administrators fill it in on Contract &amp; plan. Until then invoices carry its name only.</p>}
          </div>
          {invoices.length ? (
            <ul className="divide-y divide-line">
              {invoices.map((i) => (
                <li key={i.id} className="space-y-2 px-5 py-3 sm:px-6">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                    <a href={`/api/console/invoices/${i.id}`} target="_blank" rel="noreferrer" className="font-mono font-semibold text-link hover:underline">{i.number}</a>
                    <span className="tabular-nums text-slate-900">{money(i.total, i.currency)}</span>
                    <span className={cn("text-[12px] font-semibold", INVOICE_TONE[i.state])}>{INVOICE_WORDS[i.state]}</span>
                    <span className="text-[11px] text-slate-500">
                      issued {fmtDate(i.issuedOn)} · due {fmtDate(i.dueOn)}{i.periodFrom ? ` · for ${fmtDate(i.periodFrom)} → ${fmtDate(i.periodTo)}` : ""}
                      {i.paidOn ? ` · paid ${fmtDate(i.paidOn)} by ${PAID_BY[i.paidBy ?? ""] ?? i.paidBy}${i.paymentReference ? `, ${i.paymentReference}` : ""}` : ""}
                      {i.voidReason ? ` · ${i.voidReason}` : ""}
                    </span>
                  </p>
                  {i.state === "ISSUED" ? (
                    <div className="flex flex-wrap items-end gap-3">
                      <ActionForm action={invoicePaidAction} hidden={{ invoiceId: i.id }} submitLabel="Record the payment" size="sm" className="asking flex flex-wrap items-end gap-2 space-y-0">
                        <input type="date" name="paidOn" defaultValue={today} className="plain w-36" aria-label="Paid on" />
                        <Select name="paidBy" defaultValue="TRANSFER" className="plain w-40" aria-label="How">
                          {Object.entries(PAID_BY).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                        </Select>
                        <input name="reference" placeholder="bank reference" className="plain w-40" aria-label="Reference" />
                      </ActionForm>
                      <details>
                        <summary className="cursor-pointer text-[12px] font-semibold text-slate-500 hover:text-red-700">Void…</summary>
                        <ActionForm action={voidInvoiceAction} hidden={{ invoiceId: i.id }} submitLabel="Void it" size="sm" variant="danger" className="asking mt-2 flex items-end gap-2 space-y-0">
                          <input name="why" required placeholder="why: a mistake, issued twice…" className="plain w-64" aria-label="Why" />
                        </ActionForm>
                      </details>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <Nothing>No invoice yet.</Nothing>}
        </div>
        <ActionForm action={issueInvoiceAction} hidden={{ tenantId }} submitLabel="Issue the invoice" resetOnSuccess
          confirmText="It gets the next number and cannot be deleted, only voided. Its administrators are told."
          className="asking space-y-3 border-t border-line px-5 py-4 sm:px-6 lg:border-t-0">
          <p className="stencil text-slate-500">New invoice</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Issued on"><input type="date" name="issuedOn" defaultValue={today} className="plain w-full" /></Field>
            <Field label="Period from"><input type="date" name="periodFrom" defaultValue={today} className="plain w-full" /></Field>
            <Field label="Period to"><input type="date" name="periodTo" defaultValue={inMonth} className="plain w-full" /></Field>
          </div>
          {[0, 1, 2].map((n) => (
            <div key={n} className="grid grid-cols-[minmax(0,1fr)_4rem_6rem] gap-2">
              <input name={`line${n}`} aria-label="What" placeholder={n === 0 ? "What is invoiced" : "another line (optional)"} className="plain w-full"
                defaultValue={n === 0 && plan ? `${plan.name} plan, per user, one month` : ""} />
              <input name={`qty${n}`} aria-label="Quantity" type="number" min={0} step="0.01" className="plain w-full" defaultValue={n === 0 ? users : ""} placeholder="qty" />
              <input name={`price${n}`} aria-label="Unit price" type="number" min={0} step="0.01" className="plain w-full" defaultValue={n === 0 ? plan?.pricePerUser ?? "" : ""} placeholder="price" />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Currency"><input name="currency" defaultValue={plan?.currency ?? "MAD"} maxLength={3} className="plain w-full uppercase" /></Field>
            <Field label="Tax %" hint="empty: the default in Plans & payments"><input name="taxRate" type="number" min={0} max={100} step="0.01" className="plain w-full" /></Field>
          </div>
          <Field label="Note" hint="on the invoice"><textarea name="note" rows={2} className={inputCls} /></Field>
        </ActionForm>
      </div>
    </Sheet>
  );
}
