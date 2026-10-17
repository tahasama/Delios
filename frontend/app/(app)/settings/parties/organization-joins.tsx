"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Building2, Plus, Search } from "lucide-react";
import { Field } from "@/components/ui";
import { MissingSummary } from "@/components/form";
import { collectInvalid, fieldsNamed, markMissing, type MissingField } from "@/app/(public)/form-validation";
import { savePartyAction, findOnDeliosAction } from "@/lib/settings/forms-parties";
import { COUNTRIES, IDENTIFIER_KINDS, countryName } from "@/lib/organization/countries";
import { PartyKindFields } from "./party-fields";
import { Added } from "@/components/policy-fields";
import type { OwnField } from "@/lib/settings/field-policy";

/** A field as on the new-document form: grey, no box, inside the sheet's `asking` body. */
const field = "plain w-full";

type Found = { id: string; code: string; name: string; country: string | null; listed: boolean };

/**
 * "An organization works with us": one sheet, the new-document form's way. **Add** one already on DELIOS: found by its
 * name or code, taken as it is (its code and name), and invited to link. **Create** one DELIOS does not know (guests,
 * or someone of ours records for them): its code, name, identifier with its country (company registration, else tax
 * number, else professional register, else a public body's), or why it has none, and its email domain. Before it is
 * created, organizations that look like it are named: "Is this the same as…?" — Yes adds that one; No creates it.
 */
export function OrganizationJoins({ projectCode, functions, own }: {
  projectCode: string; functions: { id: string; name: string }[];
  /** The fields the organization added to an organization (Forms & fields), asked when one is created. */
  own: OwnField[];
}) {
  const [chosen, setChosen] = useState<"add" | "create" | null>(null);
  const [state, act, pending] = useActionState(savePartyAction, undefined);
  const [missing, setMissing] = useState<MissingField[]>([]);
  const form = useRef<HTMLFormElement>(null);
  const identityRef = useRef<HTMLInputElement>(null);
  const identityName = useRef<HTMLInputElement>(null);
  const notTheSame = useRef<HTMLInputElement>(null);
  const [words, setWords] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [picked, setPicked] = useState<Found | null>(null);
  const [none, setNone] = useState(false);

  useEffect(() => {
    if (form.current && state?.fields?.length) markMissing(form.current, fieldsNamed(form.current, state.fields));
    // Done: the sheet closes on what was done, ready for the next one.
    if (state?.ok) { setChosen(null); setPicked(null); setWords(""); setNone(false); }
  }, [state]);

  // Organizations on DELIOS, found as the words are typed.
  useEffect(() => {
    if (chosen !== "add" || words.trim().length < 2) { setFound([]); return; }
    const timer = setTimeout(() => { findOnDeliosAction(words).then(setFound); }, 250);
    return () => clearTimeout(timer);
  }, [words, chosen]);

  const band = (title: string, said: string) => (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
      <span className="stencil mr-1 text-slate-500">{title}</span>
      <span className="text-[11px] text-slate-500">{said}</span>
    </div>
  );

  const close = () => { setChosen(null); setPicked(null); setWords(""); setNone(false); };
  /** Submits again: as that look-alike (Yes), or as a different company (No). */
  const resubmit = (identity: { id: string; name: string } | null) => {
    if (identityRef.current) identityRef.current.value = identity?.id ?? "";
    if (identityName.current) identityName.current.value = identity?.name ?? "";
    if (!identity && notTheSame.current) notTheSame.current.value = (state?.lookalikes ?? []).map((l) => l.id).join(",");
    form.current?.requestSubmit();
  };

  if (!chosen) {
    return (
      <section id="join" className="register register-sheet register-sheet-open scroll-mt-24" aria-label="An organization works with us">
        {band("An organization works with us", "one already on DELIOS is added as it is; one that is not is created")}
        <div className="space-y-3 px-5 py-4 sm:px-6">
          {state?.ok ? <p className="w-fit rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800 ring-1 ring-emerald-200">{state.ok}</p> : null}
          <div className="flex flex-wrap items-start gap-2">
            <button type="button" onClick={() => setChosen("add")} className="ask"><Search aria-hidden className="h-3.5 w-3.5" /> Add one on DELIOS</button>
            <button type="button" onClick={() => setChosen("create")} className="ask"><Plus aria-hidden className="h-3.5 w-3.5" /> Create one</button>
          </div>
          <p className="text-[11px] leading-4 text-slate-500">
            On DELIOS: its people work here with their own accounts, once their administrator accepts. Not on DELIOS: we make
            guest accounts for its people, or one of ours records for it. Someone asked onto {projectCode} from an organization on
            DELIOS brings their organization with them.
          </p>
        </div>
      </section>
    );
  }

  const lookalikes = state?.lookalikes ?? [];
  return (
    <section id="join" className="register register-sheet register-sheet-open scroll-mt-24" aria-label={chosen === "add" ? "Add one on DELIOS" : "Create one"}>
      {chosen === "add"
        ? band("Add one on DELIOS", "found by its name or code; it comes with its own code and name, and is invited to work with us")
        : band("Create one", "an organization not on DELIOS: its identifier keeps it one organization, whoever adds it")}
      <form
        ref={form}
        action={act}
        noValidate
        className="asking space-y-5 px-5 py-5 sm:px-6"
        onSubmit={(e) => {
          const invalid = collectInvalid(e.currentTarget);
          if (invalid.length) { e.preventDefault(); setMissing(invalid); return; }
          setMissing([]);
        }}
      >
        <input ref={identityRef} type="hidden" name="identityId" defaultValue={picked?.id ?? ""} key={picked?.id ?? "none"} />
        <input ref={identityName} type="hidden" name="identityName" defaultValue={picked?.name ?? ""} />
        <input ref={notTheSame} type="hidden" name="notTheSame" defaultValue="" />
        {chosen === "add" ? (
          <>
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <Field label="Which organization" required hint="type part of its name or code">
                <span className="relative block">
                  <Search aria-hidden className="absolute top-1/2 left-0.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input value={words} onChange={(e) => { setWords(e.target.value); setPicked(null); }} autoComplete="off"
                    placeholder="e.g. Acme" className={`${field} pl-5.5`} />
                </span>
              </Field>
              <Field label="Chosen">
                <p className="flex h-(--control-h) items-center text-[13px] text-slate-800">
                  {picked ? <><code className="code-chip mr-1.5">{picked.code}</code>{picked.name}{picked.country ? ` · ${countryName(picked.country)}` : ""}</> : <span className="text-slate-500">nobody yet</span>}
                </p>
              </Field>
            </div>
            {found.length ? (
              <ul className="divide-y divide-line rounded-md ring-1 ring-line">
                {found.map((one) => (
                  <li key={one.id}>
                    <button type="button" disabled={one.listed} onClick={() => setPicked(one)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-tint-soft disabled:cursor-not-allowed disabled:opacity-50 ${picked?.id === one.id ? "bg-tint-soft font-semibold" : ""}`}>
                      <Building2 aria-hidden className="h-3.5 w-3.5 text-slate-400" />
                      <code className="code-chip">{one.code}</code>
                      <span>{one.name}</span>
                      <span className="ml-auto text-[11px] text-slate-500">{one.listed ? "already in your list" : countryName(one.country) ?? ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : words.trim().length >= 2 ? (
              <p className="text-xs text-slate-500">No organization on DELIOS answers to that. If it is not on DELIOS, <button type="button" className="font-semibold text-link hover:underline" onClick={() => setChosen("create")}>create it</button>.</p>
            ) : null}
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <Field label="Name" required hint="as the company writes it"><input name="name" required autoComplete="off" className={field} /></Field>
              <Field label="Code" required hint="short, e.g. ACME; its code everywhere on DELIOS">
                <input name="code" required maxLength={20} autoComplete="off" className={`${field} font-mono uppercase`} />
              </Field>
              <Field label="Country" required={!none} hint="where its identifier was given">
                <select name="country" required={!none} defaultValue="" disabled={none} className={field}>
                  <option value="">Choose…</option>
                  {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Identifier" required={!none} hint="the best it has: company registration first">
                <select name="identifierKind" defaultValue="COMPANY" disabled={none} className={field}>
                  {IDENTIFIER_KINDS.map((k) => <option key={k.value} value={k.value} title={k.hint}>{k.label}</option>)}
                </select>
              </Field>
              <Field label="Number" required={!none} hint="as written on its papers">
                <input name="identifierNumber" required={!none} disabled={none} autoComplete="off" className={`${field} font-mono`} />
              </Field>
              <Field label="Email domain" hint="optional — e.g. acme.com; it helps find it again">
                <input name="domain" autoComplete="off" placeholder="acme.com" className={field} />
              </Field>
            </div>
            <label className="flex w-fit cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-700">
              <input type="checkbox" checked={none} onChange={(e) => setNone(e.target.checked)} />
              It has no identifier <span className="font-normal text-slate-500">— none of these; say why</span>
            </label>
            {none ? (
              <Field label="Why it has none" required>
                <textarea name="noIdentifierReason" required rows={2} className={field} placeholder="e.g. being registered; a consultant working alone, not on any register" />
              </Field>
            ) : null}
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <PartyKindFields kind="OFFLINE" contactId="" backupId="" liaisonFunction="" people={[]} functions={functions} />
              <Added fields={own} />
            </div>
          </>
        )}

        {/* What looks like it, named before it is created: one organization stays one. */}
        {lookalikes.length ? (
          <div role="alert" className="space-y-2 rounded-md bg-amber-50 px-3 py-2.5 ring-1 ring-amber-200">
            <p className="text-xs font-semibold text-amber-900">{state?.error}</p>
            <ul className="space-y-1.5">
              {lookalikes.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 text-xs text-amber-900">
                  <code className="code-chip">{l.code}</code>
                  <span className="font-medium">{l.name}</span>
                  <span className="text-amber-800">{[countryName(l.country), l.onDelios ? "on DELIOS" : null, l.why].filter(Boolean).join(" · ")}</span>
                  <button type="button" className="ask ml-auto" onClick={() => resubmit({ id: l.id, name: l.name })}>Yes, add that one</button>
                </li>
              ))}
            </ul>
            <button type="button" className="text-xs font-semibold text-amber-900 underline" onClick={() => resubmit(null)}>
              No, it&rsquo;s a different company: create it
            </button>
          </div>
        ) : state?.error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
        ) : null}
        <MissingSummary missing={missing} />
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
        <button type="button" onClick={close} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</button>
        <button type="button" disabled={pending || (chosen === "add" && !picked)} data-on="true" className="ask disabled:opacity-50"
          onClick={() => { if (notTheSame.current) notTheSame.current.value = ""; form.current?.requestSubmit(); }}>
          {pending ? "Working…" : chosen === "add" ? "Add and invite" : "Create"}
        </button>
      </div>
    </section>
  );
}
