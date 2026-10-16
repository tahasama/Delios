"use client";

import { useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { ActionForm } from "@/components/form";
import { Field } from "@/components/ui";
import { SearchPick, type PickItem } from "@/components/search-pick";
import { askToJoinAction } from "@/lib/settings/forms-people";

type Option = { value: string; label: string };

/** A field as on the new-document form: grey, no box, inside the sheet's `asking` body. */
const field = "plain w-full";

/** The function and department they would hold, the same on both forms. */
function FunctionAndDepartment({ projectCode, functions, disciplines }: { projectCode: string; functions: Option[]; disciplines: Option[] }) {
  return (
    <>
      <Field label={`Function on ${projectCode}`} required>
        <select name="functionId" required defaultValue="" className={field}>
          <option value="" disabled>Choose…</option>
          {functions.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </Field>
      <Field label="Department" hint="their discipline: told about actions, confirms going ahead">
        <select name="department" defaultValue="" className={field}>
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
 * "Someone joins <project>": one sheet, the new-document form's way, never a sheet inside a sheet. Closed, its band
 * and the acts ("Add someone", "Ask for someone to join"); one chosen, the same sheet becomes that form: its band names
 * it, grey fields side by side, then the strip with Cancel on the left and the act on the right.
 */
export function SomeoneJoins({
  projectCode, sentence, mayAdd, people, ourParties, guestParties, functions, disciplines, confirmers, asks, mayKeepProof, footnote,
}: {
  projectCode: string;
  /** The band's sentence while nothing is chosen. */
  sentence: string;
  /** "Add someone" with an account is offered. */
  mayAdd: boolean;
  /** People with an account who are not on the project yet. */
  people: PickItem[];
  ourParties: Option[];
  /** Guest organizations (accounts we make). */
  guestParties: Option[];
  functions: Option[];
  disciplines: Option[];
  confirmers: PickItem[];
  /** True: it is asked first; false: they are put on at once. */
  asks: boolean;
  /** The control function keeps the email or letter a request came on. */
  mayKeepProof: boolean;
  /** A line under the acts, while nothing is chosen. */
  footnote?: React.ReactNode;
}) {
  const [chosen, setChosen] = useState<"add" | "ask" | null>(null);
  const [from, setFrom] = useState<"ours" | "guest">("ours");
  const orgs = from === "ours" ? ourParties : guestParties;
  const formId = `someone-joins-${chosen ?? "none"}`;

  const band = (title: string, said: string) => (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
      <span className="stencil mr-1 text-slate-500">{title}</span>
      <span className="text-[11px] text-slate-500">{said}</span>
    </div>
  );

  if (!chosen) {
    return (
      <section id="join" className="register register-sheet register-sheet-open scroll-mt-24" aria-label={`Someone joins ${projectCode}`}>
        {band(`Someone joins ${projectCode}`, sentence)}
        <div className="space-y-3 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-start gap-2">
            {mayAdd ? (
              <button type="button" onClick={() => setChosen("add")} disabled={!people.length} className="ask disabled:cursor-not-allowed disabled:opacity-50"
                title={people.length ? undefined : `Everyone with an account is already on ${projectCode}`}>
                <Search aria-hidden className="h-3.5 w-3.5" /> Add someone
              </button>
            ) : null}
            <button type="button" onClick={() => setChosen("ask")} className="ask"><UserPlus aria-hidden className="h-3.5 w-3.5" /> Ask for someone to join</button>
          </div>
          {footnote ? <p className="text-[11px] leading-4 text-slate-500">{footnote}</p> : null}
        </div>
      </section>
    );
  }

  return (
    <section id="join" className="register register-sheet register-sheet-open scroll-mt-24" aria-label={chosen === "add" ? "Add someone" : "Ask for someone to join"}>
      {chosen === "add"
        ? band("Add someone", `someone who already has an account, and their place on ${projectCode}`)
        : band("Ask for someone to join", `someone new: their account is made, and their link to choose a password goes once they are on ${projectCode}`)}
      <ActionForm id={formId} action={askToJoinAction} hideSubmit resetOnSuccess className="asking space-y-5 px-5 py-5 sm:px-6">
        {chosen === "add" ? (
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <SearchPick single required name="userId" label="Who" hint="type part of a name" items={people} placeholder="Find someone" />
            {asks ? <WhoConfirms confirmers={confirmers} /> : <span aria-hidden />}
            <FunctionAndDepartment projectCode={projectCode} functions={functions} disciplines={disciplines} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <Field label="First name" required><input name="firstName" required autoComplete="off" className={field} /></Field>
              <Field label="Last name" required><input name="lastName" required autoComplete="off" className={field} /></Field>
              <Field label="Email" required hint="where their link to choose a password goes"><input type="email" name="email" required autoComplete="off" className={field} /></Field>
              <Field label="Of" required hint="ours, or a guest organization (accounts we make)">
                <div className="flex gap-2">
                  <select value={from} onChange={(e) => setFrom(e.target.value as "ours" | "guest")} className="plain w-auto" aria-label="Ours or a guest">
                    <option value="ours">Our organization</option>
                    <option value="guest" disabled={!guestParties.length}>A guest organization</option>
                  </select>
                  {orgs.length > 1 || from === "guest" ? (
                    <select name="partyId" required defaultValue="" key={from} className={field} aria-label="Which organization">
                      <option value="" disabled>Choose…</option>
                      {orgs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : <input type="hidden" name="partyId" value={orgs[0]?.value ?? ""} />}
                </div>
              </Field>
              <FunctionAndDepartment projectCode={projectCode} functions={functions} disciplines={disciplines} />
              {asks ? <WhoConfirms confirmers={confirmers} /> : null}
              {mayKeepProof ? (
                <Field label="What it came on" hint="optional — the email or letter that asked for them, kept with the request as proof">
                  <input type="file" name="proof" className="w-full" />
                </Field>
              ) : null}
            </div>
            <Field label="Message" hint="optional — whoever answers reads it">
              <textarea name="why" rows={2} className={field} placeholder="e.g. joins the piping team for the detailed design" />
            </Field>
          </>
        )}
      </ActionForm>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
        <button type="button" onClick={() => setChosen(null)} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</button>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-500">
            {asks ? "It goes as a request; once confirmed they are put on and told." : "They are put on at once, and told."}
          </span>
          <button type="submit" form={formId} data-on="true" className="ask">
            {asks ? (chosen === "add" ? "Ask to confirm" : "Send the request") : `Put them on ${projectCode}`}
          </button>
        </div>
      </div>
    </section>
  );
}
