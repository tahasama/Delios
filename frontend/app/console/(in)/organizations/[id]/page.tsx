import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ActionForm } from "@/components/form";
import { Banner, Field, inputCls } from "@/components/ui";
import { Select } from "@/components/select";
import { consoleApi } from "@/lib/console/client";
import { enterAsSupportAction, setOrganizationActiveAction, setSubscriptionAction } from "@/lib/console/forms";
import { Billing } from "./billing";
import { HOSTED } from "@/lib/core/hosting";
import { bytes, STATE_TONE, STATE_WORDS, type BillingDetails, type InvoiceRow, type Acceptance, type Grant, type OperatorEvent, type OrgRow, type Plan, type ProductRequest, type Subscription } from "@/lib/console/types";
import { cn, fmtDate, fmtDateTime } from "@/lib/core/utils";
import { Nothing, Plate, Sheet } from "../../parts";

export const metadata = { title: "Organization" };

type Detail = {
  organization: OrgRow; subscription: Subscription | null; admins: { name: string; email: string }[];
  projects: { code: string; name: string; status: string; members: number }[] | null;
  people: { name: string; email: string; isAdmin: boolean; active: boolean; guest: boolean; linked: boolean }[] | null;
  support: Grant[]; supportOpen: boolean; acceptances: Acceptance[]; requests: ProductRequest[]; log: OperatorEvent[];
};

const KIND_WORDS: Record<string, string> = { TERMS: "Terms of service", DPA: "Data processing agreement" };
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

/**
 * One organization, everything it has with us (owner: "the orgs, their contracts, the requests, all of that"): where
 * it stands, its plan and contract (changed here, always with why), who answers for it, what it accepted, what it asked,
 * the support it let us in for, and our log about it. Its projects and people are named only while it lets us in.
 */
export default async function Organization({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [d, plans, billing] = await Promise.all([
    consoleApi<Detail>(`/api/console/organizations/${id}`), consoleApi<Plan[]>("/api/console/plans"),
    consoleApi<{ details: BillingDetails | null; invoices: InvoiceRow[] }>(`/api/console/organizations/${id}/billing`),
  ]);
  const o = d.organization;
  const s = d.subscription;
  return (
    <>
      <Link href="/console/organizations" className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-link"><ArrowLeft className="h-3.5 w-3.5" /> Every organization</Link>
      <Plate
        title={o.name}
        meta={<>Signs in as <code className="font-mono">{o.slug}</code> · on DELIOS since {fmtDate(o.createdAt)}{o.active ? "" : " · switched off: nobody of it signs in"}</>}
        figures={[
          { term: "With us", value: STATE_WORDS[o.state] ?? o.state, said: o.why, tone: STATE_TONE[o.state] },
          { term: "Paid users", value: o.users, said: `of ${o.people} accounts; guests and linked accounts are free${s?.seats ? ` · ${s.seats} in the contract` : ""}` },
          { term: "Projects", value: o.projects, said: `last active ${fmtDate(o.lastSeen)}` },
          { term: "Storage", value: bytes(o.storage), said: "every file, every revision" },
        ]}
      />

      {s?.planAsked ? (
        <Banner tone="warn" title={`${s.planAskedBy} chose a plan on ${fmtDate(s.planAskedAt)}`}>
          {plans.find((p) => p.code === s.planAsked)?.name ?? s.planAsked}, for {s.planAskedUsers} user{s.planAskedUsers === 1 ? "" : "s"}.
          {s.planAskedNote ? <> &ldquo;{s.planAskedNote}&rdquo;</> : null} Set it below (it is filled in already), save, then send the first invoice further down.
        </Banner>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Run by the organization itself (Hosting): no plan, payment or trial to set. */}
        {HOSTED ? <Sheet title="Plan & contract" said={s ? `changed ${fmtDateTime(s.updatedAt)} by ${s.updatedBy ?? "—"}` : "nothing set yet: it tries DELIOS with no end"}>
          <ActionForm action={setSubscriptionAction} hidden={{ tenantId: o.id }} submitLabel="Save" className="asking space-y-4 px-5 py-4 sm:px-6">
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Field label="Where it stands" required>
                <Select name="state" defaultValue={s?.planAsked ? "ACTIVE" : s?.state ?? "TRIAL"} className="plain w-full">
                  {Object.entries(STATE_WORDS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                </Select>
              </Field>
              <Field label="Plan">
                <Select name="plan" defaultValue={s?.plan ?? s?.planAsked ?? ""} className="plain w-full">
                  <option value="">None yet</option>
                  {plans.map((p) => <option key={p.code} value={p.code}>{p.name}{p.active ? "" : " (no longer sold)"}</option>)}
                </Select>
              </Field>
              <Field label="How it pays">
                <Select name="billing" defaultValue={s?.billing ?? ""} className="plain w-full">
                  <option value="">Not set</option>
                  <option value="CARD">By card (not connected yet)</option>
                  <option value="INVOICE">On invoice</option>
                </Select>
              </Field>
              <Field label="Trial ends" hint="its last day"><input type="date" name="trialEndsAt" defaultValue={day(s?.trialEndsAt)} className="plain w-full" /></Field>
              <Field label="Paid until" hint={`reads only ${14} days after`}><input type="date" name="paidUntil" defaultValue={day(s?.paidUntil)} className="plain w-full" /></Field>
              <Field label="Users in the contract" hint="when it says a number"><input type="number" min={0} name="seats" defaultValue={s?.seats ?? s?.planAskedUsers ?? ""} className="plain w-full" /></Field>
              <Field label="Contract reference"><input name="contractRef" defaultValue={s?.contractRef ?? ""} className="plain w-full" /></Field>
              <Field label="Signed on"><input type="date" name="contractSignedOn" defaultValue={s?.contractSignedOn ?? ""} className="plain w-full" /></Field>
              <Field label="Card payment reference" hint="once card payment is connected"><input name="providerRef" defaultValue={s?.providerRef ?? ""} className="plain w-full" /></Field>
              <Field label="First invoice" hint="months it covers; empty: none now (users × the plan's price, issued at once)">
                <input type="number" min={1} max={36} name="firstInvoiceMonths" placeholder="none" className="plain w-full" />
              </Field>
              <Field label="Notes" className="sm:col-span-3"><textarea name="notes" rows={2} defaultValue={s?.notes ?? ""} className={inputCls} /></Field>
              <Field label="Why it changes" required className="sm:col-span-3"><input name="why" required className="plain w-full" placeholder="Contract signed, paid by transfer, trial extended…" /></Field>
            </div>
            {s?.cancelledAt ? <p className="text-[12px] text-amber-700">Cancelled by {s.cancelledBy} on {fmtDate(s.cancelledAt)}: it ends with the period paid.</p> : null}
          </ActionForm>
        </Sheet> : null}

        <div className="space-y-4">
          <Sheet title="Who answers for it" said="its administrators">
            {d.admins.length ? (
              <ul className="divide-y divide-line">
                {d.admins.map((a) => <li key={a.email} className="px-5 py-2.5 text-[13px] sm:px-6"><span className="font-medium text-slate-900">{a.name}</span> <a href={`mailto:${a.email}`} className="text-link hover:underline">{a.email}</a></li>)}
              </ul>
            ) : <Nothing>No administrator.</Nothing>}
          </Sheet>
          <Sheet title="What it accepted" said="kept for good">
            {d.acceptances.length ? (
              <ul className="divide-y divide-line">
                {d.acceptances.map((a, i) => (
                  <li key={i} className="px-5 py-2.5 text-[12px] text-slate-700 sm:px-6">
                    <span className="font-medium text-slate-900">{KIND_WORDS[a.kind] ?? a.kind}</span>, version {a.version}{a.version === 0 ? " (the placeholder text)" : ""}
                    <span className="block text-[11px] text-slate-500">{a.userName} · {a.userEmail} · {fmtDateTime(a.at)}</span>
                  </li>
                ))}
              </ul>
            ) : <Nothing>Nothing accepted yet (registered before acceptance was asked).</Nothing>}
          </Sheet>
          <Sheet title={o.active ? "Switch it off" : "Switch it on"} said={o.active ? "nobody of it signs in; nothing is deleted" : "its people sign in again"}>
            <ActionForm action={setOrganizationActiveAction} hidden={{ tenantId: o.id, active: o.active ? "false" : "true" }}
              submitLabel={o.active ? "Switch it off" : "Switch it on"} variant={o.active ? "danger" : "primary"}
              confirmText={o.active ? `Nobody of ${o.name} will sign in until it is switched on again.` : undefined} className="asking space-y-3 px-5 py-4 sm:px-6">
              <Field label="Why" required><input name="why" required className="plain w-full" /></Field>
            </ActionForm>
          </Sheet>
        </div>
      </div>

      {HOSTED ? <Billing tenantId={o.id} details={billing.details} invoices={billing.invoices} plan={plans.find((p) => p.code === s?.plan) ?? null} users={o.users} /> : null}

      <Sheet title="Support access" said={d.supportOpen ? "it lets us in now: what we read below is written in its audit trail" : "we read its projects and people only once one of its administrators lets us in"}
        acts={d.supportOpen ? (
          <ActionForm action={enterAsSupportAction} hidden={{ tenantId: o.id }} submitLabel="Enter as its administrator" size="sm"
            confirmText={`You enter ${o.name} as "DELIOS support: you", an administrator. Its administrators are told now; everything you do is in its audit trail.`} />
        ) : undefined}>
        {d.support.length ? (
          <ul className="divide-y divide-line">
            {d.support.map((g) => (
              <li key={g.id} className="px-5 py-2.5 text-[13px] sm:px-6">
                <span className="font-medium text-slate-900">{g.grantedByName}</span> let us in {fmtDateTime(g.from)} → {fmtDateTime(g.until)}
                {g.endedAt ? <span className="text-slate-500"> · ended {fmtDateTime(g.endedAt)} by {g.endedByName}</span> : null}
                <span className="block text-[12px] text-slate-600">{g.why}</span>
              </li>
            ))}
          </ul>
        ) : <Nothing>It never let us in.</Nothing>}
      </Sheet>

      {d.projects && d.people ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Sheet title="Its projects" said="read under its support access">
            <ul className="divide-y divide-line">
              {d.projects.map((p) => <li key={p.code} className="px-5 py-2 text-[13px] sm:px-6"><code className="code-chip mr-1.5">{p.code}</code>{p.name} <span className="text-[11px] text-slate-500">· {p.status.toLowerCase().replace("_", " ")} · {p.members} people</span></li>)}
            </ul>
          </Sheet>
          <Sheet title="Its people" said="read under its support access">
            <ul className="divide-y divide-line">
              {d.people.map((p) => (
                <li key={p.email} className={cn("px-5 py-2 text-[13px] sm:px-6", !p.active && "opacity-60")}>
                  {p.name} <span className="text-[11px] text-slate-500">{p.email}{p.isAdmin ? " · administrator" : ""}{p.guest ? " · guest" : ""}{p.linked ? " · from its own DELIOS" : ""}</span>
                </li>
              ))}
            </ul>
          </Sheet>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Sheet title="What it asked of DELIOS">
          {d.requests.length ? (
            <ul className="divide-y divide-line">
              {d.requests.map((r) => <li key={r.id} className="px-5 py-2.5 text-[13px] sm:px-6">{r.what.replace("_", " ").toLowerCase()} · {r.byName} · {fmtDate(r.at)}<span className="block text-[12px] text-slate-600">{r.message ?? "No message."}</span></li>)}
            </ul>
          ) : <Nothing>Nothing asked.</Nothing>}
        </Sheet>
        <Sheet title="Our log about it">
          {d.log.length ? (
            <ul className="divide-y divide-line">
              {d.log.map((e) => <li key={e.id} className="px-5 py-2.5 text-[12px] text-slate-700 sm:px-6"><span className="font-medium text-slate-900">{e.action.replaceAll("_", " ").toLowerCase()}</span> · {e.operatorName} · {fmtDateTime(e.at)}<span className="block whitespace-pre-line text-slate-600">{e.detail}</span></li>)}
            </ul>
          ) : <Nothing>Nothing done about it yet.</Nothing>}
        </Sheet>
      </div>
    </>
  );
}
