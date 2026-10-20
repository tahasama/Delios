"use client";
import { Select } from "@/components/select";

import { useState } from "react";
import { SwitchControl } from "@/components/switch";
import Link from "next/link";
import { Field } from "@/components/ui";
import { PARTY_KINDS } from "@/lib/settings/party-kinds";
import { SearchPick, type PickItem } from "@/components/search-pick";

/** A field as on the new-document form: grey, no box, inside the sheet's `asking` body. */
const field = "plain w-full";

/**
 * How an organization works with us, and what follows from it. One whose people get accounts from us names one of
 * them who answers for it; one that nobody of theirs signs in for gets their email (where our transmittals go, the
 * only address whose replies are taken in) and the person of ours who works for it (nobody chosen: the control
 * function). The questions change as the choice is made.
 */
export function PartyKindFields({ kind, contactId, backupId, carriedBy, people, ours, control, access, contactEmail = "", fixed, askContact = true }: {
  kind: string;
  /** Who of theirs answers for it is the project's: asked on a project's line, not on the organization's list. */
  askContact?: boolean;
  /** How they work with us was changed once already: shown, fixed (the words say when and by whom). */
  fixed?: string;
  contactEmail?: string;
  contactId: string;
  backupId: string;
  /** The person of ours who works for it; empty: the control function. */
  carriedBy: string;
  /** Whether its people sign in here, and how many: "In use" is asked on an organization already there. */
  /** Active or suspended; `onTheLine`: its switch is on the organization's line, so the form only keeps it as it is. */
  access?: { active: boolean; signingIn: number; onTheLine?: boolean };
  /** Its own people, if any hold an account here. */
  people: { id: string; name: string; email?: string | null }[];
  /** Our people, to choose who works for it. */
  ours: PickItem[];
  /** Who acts as the control function, by name: who works for it when nobody is chosen. */
  control: string[];
}) {
  const [chosen, setChosen] = useState(kind);
  const offline = chosen === "OFFLINE";
  const label = (value: string) => PARTY_KINDS.find((item) => item.value === value)?.label ?? value;
  const nobody = control.length ? control.join(", ") : "the control function";

  return (
    <>
      {chosen === "COLLABORATOR" ? (
        <Field label="How they work with us">
          <input type="hidden" name="kind" value="COLLABORATOR" />
          <p className="flex h-(--control-h) items-center text-[13px] text-slate-700">{label("COLLABORATOR")}</p>
        </Field>
      ) : fixed ? (
        <Field label="How they work with us" hint={fixed}>
          <input type="hidden" name="kind" value={chosen} />
          <p className="flex h-(--control-h) items-center text-[13px] text-slate-600">{label(chosen)}</p>
        </Field>
      ) : (
        <Field label="How they work with us" required hint={access ? "changed once only, for a mistake" : PARTY_KINDS.find((k) => k.value === chosen)?.hint}>
          <Select name="kind" value={chosen} onChange={(event) => setChosen(event.target.value)} className={field}>
            {PARTY_KINDS.filter((item) => item.value !== "COLLABORATOR").map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </Select>
        </Field>
      )}

      {offline ? (
        <>
          <Field label="Their email for transmittals" required hint="our transmittals go there with their files; only its replies are taken in">
            <input type="email" name="contactEmail" required defaultValue={contactEmail} maxLength={254} className={field} placeholder="documents@their-company.com" />
          </Field>
          <SearchPick single name="carriedBy" label="Who of ours works for it" hint={`sends to them and records their answers; nobody chosen: ${nobody}`}
            items={ours} initial={carriedBy ? [carriedBy] : []} placeholder={nobody} />
        </>
      ) : !askContact ? null : people.length ? (
        <>
          <SearchPick single name="contactId" items={people.map((person) => ({ id: person.id, name: person.name, detail: person.email ?? null }))}
            initial={contactId ? [contactId] : []} label="Who answers for it here" hint="optional — one of their people, so we know whom to ask" placeholder="Nobody yet" />
          <SearchPick single name="backupId" items={people.map((person) => ({ id: person.id, name: person.name, detail: person.email ?? null }))}
            initial={backupId ? [backupId] : []} label="Backup" hint="optional — who stands in when the contact is away" placeholder="No backup" />
        </>
      ) : (
        <p className="text-xs leading-5 text-slate-600 sm:col-span-2">
          {chosen === "COLLABORATOR"
            ? "Nobody of theirs is on the project yet: their administrator puts them on."
            : <>Nobody of theirs has an account yet. Add them in <Link href="/settings/users" className="font-semibold text-link hover:underline">People &amp; access</Link> when they need one.</>}
        </p>
      )}

      {access?.onTheLine ? <input type="hidden" name="active" value={access.active ? "on" : "off"} /> : access ? (
        <label className="flex w-fit cursor-pointer items-center gap-2.5 text-xs font-medium text-slate-700 sm:col-span-2">
          <SwitchControl name="active" defaultChecked={access.active} />
          <span>
            Active <span className="font-normal text-slate-500">— switched off, it is suspended: no longer offered for new documents, transmittals or routes
            {access.signingIn ? `, and its ${access.signingIn} ${access.signingIn === 1 ? "person" : "people"} can no longer sign in` : ""}. Everything already done under it stays.</span>
          </span>
        </label>
      ) : <input type="hidden" name="active" value="on" />}
    </>
  );
}
