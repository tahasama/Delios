"use client";
import { Select } from "@/components/select";

import { useState } from "react";
import { Field } from "@/components/ui";
import { SearchPick, type PickItem } from "@/components/search-pick";

type Option = { value: string; label: string };

/** A field as on the new-document form: grey, no box, inside the sheet's `asking` body. */
const field = "plain w-full";

/** The function and department they would hold, the same on both forms. */
export function FunctionAndDepartment({ projectCode, functions, disciplines }: { projectCode: string; functions: Option[]; disciplines: Option[] }) {
  return (
    <>
      <Field label={`Function on ${projectCode}`} required>
        <Select name="functionId" required defaultValue="" className={field}>
          <option value="" disabled>Choose…</option>
          {functions.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </Select>
      </Field>
      <Field label="Department" hint="their discipline: told about actions, confirms going ahead">
        <Select name="department" defaultValue="" className={field}>
          <option value="">None</option>
          {disciplines.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </Select>
      </Field>
    </>
  );
}

/**
 * Someone new, as both forms ask it: name, email, whose they are, their function and department, and the email or
 * letter it came on. `onName` follows the name, for the transmittal's subject.
 */
export function NewPerson({ projectCode, ourParties, guestParties, functions, disciplines, mayKeepProof, onName }: {
  projectCode: string; ourParties: Option[]; guestParties: Option[]; functions: Option[]; disciplines: Option[]; mayKeepProof: boolean;
  onName?: (name: string) => void;
}) {
  const [from, setFrom] = useState<"ours" | "guest">("ours");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const orgs = from === "ours" ? ourParties : guestParties;
  const named = (f: string, l: string) => onName?.([f.trim(), l.trim()].filter(Boolean).join(" "));
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      <Field label="First name" required><input name="firstName" required autoComplete="off" className={field} value={first} onChange={(e) => { setFirst(e.target.value); named(e.target.value, last); }} /></Field>
      <Field label="Last name" required><input name="lastName" required autoComplete="off" className={field} value={last} onChange={(e) => { setLast(e.target.value); named(first, e.target.value); }} /></Field>
      <Field label="Email" required hint="where their link to choose a password goes"><input type="email" name="email" required autoComplete="off" className={field} /></Field>
      <Field label="Of" required hint="ours, or a guest organization (accounts we make)">
        <div className="flex gap-2">
          <Select value={from} onChange={(e) => setFrom(e.target.value as "ours" | "guest")} className="plain w-auto" aria-label="Ours or a guest">
            <option value="ours">Our organization</option>
            <option value="guest" disabled={!guestParties.length}>A guest organization</option>
          </Select>
          {orgs.length > 1 || from === "guest" ? (
            <Select name="partyId" required defaultValue="" key={from} className={field} aria-label="Which organization">
              <option value="" disabled>Choose…</option>
              {orgs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          ) : <input type="hidden" name="partyId" value={orgs[0]?.value ?? ""} />}
        </div>
      </Field>
      <FunctionAndDepartment projectCode={projectCode} functions={functions} disciplines={disciplines} />
      {mayKeepProof ? (
        <Field label="What it came on" hint="optional — the email or letter that asked for them, kept with the request as proof">
          <input type="file" name="proof" className="w-full" />
        </Field>
      ) : null}
    </div>
  );
}

/** Who confirms, when the project asks for it: holders of Manage recommended, anyone on the project choosable. */
export function WhoConfirms({ confirmers }: { confirmers: PickItem[] }) {
  const recommended = confirmers.filter((c) => c.note === "recommended");
  return (
    <SearchPick single name="confirmerId" label="Who confirms" hint="nobody chosen: everyone who holds Manage is asked" items={confirmers}
      initial={recommended.length === 1 ? [recommended[0].id] : []} />
  );
}

