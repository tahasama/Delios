import { ActionForm } from "@/components/form";
import { Card, Field, inputCls } from "@/components/ui";
import { fmtDate } from "@/lib/core/utils";
import { COUNTRIES, IDENTIFIER_KINDS, countryName } from "@/lib/organization/countries";
import type { Claims, MergeView, OwnIdentity } from "@/lib/organization/api";
import { saveOwnIdentityAction, sendDomainLinkAction, claimAction, answerMergeAction } from "@/lib/organization/forms";

/**
 * Who we are on DELIOS: our code and name (one of each everywhere), our identifier with its country (changed once at
 * most) or why we have none, and the email domain we proved by a link to an address there. Proven, we claim the
 * entries others made for us before we came onto DELIOS. And the merges asked of us, agreed or refused with why.
 */
export function WhoWeAre({ own, claimable, mergeList }: { own: OwnIdentity | null; claimable: Claims; mergeList: MergeView[] }) {
  if (!own) return null;
  const waiting = mergeList.filter((m) => m.waitsOnUs);
  const kind = IDENTIFIER_KINDS.find((k) => k.value === own.kind)?.label.toLowerCase();
  return (
    <Card title="Who we are on DELIOS">
      <div className="space-y-4">
        <p className="text-xs leading-5 text-slate-600">
          <span className="font-mono font-semibold">{own.code}</span> — {own.name}: our code and name everywhere on DELIOS. Our identifier
          keeps us one organization whoever adds us; our domain, once proven, lets us claim what others made for us before we came.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-700">Our identifier</p>
            {own.number ? (
              <p className="text-xs text-slate-600">
                {countryName(own.country)} · {kind} <span className="font-mono">{own.number}</span>
                <span className="block text-[11px] text-slate-500">
                  {own.identifierWas ? `fixed: changed once, from ${own.identifierWas.was}, by ${own.identifierWas.by}, ${fmtDate(own.identifierWas.at)}` : "may be changed once, for a mistake"}
                </span>
              </p>
            ) : own.noIdentifierReason ? <p className="text-xs text-slate-600">None: {own.noIdentifierReason}</p> : <p className="text-xs text-amber-800">Not given yet.</p>}
            {own.identifierWas ? null : (
              <ActionForm action={saveOwnIdentityAction} submitLabel={own.number ? "Correct it" : "Save"} size="sm" variant="secondary">
                <div className="grid gap-2 sm:grid-cols-3">
                  <Field label="Country">
                    <select name="country" defaultValue={own.country ?? ""} className={inputCls}>
                      <option value="">Choose…</option>
                      {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Kind">
                    <select name="identifierKind" defaultValue={own.kind ?? "COMPANY"} className={inputCls}>
                      {IDENTIFIER_KINDS.map((k) => <option key={k.value} value={k.value} title={k.hint}>{k.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Number"><input name="identifierNumber" defaultValue={own.number ?? ""} className={`${inputCls} font-mono`} /></Field>
                </div>
                {own.number ? null : (
                  <details className="text-xs">
                    <summary className="cursor-pointer font-semibold text-slate-500">We have none of these</summary>
                    <label className="mt-2 flex items-center gap-1.5"><input type="checkbox" name="none" /> None — say why</label>
                    <input name="noIdentifierReason" defaultValue={own.noIdentifierReason ?? ""} className={`${inputCls} mt-2`} />
                  </details>
                )}
              </ActionForm>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-700">Our email domain</p>
            {own.domainConfirmedAt
              ? <p className="text-xs text-slate-600">{own.domain} <span className="text-[11px] text-emerald-700">proven {fmtDate(own.domainConfirmedAt)}</span></p>
              : <p className="text-xs text-slate-600">{own.domain ? `${own.domain}, not proven yet.` : "Not proven yet."} A link goes to an address of ours there; opening it proves it.</p>}
            {own.domainConfirmedAt ? null : (
              <ActionForm action={sendDomainLinkAction} submitLabel="Send the link" size="sm" variant="secondary">
                <Field label="An address of ours at our domain" hint="e.g. documents@our-company.com; not a public mail provider">
                  <input type="email" name="email" required className={inputCls} />
                </Field>
              </ActionForm>
            )}
          </div>
        </div>

        {claimable.entries.length ? (
          <div className="space-y-2 border-t border-line pt-3">
            <p className="text-xs font-semibold text-slate-700">Made for us by others, at {claimable.domain}</p>
            <ul className="divide-y divide-line">
              {claimable.entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                  <span className="font-mono font-semibold">{e.code}</span> {e.name}
                  <span className="text-slate-500">{[e.identifier, `in ${e.lists} organization${e.lists === 1 ? "" : "s"}' list${e.lists === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span>
                  <ActionForm action={claimAction} submitLabel="It is us: claim it" size="sm" variant="secondary" hidden={{ identityId: e.id }}
                    className="ml-auto space-y-0" confirmText={`${e.name} becomes us, under our code and name, in every list that holds it. Go ahead?`} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {mergeList.length ? (
          <div className="space-y-2 border-t border-line pt-3">
            <p className="text-xs font-semibold text-slate-700">Merges{waiting.length ? ` · ${waiting.length} waiting for our answer` : ""}</p>
            <ul className="divide-y divide-line">
              {mergeList.map((m) => (
                <li key={m.id} className="space-y-2 py-2 text-xs">
                  <p className="text-slate-700">
                    <span className="font-mono font-semibold">{m.merge.code}</span> {m.merge.name} → <span className="font-mono font-semibold">{m.keep.code}</span> {m.keep.name}
                    <span className="ml-2 text-slate-500">
                      {m.state === "ASKED" ? (m.waitsOnUs ? "waits for our answer" : "waits for the other side") : m.state === "AGREED" ? "agreed: the app's owner merges them"
                        : m.state === "DONE" ? `merged ${m.doneAt ? fmtDate(m.doneAt) : ""}` : `refused by ${m.refusedByName}: ${m.refusedWhy}`}
                    </span>
                    <span className="block text-[11px] text-slate-500">Asked by {m.requestedByName}, {fmtDate(m.requestedAt)}: {m.why}</span>
                  </p>
                  {m.waitsOnUs ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <ActionForm action={answerMergeAction} submitLabel="Agree: they are one" size="sm" hidden={{ mergeId: m.id, answer: "agree" }} />
                      <ActionForm action={answerMergeAction} submitLabel="Refuse" size="sm" variant="secondary" hidden={{ mergeId: m.id, answer: "refuse" }}>
                        <Field label="Why they are not one" required><input name="note" required className={inputCls} /></Field>
                      </ActionForm>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
