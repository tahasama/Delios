"use client";

import { useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { SearchPick, type PickItem } from "@/components/search-pick";
import { askToJoinAction } from "@/lib/settings/forms-people";

type Option = { value: string; label: string };

/** The function and department they would hold, the same on both forms. */
function FunctionAndDepartment({ projectCode, functions, disciplines }: { projectCode: string; functions: Option[]; disciplines: Option[] }) {
  return (
    <>
      <Field label={`Function on ${projectCode}`} required>
        <select name="functionId" required defaultValue="" className={inputCls}>
          <option value="" disabled>Choose…</option>
          {functions.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </Field>
      <Field label="Department" hint="their discipline: told about actions, confirms going ahead">
        <select name="department" defaultValue="" className={inputCls}>
          <option value="">None</option>
          {disciplines.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      </Field>
    </>
  );
}

/** Who confirms, when the project asks for it: holders of Manage recommended, anyone on the project choosable. */
function WhoConfirms({ confirmers }: { confirmers: PickItem[] }) {
  const recommended = confirmers.filter((c) => c.note === "recommended");
  return (
    <SearchPick single name="confirmerId" label="Who confirms" hint="nobody chosen: everyone who holds Manage is asked" items={confirmers}
      initial={recommended.length === 1 ? [recommended[0].id] : []} />
  );
}

/**
 * "Ask for someone to join": always someone new (first name, last name, email), with their function and department.
 * It goes as an information transmittal (Request) to whoever answers it. Closed until opened.
 */
export function AskToJoinForm({
  projectCode, ourParties, guestParties, functions, disciplines, confirmers, asks, mayKeepProof,
}: {
  projectCode: string;
  ourParties: Option[];
  /** Guest organizations (accounts we make). */
  guestParties: Option[];
  functions: Option[];
  disciplines: Option[];
  confirmers: PickItem[];
  /** True: it is asked first; false: they are put on at once. */
  asks: boolean;
  /** The control function keeps what came from outside the system. */
  mayKeepProof: boolean;
}) {
  const [from, setFrom] = useState<"ours" | "guest">("ours");
  const orgs = from === "ours" ? ourParties : guestParties;
  return (
    <details className="group">
      <summary className="ask w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden"><UserPlus aria-hidden className="h-3.5 w-3.5" /> Ask for someone to join</summary>
      <div className="mt-3">
        <ActionForm action={askToJoinAction} submitLabel={asks ? "Send the request" : `Put them on ${projectCode}`} size="sm" resetOnSuccess>
          <p className="text-[11px] text-slate-500">
            Someone new: an account is made for them, and their email to choose a password goes once they are on. Someone whose company has its own DELIOS is put on by their administrator.
          </p>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="First name" required><input name="firstName" required autoComplete="off" className={inputCls} /></Field>
            <Field label="Last name" required><input name="lastName" required autoComplete="off" className={inputCls} /></Field>
            <Field label="Email" required hint="where their link to choose a password goes"><input type="email" name="email" required autoComplete="off" className={inputCls} /></Field>
            <FunctionAndDepartment projectCode={projectCode} functions={functions} disciplines={disciplines} />
            <Field label="Of" required hint="ours, or a guest organization (accounts we make)">
              <div className="flex gap-2">
                <select value={from} onChange={(e) => setFrom(e.target.value as "ours" | "guest")} className={`${inputCls} w-auto`} aria-label="Ours or a guest">
                  <option value="ours">Our organization</option>
                  <option value="guest" disabled={!guestParties.length}>A guest organization</option>
                </select>
                {orgs.length > 1 || from === "guest" ? (
                  <select name="partyId" required defaultValue="" key={from} className={inputCls} aria-label="Which organization">
                    <option value="" disabled>Choose…</option>
                    {orgs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : <input type="hidden" name="partyId" value={orgs[0]?.value ?? ""} />}
              </div>
            </Field>
            {asks ? <div className="sm:col-span-2 lg:col-span-1"><WhoConfirms confirmers={confirmers} /></div> : null}
          </div>
          <Field label="Message" hint="optional — whoever answers reads it">
            <textarea name="why" rows={2} className={inputCls} placeholder="e.g. joins the piping team for the detailed design" />
          </Field>
          {mayKeepProof ? (
            <Field label="What it came on" hint="optional — the email or letter that asked for them, kept with the request as proof">
              <input type="file" name="proof" className="w-full sm:w-96" />
            </Field>
          ) : null}
        </ActionForm>
      </div>
    </details>
  );
}

/** "Add someone": someone who already has an account, found by name, with their function and department. */
export function AddSomeoneForm({
  projectCode, people, functions, disciplines, confirmers, asks,
}: {
  projectCode: string;
  /** People with an account who are not on the project yet. */
  people: PickItem[];
  functions: Option[];
  disciplines: Option[];
  confirmers: PickItem[];
  asks: boolean;
}) {
  return (
    <details className="group">
      <summary className="ask w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden"><Search aria-hidden className="h-3.5 w-3.5" /> Add someone</summary>
      <div className="mt-3">
        {people.length ? (
          <ActionForm action={askToJoinAction} submitLabel={asks ? "Ask to confirm" : `Put them on ${projectCode}`} size="sm" resetOnSuccess>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <SearchPick single required name="userId" label="Who" hint="type part of a name" items={people} placeholder="Find someone" />
              <FunctionAndDepartment projectCode={projectCode} functions={functions} disciplines={disciplines} />
              {asks ? <WhoConfirms confirmers={confirmers} /> : null}
            </div>
          </ActionForm>
        ) : (
          <p className="text-xs text-slate-500">Everyone with an account is already on {projectCode}. Someone new is asked for with &ldquo;Ask for someone to join&rdquo;.</p>
        )}
      </div>
    </details>
  );
}
