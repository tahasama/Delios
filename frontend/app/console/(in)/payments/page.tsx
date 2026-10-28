import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { SwitchField } from "@/components/switch";
import { consoleApi } from "@/lib/console/client";
import { savePlanAction, setSellerAction, setTrialDaysAction } from "@/lib/console/forms";
import { INVOICE_TONE, INVOICE_WORDS, money, type InvoiceRow, type OrgRow, type Plan } from "@/lib/console/types";
import Link from "next/link";
import { cn, fmtDate } from "@/lib/core/utils";
import { LawyerMark, Nothing, Plate, Sheet } from "../parts";

export const metadata = { title: "Plans & payments" };

/**
 * What DELIOS sells and how it is paid (docs/RUNNING-DELIOS.md §3): per organization, per user working in it, monthly
 * or yearly; guests free; by card through a seller of record (not connected yet) or on invoice; not paid reads only,
 * never deleted.
 */
export default async function Payments() {
  const [plans, orgs, invoices, seller, trial] = await Promise.all([
    consoleApi<Plan[]>("/api/console/plans"), consoleApi<OrgRow[]>("/api/console/organizations"),
    consoleApi<InvoiceRow[]>("/api/console/invoices"), consoleApi<Record<string, string>>("/api/console/seller"),
    consoleApi<{ days: number }>("/api/console/trial-days"),
  ]);
  const waiting = invoices.filter((i) => i.state === "ISSUED");
  const late = waiting.filter((i) => i.dueOn < new Date().toISOString().slice(0, 10));
  const paying = orgs.filter((o) => o.state === "ACTIVE");
  const monthly = paying.reduce((sum, o) => sum + (plans.find((p) => p.code === o.plan)?.pricePerUser ?? 0) * o.users, 0);
  return (
    <>
      <Plate
        title="Plans & payments"
        meta="Per organization, per user who works in it. People of other organizations on a project pay nothing to the host."
        figures={[
          { term: "Plans", value: plans.length, said: `${plans.filter((p) => p.active).length} sold now` },
          { term: "Paying", value: paying.length, said: "organizations active" },
          { term: "A month, at list price", value: `${monthly.toLocaleString("en-GB", { maximumFractionDigits: 0 })} ${plans[0]?.currency ?? "EUR"}`, said: "paid users × their plan's price" },
          { term: "Waiting for payment", value: waiting.length, tone: late.length ? "text-red-700" : undefined, said: late.length ? `${late.length} past their due day` : "none late" },
        ]}
      />

      <Sheet title="Free trial" said={trial.days ? `${trial.days} days for every new organization` : "no end for new organizations"}>
        <ActionForm action={setTrialDaysAction} submitLabel="Save" className="asking grid grid-cols-1 items-end gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:px-6"
          footerClassName="sm:col-span-2">
          <Field label="Days" required hint="0: no end"><input name="days" type="number" min={0} max={365} required defaultValue={trial.days} className="plain w-full" /></Field>
          <Field label="Why it changes" required><input name="why" required className="plain w-full" placeholder="Launch offer, back to the usual length…" /></Field>
          <p className="text-[12px] leading-5 text-slate-600 sm:col-span-2">
            Every organization that signs up tries DELIOS for free for this many days. Its administrators get a reminder 7 days before the end, the day
            before, and on the day. After that it reads only until it chooses a plan. Organizations already trying keep their own end date: change it on
            their page.
          </p>
        </ActionForm>
      </Sheet>

      <Sheet title="How it is paid" said="the cheapest and most reliable first (owner)">
        <ul className="divide-y divide-line text-[13px] text-slate-700">
          <li className="px-5 py-3 sm:px-6">
            <span className="font-medium text-slate-900">Invoice and bank transfer</span>, the main way: an invoice is issued from the organization&rsquo;s page, its
            administrators are told and download it from their Contract &amp; plan with your bank details on it; when the transfer arrives, record the
            payment on the invoice and the period it pays for is paid by itself. No fee per payment.
          </li>
          <li className="px-5 py-3 sm:px-6">
            <span className="font-medium text-slate-900">CMI</span> (Moroccan cards, in dirhams) and <span className="font-medium text-slate-900">Paddle</span> (foreign
            cards): <span className="font-semibold text-amber-700">not connected</span>. A payment made through them is recorded on its invoice the same way. Connecting
            one needs its merchant contract and keys. <LawyerMark>Merchant contract to sign</LawyerMark>
          </li>
          <li className="px-5 py-3 sm:px-6">
            <span className="font-medium text-slate-900">Not paid</span>: {14} days after the period paid the organization reads only. Everyone reads and exports;
            nobody adds or changes; nothing is deleted. <span className="font-medium text-slate-900">Cancelling</span> is one click on its Contract &amp; plan.
          </li>
        </ul>
      </Sheet>

      <Sheet title="Every invoice" said={`${invoices.length}${waiting.length ? ` · ${waiting.length} waiting` : ""}`}>
        {invoices.length ? (
          <ul className="divide-y divide-line">
            {invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[13px] sm:px-6">
                <a href={`/api/console/invoices/${i.id}`} target="_blank" rel="noreferrer" className="font-mono font-semibold text-link hover:underline">{i.number}</a>
                <Link href={`/console/organizations/${i.tenantId}`} className="text-slate-900 hover:text-link hover:underline">{i.organization}</Link>
                <span className="tabular-nums">{money(i.total, i.currency)}</span>
                <span className={cn("text-[12px] font-semibold", INVOICE_TONE[i.state])}>{INVOICE_WORDS[i.state]}</span>
                <span className="text-[11px] text-slate-500">issued {fmtDate(i.issuedOn)} · due {fmtDate(i.dueOn)}{i.paidOn ? ` · paid ${fmtDate(i.paidOn)}` : ""}</span>
              </li>
            ))}
          </ul>
        ) : <Nothing>No invoice yet: issue one from an organization&rsquo;s page.</Nothing>}
      </Sheet>

      <Sheet title="On every invoice" said="DELIOS as the seller: who, its tax numbers, its bank">
        <ActionForm action={setSellerAction} submitLabel="Save" className="asking space-y-4 px-5 py-4 sm:px-6">
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            <Field label="Company name" required><input name="name" required defaultValue={seller.SELLER_NAME ?? ""} className="plain w-full" /></Field>
            <Field label="Tax %" hint="Morocco's VAT is 20"><input name="taxRate" type="number" min={0} max={100} step="0.01" defaultValue={seller.INVOICE_TAX_RATE ?? "20"} className="plain w-full" /></Field>
            <Field label="Address"><textarea name="address" rows={3} defaultValue={seller.SELLER_ADDRESS ?? ""} className={inputCls} /></Field>
            <Field label="Tax and registration numbers" hint="ICE, IF, RC, patente, VAT…"><textarea name="taxNumbers" rows={3} defaultValue={seller.SELLER_TAX_NUMBERS ?? ""} className={inputCls} /></Field>
            <Field label="Bank details" hint="bank, RIB, IBAN, SWIFT"><textarea name="bank" rows={3} defaultValue={seller.SELLER_BANK ?? ""} className={inputCls} /></Field>
            <Field label="Days to pay"><input name="dueDays" type="number" min={0} max={365} defaultValue={seller.INVOICE_DUE_DAYS ?? "30"} className="plain w-full" /></Field>
            <Field label="Mentions at the foot" hint="what the law asks an invoice to say" className="md:col-span-2"><textarea name="mentions" rows={2} defaultValue={seller.INVOICE_MENTIONS ?? ""} className={inputCls} /></Field>
          </div>
          <p className="text-[12px]"><LawyerMark>For an accountant</LawyerMark> <span className="text-slate-600">What a Moroccan invoice must carry (ICE, IF, RC, patente, the VAT rate on services sold abroad), and the mentions at its foot.</span></p>
        </ActionForm>
      </Sheet>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Sheet title="Plans" said="a plan's code stays once a contract carries it">
          {plans.length ? (
            <ul className="divide-y divide-line">
              {plans.map((p) => (
                <li key={p.code} className="px-5 py-3 text-[13px] sm:px-6">
                  <code className="code-chip mr-1.5">{p.code}</code><span className="font-medium text-slate-900">{p.name}</span>
                  {p.active ? null : <span className="ml-1.5 text-[11px] text-slate-500">no longer sold</span>}
                  <span className="block text-[12px] text-slate-600">
                    {p.pricePerUser == null ? "Price on request" : `${p.pricePerUser} ${p.currency} per user a month`} · {p.organizations} organization{p.organizations === 1 ? "" : "s"}
                    {p.notes ? ` · ${p.notes}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : <Nothing>No plan yet. Add the first one beside.</Nothing>}
        </Sheet>
        <Sheet title="Add or change a plan" said="by its code">
          <ActionForm action={savePlanAction} submitLabel="Save the plan" resetOnSuccess
            className="asking grid grid-cols-2 gap-x-4 gap-y-4 px-5 py-4 sm:px-6" footerClassName="col-span-2">
            <Field label="Code" required hint="kept once used"><input name="code" required className="plain w-full uppercase" /></Field>
            <Field label="Name" required><input name="name" required className="plain w-full" /></Field>
            <Field label="Price per user" hint="a month; empty: on request"><input name="pricePerUser" type="number" min={0} step="0.01" className="plain w-full" /></Field>
            <Field label="Currency"><input name="currency" defaultValue="EUR" maxLength={3} className="plain w-full uppercase" /></Field>
            <Field label="Notes" hint="shown to organizations beside the price" className="col-span-2"><textarea name="notes" rows={2} className={inputCls} /></Field>
            <div className="col-span-2"><SwitchField name="active" defaultChecked>Sold now: organizations can choose it</SwitchField></div>
          </ActionForm>
        </Sheet>
      </div>
    </>
  );
}
