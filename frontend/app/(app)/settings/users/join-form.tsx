"use client";

import { useState } from "react";
import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { SearchPick, type PickItem } from "@/components/search-pick";
import { askToJoinAction } from "@/lib/settings/forms-people";

type Option = { value: string; label: string };

/**
 * Asking for someone to join a project, the one way everywhere (People & access, and "Ask for someone to join" for
 * anyone of ours): someone who has an account, or someone new; their function and department; why; who confirms,
 * when management is asked; and, for Document Control, the email or letter it came on, kept as proof.
 */
export function JoinForm({
  projectCode, people, ourParties, guestParties, functions, disciplines, confirmers, asks, mayKeepProof,
}: {
  projectCode: string;
  /** People with an account who are not on the project yet. */
  people: PickItem[];
  ourParties: Option[];
  /** Guest organizations (accounts we make); a note says one not taking part yet. */
  guestParties: Option[];
  functions: Option[];
  disciplines: Option[];
  /** Who may confirm: managers first (recommended), then anyone on the project. */
  confirmers: PickItem[];
  /** True: management is asked first; false: they are put on at once. */
  asks: boolean;
  /** Document Control keeps what came from outside the system. */
  mayKeepProof: boolean;
}) {
  const [who, setWho] = useState<"account" | "new">(people.length ? "account" : "new");
  const [newFrom, setNewFrom] = useState<"ours" | "guest">("ours");
  const orgs = newFrom === "ours" ? ourParties : guestParties;

  return (
    <ActionForm action={askToJoinAction} submitLabel={asks ? "Ask management to confirm" : `Put them on ${projectCode}`} size="sm" resetOnSuccess>
      {/* Who: one choice, then only what that choice needs. */}
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Who joins">
        <button type="button" role="radio" aria-checked={who === "account"} data-on={who === "account"} onClick={() => setWho("account")} className="ask"
          disabled={!people.length} title={people.length ? undefined : "Everyone with an account is already on the project"}>
          Someone with an account
        </button>
        <button type="button" role="radio" aria-checked={who === "new"} data-on={who === "new"} onClick={() => setWho("new")} className="ask">
          Someone new
        </button>
        <span className="text-[11px] text-slate-500">
          {who === "account" ? "already signs in to DELIOS with us" : "an account is made for them; their email to choose a password goes once they are on"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {who === "account" ? (
          <div className="sm:col-span-2 lg:col-span-1">
            <SearchPick single required name="userId" label="Who" hint="type part of a name" items={people} placeholder="Find someone" />
          </div>
        ) : (
          <>
            <Field label="Full name" required><input name="name" required className={inputCls} /></Field>
            <Field label="Email" required hint="where their link to choose a password goes"><input type="email" name="email" required className={inputCls} /></Field>
            <Field label="Of" required hint="ours, or a guest organization (accounts we make)">
              <div className="flex gap-2">
                <select value={newFrom} onChange={(e) => setNewFrom(e.target.value as "ours" | "guest")} className={`${inputCls} w-auto`} aria-label="Ours or a guest">
                  <option value="ours">Our organization</option>
                  <option value="guest" disabled={!guestParties.length}>A guest organization</option>
                </select>
                {orgs.length > 1 || newFrom === "guest" ? (
                  <select name="partyId" required defaultValue="" key={newFrom} className={inputCls} aria-label="Which organization">
                    <option value="" disabled>Choose…</option>
                    {orgs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : <input type="hidden" name="partyId" value={orgs[0]?.value ?? ""} />}
              </div>
            </Field>
          </>
        )}
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
        {asks ? (
          <div className="sm:col-span-2 lg:col-span-1">
            <SearchPick single name="confirmerId" label="Who confirms" hint="nobody chosen: every manager is asked" items={confirmers}
              initial={confirmers.filter((c) => c.note === "recommended").length === 1 ? [confirmers.find((c) => c.note === "recommended")!.id] : []} />
          </div>
        ) : null}
      </div>

      <Field label="Why" required hint={asks ? "whoever confirms reads it" : "kept on the record"}>
        <textarea name="why" required rows={2} className={inputCls} placeholder="e.g. joins the piping team for the detailed design" />
      </Field>

      {mayKeepProof ? (
        <Field label="What it came on" hint="optional — the email or letter that asked for them, kept with the request as proof">
          <input type="file" name="proof" className="w-full sm:w-96" />
        </Field>
      ) : null}
    </ActionForm>
  );
}
