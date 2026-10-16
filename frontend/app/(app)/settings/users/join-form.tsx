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

/**
 * One act of the page, opened as a sheet the new-document form's way: the button that opens it, then the band (what
 * it is, the sentence about it), the fields side by side, and the strip with Cancel on the left and the act on the
 * right.
 */
function FormSheet({ id, opener, title, sentence, submitLabel, note, action, children }: {
  id: string;
  opener: React.ReactNode;
  title: string;
  sentence: string;
  submitLabel: string;
  note?: string;
  action: Parameters<typeof ActionForm>[0]["action"];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="ask w-fit">{opener}</button>;
  return (
    <section className="register register-sheet register-sheet-open basis-full">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
        <span className="stencil mr-1 text-slate-400">{title}</span>
        <span className="text-[11px] text-slate-400">{sentence}</span>
      </div>
      <ActionForm id={id} action={action} hideSubmit resetOnSuccess className="asking space-y-5 px-5 py-5 sm:px-6">
        {children}
      </ActionForm>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
        <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</button>
        <div className="flex items-center gap-3">
          {note ? <span className="text-[11px] text-slate-400">{note}</span> : null}
          <button type="submit" form={id} data-on="true" className="ask">{submitLabel}</button>
        </div>
      </div>
    </section>
  );
}

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
    <FormSheet
      id="ask-to-join"
      opener={<><UserPlus aria-hidden className="h-3.5 w-3.5" /> Ask for someone to join</>}
      title="Ask for someone to join"
      sentence={`someone new: their account is made, and their link to choose a password goes once they are on ${projectCode}`}
      submitLabel={asks ? "Send the request" : `Put them on ${projectCode}`}
      note={asks ? "It goes as a request; you read the answer on the same thread." : "They are on at once, and told."}
      action={askToJoinAction}
    >
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
    </FormSheet>
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
    people.length ? (
      <FormSheet
        id="add-someone"
        opener={<><Search aria-hidden className="h-3.5 w-3.5" /> Add someone</>}
        title="Add someone"
        sentence={`someone who already has an account, found by name, and their place on ${projectCode}`}
        submitLabel={asks ? "Ask to confirm" : `Put them on ${projectCode}`}
        note={asks ? "Whoever holds Manage confirms; they are told once on." : "They are on at once, and told."}
        action={askToJoinAction}
      >
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <SearchPick single required name="userId" label="Who" hint="type part of a name" items={people} placeholder="Find someone" />
          {asks ? <WhoConfirms confirmers={confirmers} /> : <span aria-hidden />}
          <FunctionAndDepartment projectCode={projectCode} functions={functions} disciplines={disciplines} />
        </div>
      </FormSheet>
    ) : (
      <p className="text-xs text-slate-500">Everyone with an account is already on {projectCode}. Someone new is asked for with &ldquo;Ask for someone to join&rdquo;.</p>
    )
  );
}
