"use client";

import { useState } from "react";
import { X, Undo2 } from "lucide-react";
import { Field, inputCls } from "@/components/ui";
import { SearchPick } from "@/components/search-pick";

type Named = { id: string; name: string };
type AskedRequest = { id: string; reason: string; askedBy: string; people: Named[]; parties: Named[] };

/**
 * Who receives the revision when it is released. Document Control does not choose this: it was said by whoever
 * decided the review, or asked for it to be sent. Releasing, Document Control sees them and may take anyone off
 * (the request says so) or add others. Asked by nobody yet, the people added here are who it goes to.
 */
export function ReleaseRecipients({ asked, leftTo, choices, reasons, required }: {
  /** Open requests naming people or organizations. */
  asked: AskedRequest[];
  /** Whoever it was left to, who has not said yet. */
  leftTo: string[];
  /** Everyone who may be added. */
  choices: { people: (Named & { detail?: string | null })[]; parties: Named[] };
  reasons: { code: string; label: string }[];
  /** Released and issued go together: someone must receive it. */
  required: boolean;
}) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setOff((was) => {
    const next = new Set(was);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const named = asked.some((one) => one.people.length + one.parties.length > 0);
  const chip = (requestId: string, kind: "u" | "p", one: Named) => {
    const key = `${requestId}:${kind}:${one.id}`;
    const gone = off.has(key);
    return (
      <span key={key} className={`inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2 text-[11px] font-semibold ring-1 ${gone ? "bg-slate-100 text-slate-400 line-through ring-slate-200" : "bg-tint-soft text-slate-700 ring-line"}`}>
        {one.name}
        {gone ? null : <input type="hidden" name={`keep_${requestId}`} value={`${kind}:${one.id}`} />}
        <button type="button" onClick={() => toggle(key)} className="rounded-full p-0.5 text-slate-400 hover:bg-white hover:text-slate-700" aria-label={gone ? `Put ${one.name} back` : `Take ${one.name} off`} title={gone ? "Put back" : "Take off"}>
          {gone ? <Undo2 className="h-3 w-3" /> : <X className="h-3 w-3" />}
        </button>
      </span>
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-slate-700">Who receives it</p>
      {asked.length ? (
        <ul className="space-y-2">
          {asked.map((one) => (
            <li key={one.id} className="rounded-md bg-tint-soft px-3 py-2.5 text-xs leading-5 ring-1 ring-line">
              <input type="hidden" name="keptRequest" value={one.id} />
              <p className="text-slate-600"><span className="font-semibold text-slate-800">{one.reason}</span> · asked by {one.askedBy}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {one.people.map((person) => chip(one.id, "u", person))}
                {one.parties.map((party) => chip(one.id, "p", party))}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {leftTo.length ? (
        <p className="text-xs text-slate-500">Left to {leftTo.join(", ")} to say who receives it; they have not said yet.</p>
      ) : null}
      {!asked.length && !leftTo.length ? (
        <p className="text-xs text-slate-500">Nobody has said who receives it.{required ? " Released and issued go together: name them below." : ""}</p>
      ) : null}

      <details className="group" open={required && !named}>
        <summary className="ask w-fit cursor-pointer list-none">Add people or organizations</summary>
        <div className="mt-3 space-y-3">
          <Field label="Why they are getting it" hint="from your organization's list">
            <select name="issueReason" defaultValue={reasons[0]?.code ?? ""} className={inputCls}>
              {reasons.map((one) => <option key={one.code} value={one.code}>{one.code} — {one.label}</option>)}
            </select>
          </Field>
          <SearchPick
            name="internalUserIds"
            items={choices.people.map((person) => ({ id: person.id, name: person.name, detail: person.detail ?? undefined }))}
            label="Our own people"
            hint="optional"
          />
          {choices.parties.length ? (
            <SearchPick name="partyIds" browse items={choices.parties} label="Other organizations" hint="optional — one transmittal for each" placeholder="No other organization" />
          ) : null}
        </div>
      </details>
    </div>
  );
}
