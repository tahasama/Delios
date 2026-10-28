import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { SwitchField } from "@/components/switch";
import { consoleApi } from "@/lib/console/client";
import { savePlanAction } from "@/lib/console/forms";
import type { OrgRow, Plan } from "@/lib/console/types";
import { LawyerMark, Nothing, Plate, Sheet } from "../parts";

export const metadata = { title: "Plans & payments" };

/**
 * What DELIOS sells and how it is paid (docs/RUNNING-DELIOS.md §3): per organization, per user working in it, monthly
 * or yearly; guests free; by card through a seller of record (not connected yet) or on invoice; not paid reads only,
 * never deleted.
 */
export default async function Payments() {
  const [plans, orgs] = await Promise.all([consoleApi<Plan[]>("/api/console/plans"), consoleApi<OrgRow[]>("/api/console/organizations")]);
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
          { term: "Reading only", value: orgs.filter((o) => o.readsOnly).length, said: "not paid, trial ended or ended" },
        ]}
      />

      <Sheet title="How it is paid" said="what is built, and what waits">
        <ul className="divide-y divide-line text-[13px] text-slate-700">
          <li className="px-5 py-3 sm:px-6">
            <span className="font-medium text-slate-900">By card, through a seller of record</span> (Paddle, or Stripe acting as seller): it is the seller in law,
            collects and files VAT in each country and issues the invoices. <span className="font-semibold text-amber-700">Not connected yet.</span>{" "}
            Until it is, a payment is recorded by hand on the organization (Paid until).{" "}
            <LawyerMark>Choose the seller and sign its contract</LawyerMark>
          </li>
          <li className="px-5 py-3 sm:px-6">
            <span className="font-medium text-slate-900">On invoice</span>, for large clients paying yearly by transfer: the contract and the day it was signed are kept
            on the organization; the invoice comes from our accounts. <LawyerMark>VAT and e-invoicing where required</LawyerMark>
          </li>
          <li className="px-5 py-3 sm:px-6">
            <span className="font-medium text-slate-900">Not paid</span>: {14} days after the period paid the organization reads only. Everyone reads and exports;
            nobody adds or changes; nothing is deleted. Its administrators see why, and put it right in their Contract &amp; plan.
          </li>
          <li className="px-5 py-3 sm:px-6">
            <span className="font-medium text-slate-900">Cancelling</span> is one click in the organization&rsquo;s Contract &amp; plan, no harder than signing up; it ends
            with the period paid. A yearly renewal is announced 30 days before (the Overview counts them).
          </li>
        </ul>
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
          <ActionForm action={savePlanAction} submitLabel="Save the plan" resetOnSuccess className="asking space-y-4 px-5 py-4 sm:px-6">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Field label="Code" required hint="kept once used"><input name="code" required className="plain w-full uppercase" placeholder="TEAM" /></Field>
              <Field label="Name" required><input name="name" required className="plain w-full" placeholder="Team" /></Field>
              <Field label="Per user a month" hint="empty: on request"><input name="pricePerUser" type="number" min={0} step="0.01" className="plain w-full" /></Field>
              <Field label="Currency"><input name="currency" defaultValue="EUR" maxLength={3} className="plain w-full uppercase" /></Field>
              <Field label="Notes" className="col-span-2"><textarea name="notes" rows={2} className={inputCls} /></Field>
            </div>
            <SwitchField name="active" defaultChecked>Sold now</SwitchField>
          </ActionForm>
        </Sheet>
      </div>
    </>
  );
}
