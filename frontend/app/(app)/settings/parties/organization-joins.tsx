"use client";
import { Select } from "@/components/select";

import { useActionState, useEffect, useRef, useState } from "react";
import { Building2, Plus, Search } from "lucide-react";
import { Field } from "@/components/ui";
import { MissingSummary } from "@/components/form";
import { collectInvalid, fieldsNamed, markMissing, type MissingField } from "@/app/(public)/form-validation";
import { savePartyAction, findOnDeliosAction } from "@/lib/settings/forms-parties";
import { countryName } from "@/lib/organization/countries";
import type { PickItem } from "@/components/search-pick";
import { PartyKindFields } from "./party-fields";
import { IdentifierFields } from "./identifier-fields";
import { Added } from "@/components/policy-fields";
import type { OwnField } from "@/lib/settings/field-policy";

/** A field as on the new-document form: grey, no box, inside the sheet's `asking` body. */
const field = "plain w-full";

type Found = { id: string; code: string; name: string; country: string | null; listed: boolean; partyId: string | null; onDelios: boolean };

/**
 * Bringing an organization in: one field, always there, finds it by name or code (our list first, then any DELIOS
 * knows) and choosing it adds it (one with its own DELIOS is invited to link; one not on DELIOS asks how it works with
 * us). Beside it, "Create an organization" opens the form for one nobody has yet: name, code, identifier with its
 * country (or why none), email domain, how it works with us; look-alikes are named before it is created. On a project's
 * page what is added is put on the project; on the organization's list, the projects may be chosen.
 */
export function OrganizationJoins({ project, projects = [], roles = [], ours, control, own }: {
  /** On a project's page: the roles an organization plays with us (client, supplier…), asked when it is added. */
  roles?: { code: string; label: string }[];
  /** On a project's page: what is added is put on it. */
  project?: boolean;
  /** On the organization's list: the projects it may also be put on (optional). */
  projects?: { id: string; code: string; name: string }[];
  ours: PickItem[];
  control: string[];
  own: OwnField[];
}) {
  const [creating, setCreating] = useState(false);
  const [state, act, pending] = useActionState(savePartyAction, undefined);
  const [missing, setMissing] = useState<MissingField[]>([]);
  const form = useRef<HTMLFormElement>(null);
  const identityRef = useRef<HTMLInputElement>(null);
  const identityName = useRef<HTMLInputElement>(null);
  const notTheSame = useRef<HTMLInputElement>(null);
  const [words, setWords] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [picked, setPicked] = useState<Found | null>(null);

  useEffect(() => {
    if (form.current && state?.fields?.length) markMissing(form.current, fieldsNamed(form.current, state.fields));
    if (state?.ok) { setCreating(false); setPicked(null); setWords(""); }
  }, [state]);

  // Found as the words are typed.
  useEffect(() => {
    if (creating || words.trim().length < 2) { setFound(null); return; }
    const timer = setTimeout(() => { findOnDeliosAction(words).then(setFound); }, 250);
    return () => clearTimeout(timer);
  }, [words, creating]);

  /** Submits again: as that look-alike (Yes), or as a different company (No). */
  const resubmit = (identity: { id: string; name: string } | null) => {
    if (identityRef.current) identityRef.current.value = identity?.id ?? "";
    if (identityName.current) identityName.current.value = identity?.name ?? "";
    if (!identity && notTheSame.current) notTheSame.current.value = (state?.lookalikes ?? []).map((l) => l.id).join(",");
    form.current?.requestSubmit();
  };
  const choose = (one: Found) => {
    setPicked(one);
    setWords("");
    setFound(null);
    // In our list already, or with its own DELIOS: nothing more to ask, it is added at once.
    // Its role with us (and contract) is asked before it is added: nothing is added on a click alone.
  };
  const lookalikes = state?.lookalikes ?? [];
  const asksKind = !creating && picked && !picked.listed && !picked.onDelios;
  /** On a project's page: what it is to us here, asked with the add. */
  const toUs = project ? (
    <>
      <Field label="Role with us" required hint="what they are to us on this project">
        <Select name="role" required defaultValue="" className={field}>
          <option value="" disabled>Choose…</option>
          {roles.filter((r) => r.code !== "GENERIC").map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </Select>
      </Field>
      <Field label="Contract number" hint="optional — its contract with us; unique on DELIOS">
        <input name="contractNumber" maxLength={64} autoComplete="off" className={`${field} font-mono`} />
      </Field>
    </>
  ) : null;

  return (
    <section id="join" className="register register-sheet register-sheet-open scroll-mt-24" aria-label="Add an organization">
      <form
        ref={form}
        action={act}
        noValidate
        className="asking"
        onSubmit={(e) => {
          const invalid = collectInvalid(e.currentTarget);
          if (invalid.length) { e.preventDefault(); setMissing(invalid); return; }
          setMissing([]);
        }}
      >
        <input ref={identityRef} type="hidden" name="identityId" defaultValue={picked?.id ?? ""} key={picked?.id ?? "none"} />
        <input ref={identityName} type="hidden" name="identityName" defaultValue={picked?.name ?? ""} />
        <input ref={notTheSame} type="hidden" name="notTheSame" defaultValue="" />
        <input type="hidden" name="partyId" value={!creating && picked?.listed ? picked.partyId ?? "" : ""} />
        {project ? <input type="hidden" name="takePart" value="1" /> : null}

        {/* The finder, always there, and Create beside it. */}
        <div className="flex flex-wrap items-end gap-3 px-5 py-4 sm:px-6">
          <span className="relative block min-w-0 flex-1">
            <Search aria-hidden className="absolute top-1/2 left-0.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input value={words} onChange={(e) => { setWords(e.target.value); setPicked(null); }} disabled={creating}
              onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} autoComplete="off" aria-label="Find an organization"
              placeholder="Find an organization by its name or code" className={`${field} pl-5.5`} />
          </span>
          <button type="button" onClick={() => { setCreating(!creating); setPicked(null); setWords(""); setMissing([]); }} className="ask shrink-0"
            data-on={creating ? "true" : undefined}>
            <Plus aria-hidden className="h-3.5 w-3.5" /> Create an organization
          </button>
        </div>

        {found ? (
          <div className="px-5 pb-4 sm:px-6">
            {found.length ? (
              <ul className="divide-y divide-line rounded-md ring-1 ring-line">
                {found.map((one) => {
                  // In our list is on the project already: never added twice.
                  return (
                    <li key={one.id}>
                      <button type="button" disabled={one.listed} onClick={() => choose(one)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-tint-soft disabled:cursor-not-allowed disabled:opacity-50">
                        <Building2 aria-hidden className="h-3.5 w-3.5 text-slate-400" />
                        <code className="code-chip">{one.code}</code>
                        <span>{one.name}</span>
                        <span className="ml-auto text-[11px] text-slate-500">
                          {one.listed ? "in our list" : (
                            <>{[countryName(one.country), one.onDelios ? "has its own DELIOS" : null].filter(Boolean).join(" · ")}
                              <span className="ml-3 inline-flex items-center gap-1 font-semibold text-link"><Plus aria-hidden className="h-3 w-3" /> Add</span></>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">
                Nobody has it yet. <button type="button" className="font-semibold text-link hover:underline" onClick={() => { setCreating(true); setWords(""); }}>Create it</button>.
              </p>
            )}
          </div>
        ) : null}

        {/* One found: its role with us here, and how it works with us when it is not on DELIOS; then add. */}
        {!creating && picked ? (
          <div className="space-y-4 border-t border-line px-5 py-5 sm:px-6">
            <p className="text-[13px] text-slate-800">
              <code className="code-chip mr-1.5">{picked.code}</code>{picked.name}
              {picked.onDelios ? <span className="ml-2 text-[11px] text-slate-500">has its own DELIOS: it is invited to work with us</span> : null}
            </p>
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              {toUs}
              {asksKind ? <PartyKindFields kind="GUEST" contactId="" backupId="" carriedBy="" people={[]} ours={ours} control={control} askContact={false} /> : null}
            </div>
          </div>
        ) : null}

        {creating ? (
          <div className="space-y-5 border-t border-line px-5 py-5 sm:px-6">
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <Field label="Name" required hint="as the company writes it"><input name="name" required autoComplete="off" className={field} /></Field>
              <Field label="Code" required hint="short, e.g. ACME; its code everywhere on DELIOS">
                <input name="code" required maxLength={20} autoComplete="off" className={`${field} font-mono uppercase`} />
              </Field>
              <IdentifierFields required allowNone />
              <Field label="Email domain" hint="optional — e.g. acme.com; it helps find it again">
                <input name="domain" autoComplete="off" placeholder="acme.com" className={field} />
              </Field>
              {toUs}
              <PartyKindFields kind="GUEST" contactId="" backupId="" carriedBy="" people={[]} ours={ours} control={control} askContact={false} />
              <Added fields={own} />
            </div>
          </div>
        ) : null}

        {/* On the organization's list: the projects it works on, if any. */}
        {!project && projects.length && (creating || asksKind || picked) ? (
          <div className="border-t border-line px-5 py-4 sm:px-6">
            <Field label="Works on" hint="optional — the projects it is put on now">
              <span className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1.5">
                {projects.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-700">
                    <input type="checkbox" name="projectIds" value={p.id} /> <span className="font-mono font-semibold">{p.code}</span> {p.name}
                  </label>
                ))}
              </span>
            </Field>
          </div>
        ) : null}

        {/* What looks like it, named before it is created: one organization stays one. */}
        {lookalikes.length || state?.error || state?.ok || missing.length ? (
          <div className="space-y-2 px-5 pb-4 sm:px-6">
            {lookalikes.length ? (
              <div role="alert" className="space-y-2 rounded-md bg-amber-50 px-3 py-2.5 ring-1 ring-amber-200">
                <p className="text-xs font-semibold text-amber-900">{state?.error}</p>
                <ul className="space-y-1.5">
                  {lookalikes.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-2 text-xs text-amber-900">
                      <code className="code-chip">{l.code}</code>
                      <span className="font-medium">{l.name}</span>
                      <span className="text-amber-800">{[countryName(l.country), l.why].filter(Boolean).join(" · ")}</span>
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
            ) : state?.ok ? (
              <p className="w-fit rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800 ring-1 ring-emerald-200">{state.ok}</p>
            ) : null}
            <MissingSummary missing={missing} />
          </div>
        ) : null}

        {creating || picked ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
            <button type="button" onClick={() => { setCreating(false); setPicked(null); setMissing([]); }}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</button>
            <button type="submit" disabled={pending} data-on="true" className="ask disabled:opacity-50"
              onClick={() => { if (notTheSame.current) notTheSame.current.value = ""; }}>
              {pending ? "Working…" : creating ? "Create" : "Add"}
            </button>
          </div>
        ) : null}
      </form>
    </section>
  );
}
