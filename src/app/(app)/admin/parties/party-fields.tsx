"use client";

import { useState } from "react";
import { Field, inputCls } from "@/components/ui";
import { PARTY_KINDS } from "@/lib/party-kinds";


/**
 * How an organization works with us, and the one question that follows from it.
 * An organization that answers here names one of its own people; one that does
 * not names the function of ours that carries it. The question changes as the
 * choice is made, rather than after saving.
 */
export function PartyKindFields({ kind, contactId, backupId, liaisonFunction, people, functions, access }: {
  kind: string;
  contactId: string;
  backupId: string;
  liaisonFunction: string;
  /**
   * Whether this organization's own people sign in here, and how many. An
   * organization we fill in for has none, so it is never asked.
   */
  access?: { active: boolean; signingIn: number };
  /** The organization's own people, if any hold an account here. */
  people: { id: string; name: string; email?: string | null }[];
  functions: { id: string; name: string }[];
}) {
  const [chosen, setChosen] = useState(kind);
  const offline = chosen === "OFFLINE";

  return (
    <>
      <Field label="How they work with us" required>
        <select name="kind" value={chosen} onChange={(event) => setChosen(event.target.value)} className={inputCls}>
          {PARTY_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label} — {item.hint}</option>)}
        </select>
      </Field>

      {offline ? (
        <Field label="Who carries it" hint="our function that sends it to them, and fills in their review, comments and answer — with proof each time">
          <select name="liaisonFunction" defaultValue={liaisonFunction} className={inputCls}>
            <option value="">Document Control</option>
            {functions.map((fn) => <option key={fn.id} value={fn.id}>{fn.name}</option>)}
          </select>
        </Field>
      ) : people.length ? (
        <>
          <Field label="Who answers for it" hint="one of their own people">
            <select name="contactId" defaultValue={contactId} className={inputCls}>
              <option value="">— nobody —</option>
              {people.map((person) => <option key={person.id} value={person.id}>{person.name}{person.email ? ` · ${person.email}` : ""}</option>)}
            </select>
          </Field>
          <Field label="Backup" hint="optional — who stands in when the contact is away">
            <select name="backupId" defaultValue={backupId} className={inputCls}>
              <option value="">— none —</option>
              {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </Field>
        </>
      ) : (
        <p className="text-xs text-amber-800">
          Nobody of theirs is here yet. Add their people in <a href="/admin/users" className="font-semibold text-link hover:underline">People &amp; access</a>, then name the one who answers.
        </p>
      )}

      {access && !offline && access.signingIn ? (
        <div className="mt-1 border-t border-slate-100 pt-3">
          <label className="flex items-start gap-2 text-xs text-slate-600">
            <input type="checkbox" name="active" defaultChecked={access.active} className="mt-0.5" />
            <span>Has access — untick to revoke; its {access.signingIn} {access.signingIn === 1 ? "person" : "people"} can no longer sign in</span>
          </label>
        </div>
      ) : <input type="hidden" name="active" value="on" />}
    </>
  );
}
