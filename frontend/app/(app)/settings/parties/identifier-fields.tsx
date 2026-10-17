"use client";

import { useState } from "react";
import { Field } from "@/components/ui";
import { COUNTRIES, IDENTIFIER_KINDS } from "@/lib/organization/countries";

/** What the number is called, by the kind of identifier chosen. */
const NUMBER_LABEL: Record<string, string> = {
  COMPANY: "Registration number", TAX: "Tax number", PROFESSIONAL: "Number on the register", PUBLIC: "Government identifier",
};

/**
 * An organization's identifier, the same on Create and on its opened line: the country it was given in, what it is
 * (company registration first, then tax number, professional register, public body), and its number, named by what it
 * is. "It has none" asks why instead.
 */
export function IdentifierFields({ country, kind, number, noReason, required, allowNone }: {
  country?: string | null; kind?: string | null; number?: string | null; noReason?: string | null;
  required?: boolean; allowNone?: boolean;
}) {
  const [chosen, setChosen] = useState(kind ?? "COMPANY");
  const [none, setNone] = useState(!!noReason && !number);
  const field = "plain w-full";
  return (
    <>
      <Field label="Country" required={required && !none} hint="where it was registered">
        <select name="country" required={required && !none} disabled={none} defaultValue={country ?? ""} className={field}>
          <option value="">Choose…</option>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Identified by" hint={IDENTIFIER_KINDS.find((k) => k.value === chosen)?.hint}>
        <select name="identifierKind" value={chosen} disabled={none} onChange={(e) => setChosen(e.target.value)} className={field}>
          {IDENTIFIER_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </Field>
      <Field label={NUMBER_LABEL[chosen] ?? "Number"} required={required && !none} hint="as written on its papers">
        <input name="identifierNumber" required={required && !none} disabled={none} defaultValue={number ?? ""} autoComplete="off" className={`${field} font-mono`} />
      </Field>
      {allowNone ? (
        <Field label="It has none of these" hint="a company being set up, someone working alone on no register…">
          <span className="flex h-(--control-h) items-center gap-2">
            <input type="checkbox" checked={none} onChange={(e) => setNone(e.target.checked)} aria-label="It has none of these" />
            {none
              ? <input name="noIdentifierReason" required defaultValue={noReason ?? ""} placeholder="Say why" className={field} />
              : <span className="text-xs text-slate-500">tick, then say why</span>}
          </span>
        </Field>
      ) : null}
    </>
  );
}
