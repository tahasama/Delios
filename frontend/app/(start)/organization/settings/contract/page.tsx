import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ActionForm } from "@/components/form";
import { Banner, Field } from "@/components/ui";
import { Select } from "@/components/select";
import { api } from "@/lib/client";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { acceptTextAction, cancelPlanAction, endSupportAction, grantSupportAction, resumePlanAction } from "@/lib/organization/forms-contract";
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
};

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
  const c = await api<Contract>("/api/organization/contract");
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
            { term: "Plan", value: c.plan?.name ?? "None yet", said: c.plan?.pricePerUser != null ? `${c.plan.pricePerUser} ${c.plan.currency} per user a month` : c.plan ? "price in the contract" : "DELIOS sets it with you" },
            { term: "Paid users", value: c.users, said: `people of ours who work in it${c.seats ? ` · ${c.seats} in the contract` : ""}; guests are free` },
            { term: c.state === "TRIAL" ? "Trial ends" : "Paid until", value: fmtDate(c.state === "TRIAL" ? c.trialEndsAt : c.paidUntil), said: c.renewsOn ? `renews then; told 30 days before` : c.cancelledAt ? `cancelled by ${c.cancelledBy}` : "" },
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
          {c.why} Everyone keeps reading and exporting; nobody adds or changes until it is put right; nothing is deleted. Write to DELIOS to settle it.
        </Banner>
      ) : null}

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
