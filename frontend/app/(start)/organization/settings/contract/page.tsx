import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ActionForm } from "@/components/form";
import { Banner, Field } from "@/components/ui";
import { Select } from "@/components/select";
import { api } from "@/lib/client";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { acceptTextAction, cancelPlanAction, choosePlanAction, endSupportAction, grantSupportAction, resumePlanAction, setBillingDetailsAction } from "@/lib/organization/forms-contract";
import { Field as F2, inputCls } from "@/components/ui";
import { cn, fmtDate, fmtDateTime } from "@/lib/core/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contract & plan" };

type Contract = {
  state: string; why: string; readsOnly: boolean; plan: { code: string; name: string; pricePerUser: number | null; currency: string } | null;
  trialEndsAt: string | null; paidUntil: string | null; billing: string | null; seats: number | null; contractRef: string | null;
  contractSignedOn: string | null; cancelledAt: string | null; cancelledBy: string | null; renewsOn: string | null; users: number;
  texts: { kind: string; slug: string; title: string; version: number; acceptedVersion: number | null; toAccept: boolean }[];
  acceptances: { kind: string; version: number; userName: string; userEmail: string; at: string }[];
  support: { id: string; grantedByName: string; why: string; from: string; until: string; endedAt: string | null; endedByName: string | null; active: boolean }[];
  plans: { code: string; name: string; pricePerUser: number | null; currency: string; notes: string | null }[];
  asked: { plan: string; users: number | null; note: string | null; at: string; by: string | null } | null;
};

type Billing = {
  details: { legalName: string; address: string | null; country: string | null; taxNumber: string | null; email: string | null; reference: string | null } | null;
  invoices: { id: string; number: string; issuedOn: string; dueOn: string; periodFrom: string | null; periodTo: string | null; currency: string; total: number;
    state: string; paidOn: string | null; voidReason: string | null }[];
  payTo: { name: string | null; bank: string | null };
};
type Contact = { email: string | null; hours: string | null; phone: string | null };
const INVOICE_WORDS: Record<string, string> = { ISSUED: "To pay", PAID: "Paid", VOID: "Voided" };
const money = (v: number, c: string) => `${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

const STATE_WORDS: Record<string, string> = { TRIAL: "Trying DELIOS", ACTIVE: "Active", READ_ONLY: "Reads only", ENDED: "Ended" };
const KIND_WORDS: Record<string, string> = { TERMS: "Terms of service", DPA: "Data processing agreement" };

const band = (title: string, said?: string) => (
  <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
    <span className="stencil mr-1 text-slate-500">{title}</span>
    {said ? <span className="text-[11px] text-slate-500">{said}</span> : null}
  </div>
);

/**
 * What the organization has with DELIOS (its administrators): where it stands, its plan, the texts it accepted and
 * those to accept, cancelling in one click, and letting DELIOS's team in to help for a set time (owner: "we never read
 * an organization's documents by default").
 */
export default async function ContractPage() {
  await requireOrgAdmin();
  const [c, billing, contact] = await Promise.all([
    api<Contract>("/api/organization/contract"), api<Billing>("/api/organization/billing"),
    api<Contact>("/api/legal/support-contact").catch(() => ({ email: null, hours: null, phone: null })),
  ]);
  const toPay = billing.invoices.filter((i) => i.state === "ISSUED");
  const open = c.support.find((g) => g.active);
  return (
    <div className="space-y-4">
      <header className="register register-sheet register-sheet-open">
        <div className="px-5 pt-5 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">Contract &amp; plan</h1>
          <p className="plate-meta mt-1.5 max-w-2xl font-normal">What the organization has with DELIOS. Your data stays yours: you may export it at any time.</p>
        </div>
        <dl className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
          {[
            { term: "Where it stands", value: STATE_WORDS[c.state] ?? c.state, said: c.why, tone: c.readsOnly ? "text-amber-700" : "" },
            { term: "Plan", value: c.plan?.name ?? "None yet", said: c.plan?.pricePerUser != null ? `${c.plan.pricePerUser} ${c.plan.currency} per user a month` : c.plan ? "price in the contract" : "choose one below" },
            { term: "Paid users", value: c.users, said: `people of ours who work in it${c.seats ? ` · ${c.seats} in the contract` : ""}; guests are free` },
            { term: c.state === "TRIAL" ? "Trial ends" : "Paid until", value: c.state === "TRIAL" && !c.trialEndsAt ? "No end" : fmtDate(c.state === "TRIAL" ? c.trialEndsAt : c.paidUntil), said: c.renewsOn ? "renews then" : c.cancelledAt ? `cancelled by ${c.cancelledBy}` : "" },
          ].map((f) => (
            <div key={f.term} className="bg-surface px-5 py-3 sm:px-6">
              <dt className="stencil text-slate-500">{f.term}</dt>
              <dd className={cn("mt-1 text-[13px] font-medium text-slate-900", f.tone)}>{f.value}</dd>
              {f.said ? <dd className="text-[11px] text-slate-500">{f.said}</dd> : null}
            </div>
          ))}
        </dl>
      </header>

      {c.readsOnly ? (
        <Banner tone="warn" title="The organization reads only">
          {c.why} Everyone keeps reading and exporting; nobody adds or changes until it is put right; nothing is deleted. {c.state === "READ_ONLY" && !c.plan ? "Choose a plan below to work again." : "Pay the invoice below, or write to DELIOS to settle it."}
        </Banner>
      ) : null}

      {(c.state === "TRIAL" || c.readsOnly || !c.plan) && c.plans.length ? (
        <section id="choose" className="register register-sheet register-sheet-open">
          {band("Choose a plan", c.asked ? "sent to DELIOS" : c.state === "TRIAL" ? "to keep working after the trial" : "to work again")}
          {c.asked ? (
            <p className="border-b border-line px-5 py-3 text-[13px] text-slate-700 sm:px-6">
              <strong className="text-slate-900">{c.asked.by} chose {c.plans.find((p) => p.code === c.asked!.plan)?.name ?? c.asked.plan} for {c.asked.users} user{c.asked.users === 1 ? "" : "s"}</strong> on {fmtDate(c.asked.at)}.
              {" "}DELIOS sets it up and sends your first invoice; you are told, and it appears below under Invoices. You may change your choice until then.
            </p>
          ) : (
            <p className="border-b border-line px-5 py-3 text-[12px] leading-5 text-slate-600 sm:px-6">
              Pick a plan and how many of your people will use DELIOS. DELIOS then sends you an invoice, which you pay by bank transfer. People of other
              organizations working with you are free.
            </p>
          )}
          <ActionForm action={choosePlanAction} submitLabel={c.asked ? "Change my choice" : "Send my choice to DELIOS"}
            className="asking grid grid-cols-1 items-end gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_10rem] sm:px-6" footerClassName="sm:col-span-2">
            <Field label="Plan" required>
              <Select name="plan" required defaultValue={c.asked?.plan ?? c.plans[0]?.code} className="plain w-full">
                {c.plans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name} · {p.pricePerUser == null ? "price on request" : `${p.pricePerUser} ${p.currency} per user a month`}{p.notes ? ` · ${p.notes}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Users" required hint={`${c.users} today`}><input name="users" type="number" min={1} required defaultValue={c.asked?.users ?? Math.max(c.users, 1)} className="plain w-full" /></Field>
            <Field label="Anything to add" hint="optional: yearly payment, a question…" className="sm:col-span-2"><input name="note" defaultValue={c.asked?.note ?? ""} className="plain w-full" /></Field>
          </ActionForm>
        </section>
      ) : null}

      <section className="register register-sheet register-sheet-open">
        {band("Invoices", toPay.length ? `${toPay.length} to pay: ${toPay.map((i) => money(i.total, i.currency)).join(", ")}` : "nothing to pay")}
        {billing.invoices.length ? (
          <ul className="divide-y divide-line">
            {billing.invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[13px] sm:px-6">
                <a href={`/api/organization/invoices/${i.id}`} target="_blank" rel="noreferrer" className="font-mono font-semibold text-link hover:underline">{i.number}</a>
                <span className="tabular-nums text-slate-900">{money(i.total, i.currency)}</span>
                <span className={cn("text-[12px] font-semibold", i.state === "ISSUED" ? "text-amber-700" : i.state === "PAID" ? "text-emerald-700" : "text-slate-500")}>{INVOICE_WORDS[i.state] ?? i.state}</span>
                <span className="text-[11px] text-slate-500">
                  issued {fmtDate(i.issuedOn)} · due {fmtDate(i.dueOn)}{i.periodFrom ? ` · for ${fmtDate(i.periodFrom)} → ${fmtDate(i.periodTo)}` : ""}{i.paidOn ? ` · paid ${fmtDate(i.paidOn)}` : ""}{i.voidReason ? ` · ${i.voidReason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="px-5 py-3 text-[13px] text-slate-500 sm:px-6">No invoice yet.</p>}
        {toPay.length && billing.payTo.bank ? (
          <div className="border-t border-line px-5 py-3 text-[12px] text-slate-700 sm:px-6">
            <p className="stencil mb-1 text-slate-500">How to pay</p>
            <p className="whitespace-pre-line">By bank transfer to {billing.payTo.name ?? "DELIOS"}, quoting the invoice number:{"\n"}{billing.payTo.bank}</p>
            <p className="mt-1 text-[11px] text-slate-500">Once it arrives, DELIOS records it and the period it pays for is paid.</p>
          </div>
        ) : null}
      </section>

      <section className="register register-sheet register-sheet-open">
        {band("Who invoices are made out to", "your legal name, address and tax number, as invoices carry them")}
        <ActionForm action={setBillingDetailsAction} submitLabel="Save" className="asking grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-3 sm:px-6" footerClassName="sm:col-span-3">
          <F2 label="Legal name" required><input name="legalName" required defaultValue={billing.details?.legalName ?? ""} className="plain w-full" /></F2>
          <F2 label="Tax number" hint="VAT, ICE…"><input name="taxNumber" defaultValue={billing.details?.taxNumber ?? ""} className="plain w-full" /></F2>
          <F2 label="Country"><input name="country" defaultValue={billing.details?.country ?? ""} className="plain w-full" /></F2>
          <F2 label="Address" className="sm:col-span-2"><textarea name="address" rows={2} defaultValue={billing.details?.address ?? ""} className={inputCls} /></F2>
          <F2 label="Send invoices to" hint="empty: the administrators"><input name="email" type="email" defaultValue={billing.details?.email ?? ""} className="plain w-full" /></F2>
          <F2 label="Your reference" hint="a purchase order, printed on invoices"><input name="reference" defaultValue={billing.details?.reference ?? ""} className="plain w-full" /></F2>
        </ActionForm>
      </section>

      <section className="register register-sheet register-sheet-open">
        {band("What we accepted", "for the organization, by one of its administrators; a new version is accepted again")}
        <ul className="divide-y divide-line">
          {c.texts.map((t) => (
            <li key={t.kind} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:px-6">
              <div className="min-w-0 flex-1 text-[13px]">
                <Link href={`/legal/${t.slug}`} target="_blank" className="inline-flex items-center gap-1 font-semibold text-slate-900 hover:text-link hover:underline">{t.title} <ExternalLink className="h-3 w-3" /></Link>
                <span className="block text-[12px] text-slate-600">
                  {t.acceptedVersion == null ? "Not accepted yet." : `Version ${t.acceptedVersion} accepted.`} {t.toAccept ? `Version ${t.version} is the current one.` : ""}
                </span>
              </div>
              {t.toAccept ? (
                <ActionForm action={acceptTextAction} hidden={{ kind: t.kind }} submitLabel={`Accept version ${t.version}`} size="sm"
                  confirmText={`You accept the ${t.title.toLowerCase()} for the whole organization.`} />
              ) : <span className="text-[12px] font-semibold text-emerald-700">accepted</span>}
            </li>
          ))}
        </ul>
        {c.acceptances.length ? (
          <details className="border-t border-line">
            <summary className="cursor-pointer px-5 py-2.5 text-[12px] font-semibold text-slate-600 sm:px-6">Every acceptance ({c.acceptances.length})</summary>
            <ul className="divide-y divide-line">
              {c.acceptances.map((a, i) => <li key={i} className="px-5 py-2 text-[12px] text-slate-600 sm:px-6">{KIND_WORDS[a.kind] ?? a.kind}, version {a.version} · {a.userName} · {fmtDateTime(a.at)}</li>)}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="register register-sheet register-sheet-open">
        {band("Let DELIOS in to help", "DELIOS never reads your projects and people unless you let it in, for a set time")}
        <div className="border-b border-line px-5 py-3 text-[12px] leading-5 text-slate-600 sm:px-6">
          <p>
            <strong className="text-slate-800">How it works:</strong> write to DELIOS support{contact.email ? <> at <a href={`mailto:${contact.email}`} className="font-semibold text-link hover:underline">{contact.email}</a></> : null}
            {contact.phone ? <> or call {contact.phone}</> : null}{contact.hours ? <> ({contact.hours})</> : null}. If they need to see it for themselves, let them in
            below for as long as needed. They then enter as an administrator named &ldquo;DELIOS support: &lt;their name&gt;&rdquo;: you are told when they do,
            everything they do is in your audit trail under that name, and their access stops at the end of the time you chose, or as soon as you end it.
          </p>
        </div>
        {open ? (
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
            <p className="flex-1 text-[13px] text-slate-700">
              DELIOS is let in until <strong>{fmtDateTime(open.until)}</strong>, by {open.grantedByName}: {open.why}. What its team reads is written in your audit trail.
            </p>
            <ActionForm action={endSupportAction} hidden={{ grantId: open.id }} submitLabel="End it now" variant="danger" size="sm" />
          </div>
        ) : (
          <ActionForm action={grantSupportAction} submitLabel="Let DELIOS in" className="asking grid grid-cols-1 items-end gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:px-6"
            footerClassName="sm:col-span-2">
            <Field label="For" required>
              <Select name="days" defaultValue="3" className="plain w-full">
                {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} day{d === 1 ? "" : "s"}</option>)}
              </Select>
            </Field>
            <Field label="Why" required hint="what you need help with"><input name="why" required className="plain w-full" /></Field>
          </ActionForm>
        )}
        {c.support.filter((g) => !g.active).length ? (
          <ul className="divide-y divide-line border-t border-line">
            {c.support.filter((g) => !g.active).map((g) => (
              <li key={g.id} className="px-5 py-2 text-[12px] text-slate-600 sm:px-6">{g.grantedByName} · {fmtDate(g.from)} → {fmtDate(g.until)}{g.endedAt ? ` · ended early by ${g.endedByName}` : ""} · {g.why}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {c.state === "ACTIVE" ? (
        <section className="register register-sheet register-sheet-open">
          {band(c.cancelledAt ? "Cancelled" : "Cancel", "one click; it ends with the period paid, and nothing is deleted")}
          {c.cancelledAt ? (
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
              <p className="flex-1 text-[13px] text-slate-700">Cancelled by {c.cancelledBy} on {fmtDate(c.cancelledAt)}. It reads only after {fmtDate(c.paidUntil)}.</p>
              <ActionForm action={resumePlanAction} submitLabel="Keep it after all" size="sm" variant="secondary" />
            </div>
          ) : (
            <ActionForm action={cancelPlanAction} submitLabel="Cancel the plan" variant="danger"
              confirmText="Nothing renews. Everyone works as usual until the end of the period paid; then it reads only." className="asking space-y-3 px-5 py-4 sm:px-6">
              <Field label="Why" hint="optional, it helps us"><input name="why" className="plain w-full" /></Field>
            </ActionForm>
          )}
        </section>
      ) : null}
    </div>
  );
}
